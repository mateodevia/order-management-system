import { eq, sql } from 'drizzle-orm';
import { db } from '@oms/shared/database';
import type { DbTransaction } from '@oms/shared/database';
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

/**
 * Reconciles a single stale `PENDING_PAYMENT` order within an open transaction.
 *
 * Queries the payment gateway, then marks PAID, compensates on terminal failure,
 * schedules a retry, or moves the order to DLQ when retries are exhausted.
 *
 * @param tx - Active database transaction (caller holds row locks).
 * @param order - Order row fields required for reconciliation.
 * @param config - Worker configuration including the payment client.
 */
async function reconcileOrder(
  tx: DbTransaction,
  order: { id: string; idempotencyKey: string; warehouseId: string; retryCount: number },
  config: ReconciliationWorkerConfig,
): Promise<void> {
  try {
    const status = await config.paymentClient.getStatus(order.idempotencyKey);

    if (status === PaymentStatus.SUCCESS) {
      await tx.update(Orders).set({ status: 'PAID' }).where(eq(Orders.id, order.id));
      return;
    }

    if (status === PaymentStatus.DECLINED || status === PaymentStatus.NOT_FOUND) {
      const orderItems = await tx
        .select({ productId: OrderItems.productId, quantity: OrderItems.quantity })
        .from(OrderItems)
        .where(eq(OrderItems.orderId, order.id));

      await cancelPendingOrder(order.id, order.warehouseId, orderItems, tx);
      return;
    }

    if (status === PaymentStatus.PENDING) {
      const nextRetryAt = computeNextRetryAt(order.retryCount, config.baseDelayMs);
      await tx.update(Orders).set({ nextRetryAt }).where(eq(Orders.id, order.id));
      return;
    }
  } catch {
    const newRetryCount = order.retryCount + 1;

    if (newRetryCount > config.maxRetries) {
      await tx
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
    await tx
      .update(Orders)
      .set({ retryCount: newRetryCount, nextRetryAt })
      .where(eq(Orders.id, order.id));
  }
}

/**
 * Runs one reconciliation batch for stale `PENDING_PAYMENT` orders.
 *
 * Selects eligible rows with `FOR UPDATE SKIP LOCKED`, reconciles each in the
 * same transaction, and returns how many orders were processed.
 *
 * @param config - Worker configuration.
 * @returns Number of orders selected and reconciled in this cycle.
 */
export async function runReconciliationCycle(config: ReconciliationWorkerConfig): Promise<number> {
  return db.transaction(async (tx) => {
    const result = await tx.execute(
      sql`SELECT id, idempotency_key, warehouse_id, retry_count, status
          FROM orders
          WHERE status = 'PENDING_PAYMENT'
            AND (next_retry_at IS NULL OR next_retry_at <= NOW())
          ORDER BY created_at ASC
          LIMIT ${config.batchSize}
          FOR UPDATE SKIP LOCKED`,
    );

    const orders = result.rows as Array<{
      id: string;
      idempotency_key: string;
      warehouse_id: string;
      retry_count: number;
      status: string;
    }>;

    for (const row of orders) {
      await reconcileOrder(
        tx,
        {
          id: row.id,
          idempotencyKey: row.idempotency_key,
          warehouseId: row.warehouse_id,
          retryCount: row.retry_count,
        },
        config,
      );
    }

    return orders.length;
  });
}
