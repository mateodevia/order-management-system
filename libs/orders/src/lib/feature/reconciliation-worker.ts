import { eq, sql } from 'drizzle-orm';
import { db } from '@oms/shared/database';
import type { IPaymentClient } from '@oms/payments';
import { sendAlert } from '@oms/shared/monitoring';
import { PaymentStatus } from '@oms/shared/types';
import { Orders } from '../data-access/orders.schema';
import { OrderItems } from '../data-access/order-items.schema';
import { cancelPendingOrder } from '../data-access/order-service';

/** Runtime configuration for a single reconciliation cycle. */
export interface ReconciliationWorkerConfig {
  /** Gateway client used to resolve charge status by idempotency key. */
  paymentClient: IPaymentClient;
  /** Maximum number of stale orders to process per cycle. */
  batchSize: number;
  /** Retry attempts after which an order is moved to DLQ. */
  maxRetries: number;
  /** Base delay (ms) for exponential backoff with jitter between retries. */
  baseDelayMs: number;
}

/**
 * Computes the next reconciliation retry timestamp using exponential backoff and jitter.
 *
 * @param retryCount - Number of prior retries for the order.
 * @param baseDelayMs - Base delay in milliseconds before the first retry.
 * @returns Scheduled time for the next reconciliation attempt.
 */
export function computeNextRetryAt(retryCount: number, baseDelayMs: number): Date {
  const exponentialDelay = baseDelayMs * Math.pow(2, retryCount);
  const jitter = Math.random() * exponentialDelay;
  return new Date(Date.now() + exponentialDelay + jitter);
}

/** Shape of an order row claimed for reconciliation. */
interface ClaimedOrder {
  id: string;
  idempotencyKey: string;
  warehouseId: string;
  retryCount: number;
}

/**
 * Claims a batch of stale PENDING_PAYMENT orders in a short-lived transaction.
 *
 * Uses `FOR UPDATE SKIP LOCKED` to avoid contention with other workers or
 * the main order flow's compensation path. The transaction is released
 * immediately after the SELECT, freeing the DB connection.
 *
 * @param batchSize - Maximum number of orders to claim.
 * @returns Claimed order rows ready for gateway status checks.
 */
async function claimReconciliationBatch(batchSize: number): Promise<ClaimedOrder[]> {
  return db.transaction(async (tx) => {
    const result = await tx.execute(
      sql`SELECT id, idempotency_key, warehouse_id, retry_count
          FROM orders
          WHERE status = 'PENDING_PAYMENT'
            AND (next_retry_at IS NULL OR next_retry_at <= NOW())
          ORDER BY created_at ASC
          LIMIT ${batchSize}
          FOR UPDATE SKIP LOCKED`,
    );

    const rows = result.rows as Array<{
      id: string;
      idempotency_key: string;
      warehouse_id: string;
      retry_count: number;
    }>;

    if (rows.length === 0) return [];

    // Set next_retry_at as a stale-claim guard: if this process crashes before
    // finalizing, the order won't be re-claimed until the guard expires.
    for (const row of rows) {
      await tx.execute(
        sql`UPDATE orders
            SET next_retry_at = NOW() + INTERVAL '60 seconds'
            WHERE id = ${row.id}`,
      );
    }

    return rows.map((row) => ({
      id: row.id,
      idempotencyKey: row.idempotency_key,
      warehouseId: row.warehouse_id,
      retryCount: row.retry_count,
    }));
  });
}

/**
 * Reconciles a single claimed order outside any long-held DB transaction.
 *
 * Queries the payment gateway (network I/O with no DB connection held),
 * then finalizes the order state in a short dedicated transaction.
 *
 * @param order - Claimed order row.
 * @param config - Worker configuration including the payment client.
 */
async function reconcileOneOrder(
  order: ClaimedOrder,
  config: ReconciliationWorkerConfig,
): Promise<void> {
  let gatewayStatus: PaymentStatus;

  try {
    gatewayStatus = await config.paymentClient.getStatus(order.idempotencyKey);
  } catch {
    await scheduleRetryOrDlq(order, config);
    return;
  }

  if (gatewayStatus === PaymentStatus.SUCCESS) {
    await db.update(Orders).set({ status: 'PAID' }).where(eq(Orders.id, order.id));
    return;
  }

  if (gatewayStatus === PaymentStatus.DECLINED || gatewayStatus === PaymentStatus.NOT_FOUND) {
    const orderItems = await db
      .select({ productId: OrderItems.productId, quantity: OrderItems.quantity })
      .from(OrderItems)
      .where(eq(OrderItems.orderId, order.id));

    await cancelPendingOrder(order.id, order.warehouseId, orderItems);
    return;
  }

  if (gatewayStatus === PaymentStatus.PENDING) {
    const nextRetryAt = computeNextRetryAt(order.retryCount, config.baseDelayMs);
    await db
      .update(Orders)
      .set({ status: 'PENDING_PAYMENT', nextRetryAt })
      .where(eq(Orders.id, order.id));
    return;
  }
}

/**
 * Schedules a retry with exponential backoff, or moves the order to DLQ
 * when retries are exhausted.
 *
 * @param order - Order that failed reconciliation.
 * @param config - Worker configuration with retry limits.
 */
async function scheduleRetryOrDlq(
  order: ClaimedOrder,
  config: ReconciliationWorkerConfig,
): Promise<void> {
  const newRetryCount = order.retryCount + 1;

  if (newRetryCount > config.maxRetries) {
    await db
      .update(Orders)
      .set({ status: 'DLQ', retryCount: newRetryCount })
      .where(eq(Orders.id, order.id));

    sendAlert({
      title: 'Reconciliation DLQ',
      message: 'Order exceeded max reconciliation retries and requires manual intervention',
      severity: 'critical',
      context: {
        orderId: order.id,
        idempotencyKey: order.idempotencyKey,
        warehouseId: order.warehouseId,
        retryCount: newRetryCount,
        maxRetries: config.maxRetries,
      },
    });
    return;
  }

  const nextRetryAt = computeNextRetryAt(order.retryCount, config.baseDelayMs);
  await db
    .update(Orders)
    .set({ status: 'PENDING_PAYMENT', retryCount: newRetryCount, nextRetryAt })
    .where(eq(Orders.id, order.id));
}

/**
 * Runs one reconciliation batch for stale `PENDING_PAYMENT` orders.
 *
 * Splits work into three phases to avoid holding a DB connection during network I/O:
 *   1. Claim batch — short transaction with `FOR UPDATE SKIP LOCKED`
 *   2. Gateway checks — network I/O with no DB connection held
 *   3. Finalize — short transaction per order to update status
 *
 * @param config - Worker configuration.
 * @returns Number of orders selected and reconciled in this cycle.
 */
export async function runReconciliationCycle(config: ReconciliationWorkerConfig): Promise<number> {
  const claimedOrders = await claimReconciliationBatch(config.batchSize);

  for (const order of claimedOrders) {
    await reconcileOneOrder(order, config);
  }

  return claimedOrders.length;
}
