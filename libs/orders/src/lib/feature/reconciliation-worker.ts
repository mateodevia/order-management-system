import { eq, sql } from 'drizzle-orm';
import { db } from '@oms/shared/database';
import type { DbTransaction } from '@oms/shared/database';
import type { IPaymentClient } from '@oms/payments';
import { PaymentStatus } from '@oms/shared/types';
import { Orders } from '../data-access/orders.schema';
import { OrderItems } from '../data-access/order-items.schema';
import { cancelPendingOrder } from '../data-access/order-service';

export interface ReconciliationWorkerConfig {
  paymentClient: IPaymentClient;
  batchSize: number;
  maxRetries: number;
  baseDelayMs: number;
}

export function computeNextRetryAt(retryCount: number, baseDelayMs: number): Date {
  const exponentialDelay = baseDelayMs * Math.pow(2, retryCount);
  const jitter = Math.random() * exponentialDelay;
  return new Date(Date.now() + exponentialDelay + jitter);
}

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
      return;
    }

    const nextRetryAt = computeNextRetryAt(order.retryCount, config.baseDelayMs);
    await tx
      .update(Orders)
      .set({ retryCount: newRetryCount, nextRetryAt })
      .where(eq(Orders.id, order.id));
  }
}

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
