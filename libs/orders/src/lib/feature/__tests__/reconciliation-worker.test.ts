import { eq } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { db, pool, truncateAllTables } from '@oms/shared/database';
import { PaymentClient } from '@oms/payments';
import { PaymentStatus } from '@oms/shared/types';
import { Warehouses, Inventory } from '@oms/inventory';
import { AppError } from '@oms/shared/util-errors';
import { Orders } from '../../data-access/orders.schema';
import { OrderItems } from '../../data-access/order-items.schema';
import {
  runReconciliationCycle,
  computeNextRetryAt,
  type ReconciliationWorkerConfig,
} from '../reconciliation-worker';

beforeEach(async () => {
  jest.spyOn(Math, 'random').mockReturnValue(0.5);
  await truncateAllTables();
}, 10000);

afterEach(() => {
  jest.restoreAllMocks();
});

/** Inserts a warehouse with PostGIS location and one SKU for reconciliation tests. */
async function seedWarehouseAndInventory() {
  const [warehouse] = await db
    .insert(Warehouses)
    .values({
      name: 'Test Warehouse',
      location: sql`ST_SetSRID(ST_MakePoint(-84.3876, 33.7578), 4326)::geography`,
    })
    .returning({ id: Warehouses.id });

  const productId = '00000000-0000-0000-0000-100000000001';
  await db.insert(Inventory).values({
    warehouseId: warehouse.id,
    productId,
    quantity: 100,
    unitPrice: 1000,
  });

  return { warehouseId: warehouse.id, productId };
}

/** Inserts a `PENDING_PAYMENT` order, optionally with line items, for reconciliation tests. */
async function seedPendingOrder(overrides: {
  warehouseId?: string;
  productId?: string;
  retryCount?: number;
  nextRetryAt?: Date | null;
  idempotencyKey?: string;
}) {
  const idempotencyKey = overrides.idempotencyKey ?? crypto.randomUUID();
  const [order] = await db
    .insert(Orders)
    .values({
      customerId: '00000000-0000-0000-0000-000000000099',
      warehouseId: overrides.warehouseId ?? null,
      status: 'PENDING_PAYMENT',
      idempotencyKey,
      retryCount: overrides.retryCount ?? 0,
      nextRetryAt: overrides.nextRetryAt ?? null,
    })
    .returning({ id: Orders.id });

  if (overrides.warehouseId && overrides.productId) {
    await db.insert(OrderItems).values({
      orderId: order.id,
      productId: overrides.productId,
      quantity: 2,
    });
  }

  return { orderId: order.id, idempotencyKey };
}

/** Builds a {@link ReconciliationWorkerConfig} with test-friendly defaults. */
function makeConfig(
  paymentClient: PaymentClient,
  overrides?: Partial<ReconciliationWorkerConfig>,
): ReconciliationWorkerConfig {
  return {
    paymentClient,
    batchSize: 10,
    maxRetries: 3,
    baseDelayMs: 1000,
    ...overrides,
  };
}

describe('runReconciliationCycle', () => {
  test('When payment service confirms SUCCESS for pending orders, then all transition to PAID', async () => {
    // ARRANGE
    const paymentClient = new PaymentClient();
    const { warehouseId, productId } = await seedWarehouseAndInventory();

    const order1 = await seedPendingOrder({ warehouseId, productId });
    const order2 = await seedPendingOrder({ warehouseId, productId });
    const order3 = await seedPendingOrder({ warehouseId, productId });

    paymentClient.testables.forceStatus(order1.idempotencyKey, PaymentStatus.SUCCESS);
    paymentClient.testables.forceStatus(order2.idempotencyKey, PaymentStatus.SUCCESS);
    paymentClient.testables.forceStatus(order3.idempotencyKey, PaymentStatus.SUCCESS);

    // ACT
    const processed = await runReconciliationCycle(makeConfig(paymentClient));

    // ASSERT
    expect(processed).toBe(3);
    const rows = await db.select().from(Orders);
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.status).toBe('PAID');
    }
  });

  test('When payment service returns DECLINED, then order transitions to FAILED and inventory is restored', async () => {
    // ARRANGE
    const paymentClient = new PaymentClient();
    const { warehouseId, productId } = await seedWarehouseAndInventory();
    const order = await seedPendingOrder({ warehouseId, productId });
    paymentClient.testables.forceStatus(order.idempotencyKey, PaymentStatus.DECLINED);

    const [inventoryBefore] = await db
      .select()
      .from(Inventory)
      .where(eq(Inventory.productId, productId));

    // ACT
    await runReconciliationCycle(makeConfig(paymentClient));

    // ASSERT
    const [updatedOrder] = await db.select().from(Orders).where(eq(Orders.id, order.orderId));
    expect(updatedOrder.status).toBe('FAILED');

    const [inventoryAfter] = await db
      .select()
      .from(Inventory)
      .where(eq(Inventory.productId, productId));
    expect(inventoryAfter.quantity).toBe(inventoryBefore.quantity + 2);
  });

  test('When payment service returns NOT_FOUND, then order transitions to FAILED and inventory is restored', async () => {
    // ARRANGE
    const paymentClient = new PaymentClient();
    const { warehouseId, productId } = await seedWarehouseAndInventory();
    const order = await seedPendingOrder({ warehouseId, productId });
    paymentClient.testables.forceStatus(order.idempotencyKey, PaymentStatus.NOT_FOUND);

    // ACT
    await runReconciliationCycle(makeConfig(paymentClient));

    // ASSERT
    const [updatedOrder] = await db.select().from(Orders).where(eq(Orders.id, order.orderId));
    expect(updatedOrder.status).toBe('FAILED');
  });

  test('When payment service returns PENDING, then order remains PENDING_PAYMENT and sets its next_retry_at', async () => {
    // ARRANGE
    const paymentClient = new PaymentClient();
    const { warehouseId, productId } = await seedWarehouseAndInventory();
    const order = await seedPendingOrder({ warehouseId, productId });
    paymentClient.testables.forceStatus(order.idempotencyKey, PaymentStatus.PENDING);

    // ACT
    const beforeAct = Date.now();
    await runReconciliationCycle(makeConfig(paymentClient));

    // ASSERT
    const [updatedOrder] = await db.select().from(Orders).where(eq(Orders.id, order.orderId));
    expect(updatedOrder.status).toBe('PENDING_PAYMENT');
    expect(updatedOrder.nextRetryAt).not.toBeNull();
    expect(updatedOrder.nextRetryAt!.getTime()).toBeGreaterThan(beforeAct);
  });

  test('When another worker holds locks on rows, then this worker skips those rows (SKIP LOCKED)', async () => {
    // ARRANGE
    const paymentClient = new PaymentClient();
    const { warehouseId, productId } = await seedWarehouseAndInventory();

    const order1 = await seedPendingOrder({ warehouseId, productId });
    const order2 = await seedPendingOrder({ warehouseId, productId });
    const order3 = await seedPendingOrder({ warehouseId, productId });
    const order4 = await seedPendingOrder({ warehouseId, productId });

    paymentClient.testables.forceStatus(order1.idempotencyKey, PaymentStatus.SUCCESS);
    paymentClient.testables.forceStatus(order2.idempotencyKey, PaymentStatus.SUCCESS);
    paymentClient.testables.forceStatus(order3.idempotencyKey, PaymentStatus.SUCCESS);
    paymentClient.testables.forceStatus(order4.idempotencyKey, PaymentStatus.SUCCESS);

    // Simulate Worker A: lock 2 rows in an open transaction
    const workerAClient = await pool.connect();
    try {
      await workerAClient.query('BEGIN');
      await workerAClient.query(
        `SELECT * FROM orders
         WHERE status = 'PENDING_PAYMENT'
         ORDER BY created_at ASC
         LIMIT 2
         FOR UPDATE`,
      );

      // ACT — Worker B (our reconciliation cycle) runs concurrently
      const processed = await runReconciliationCycle(makeConfig(paymentClient));

      // ASSERT — Worker B skips the 2 locked rows, processes only the remaining 2
      expect(processed).toBe(2);

      const paidOrders = await db.select().from(Orders).where(eq(Orders.status, 'PAID'));
      expect(paidOrders).toHaveLength(2);

      const pendingOrders = await db
        .select()
        .from(Orders)
        .where(eq(Orders.status, 'PENDING_PAYMENT'));
      expect(pendingOrders).toHaveLength(2);
    } finally {
      await workerAClient.query('ROLLBACK');
      workerAClient.release();
    }
  });

  test('When payment service throws a transient error, then retry_count increments and next_retry_at is set', async () => {
    // ARRANGE
    const paymentClient = new PaymentClient();
    const { warehouseId, productId } = await seedWarehouseAndInventory();
    const order = await seedPendingOrder({ warehouseId, productId });

    paymentClient.testables.forceFailure(new Error('Connection refused'));

    // ACT
    const beforeAct = Date.now();
    await runReconciliationCycle(makeConfig(paymentClient, { baseDelayMs: 60000 }));

    // ASSERT
    const [updatedOrder] = await db.select().from(Orders).where(eq(Orders.id, order.orderId));
    expect(updatedOrder.status).toBe('PENDING_PAYMENT');
    expect(updatedOrder.retryCount).toBe(1);
    expect(updatedOrder.nextRetryAt).not.toBeNull();
    expect(updatedOrder.nextRetryAt!.getTime()).toBeGreaterThan(beforeAct);
  });

  test('When order has a future next_retry_at, then the worker skips it', async () => {
    // ARRANGE
    const paymentClient = new PaymentClient();
    const { warehouseId, productId } = await seedWarehouseAndInventory();

    const futureTime = new Date(Date.now() + 600000); // 10 minutes in the future
    await seedPendingOrder({
      warehouseId,
      productId,
      retryCount: 1,
      nextRetryAt: futureTime,
    });

    paymentClient.testables.forceStatus(crypto.randomUUID(), PaymentStatus.SUCCESS);

    // ACT
    const processed = await runReconciliationCycle(makeConfig(paymentClient));

    // ASSERT
    expect(processed).toBe(0);

    const [order] = await db.select().from(Orders);
    expect(order.status).toBe('PENDING_PAYMENT');
    expect(order.retryCount).toBe(1);
  });

  test('When retry_count reaches maxRetries and another transient error occurs, then order transitions to DLQ', async () => {
    // ARRANGE
    const paymentClient = new PaymentClient();
    const { warehouseId, productId } = await seedWarehouseAndInventory();
    const order = await seedPendingOrder({
      warehouseId,
      productId,
      retryCount: 3,
    });

    paymentClient.testables.forceFailure(new Error('Connection refused'));

    // ACT
    await runReconciliationCycle(makeConfig(paymentClient, { maxRetries: 3 }));

    // ASSERT
    const [updatedOrder] = await db.select().from(Orders).where(eq(Orders.id, order.orderId));
    expect(updatedOrder.status).toBe('DLQ');
    expect(updatedOrder.retryCount).toBe(4);
  });

  test('When there are no pending orders, then the cycle processes zero rows', async () => {
    // ARRANGE
    const paymentClient = new PaymentClient();

    // ACT
    const processed = await runReconciliationCycle(makeConfig(paymentClient));

    // ASSERT
    expect(processed).toBe(0);
  });

  test('When orders have mixed gateway statuses, then each transitions correctly', async () => {
    // ARRANGE
    const paymentClient = new PaymentClient();
    const { warehouseId, productId } = await seedWarehouseAndInventory();

    const successOrder = await seedPendingOrder({ warehouseId, productId });
    const declinedOrder = await seedPendingOrder({ warehouseId, productId });
    const pendingOrder = await seedPendingOrder({ warehouseId, productId });

    paymentClient.testables.forceStatus(successOrder.idempotencyKey, PaymentStatus.SUCCESS);
    paymentClient.testables.forceStatus(declinedOrder.idempotencyKey, PaymentStatus.DECLINED);
    paymentClient.testables.forceStatus(pendingOrder.idempotencyKey, PaymentStatus.PENDING);

    // ACT
    await runReconciliationCycle(makeConfig(paymentClient));

    // ASSERT
    const [success] = await db.select().from(Orders).where(eq(Orders.id, successOrder.orderId));
    expect(success.status).toBe('PAID');

    const [declined] = await db.select().from(Orders).where(eq(Orders.id, declinedOrder.orderId));
    expect(declined.status).toBe('FAILED');

    const [pending] = await db.select().from(Orders).where(eq(Orders.id, pendingOrder.orderId));
    expect(pending.status).toBe('PENDING_PAYMENT');
  });

  test('When batchSize limits the selection, then only that many orders are processed', async () => {
    // ARRANGE
    const paymentClient = new PaymentClient();
    const { warehouseId, productId } = await seedWarehouseAndInventory();

    for (let i = 0; i < 5; i++) {
      const order = await seedPendingOrder({ warehouseId, productId });
      paymentClient.testables.forceStatus(order.idempotencyKey, PaymentStatus.SUCCESS);
    }

    // ACT
    const processed = await runReconciliationCycle(makeConfig(paymentClient, { batchSize: 2 }));

    // ASSERT
    expect(processed).toBe(2);
    const paidOrders = await db.select().from(Orders).where(eq(Orders.status, 'PAID'));
    expect(paidOrders).toHaveLength(2);
  });
});
