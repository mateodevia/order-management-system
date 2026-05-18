import { eq, sql } from 'drizzle-orm';
import { db, reuseTransactionIfAvailable, type DbTransaction } from '@oms/shared/database';
import { AppError } from '@oms/shared/util-errors';
import { allocateInventoryGeospatially } from '@oms/inventory';
import { Orders } from './orders.schema';
import { OrderItems } from './order-items.schema';
import type { IPaymentClient } from '@oms/payments';
import type { IGeocodingClient } from '@oms/shared/geocoding';
import type { LockedInventoryRow, OrderItem } from '@oms/shared/types';

export interface OrderPayload {
  customerId: string;
  shippingAddress: string;
  items: OrderItem[];
}

export interface CreateOrderResult {
  status: number;
  data: {
    orderId: string;
    warehouseId: string;
    status: string;
    cached?: boolean;
  };
}

interface OrderServiceDeps {
  paymentClient: IPaymentClient;
  geocodingClient: IGeocodingClient;
}

function isIdempotencyKeyViolation(error: unknown): boolean {
  let current: unknown = error;
  while (current && typeof current === 'object') {
    const e = current as { code?: string; constraint?: string; cause?: unknown };
    if (e.code === '23505' && e.constraint === 'orders_idempotency_key_idx') {
      return true;
    }
    current = e.cause;
  }
  return false;
}

/**
 * Phase 1: DB-only reservation transaction.
 *
 * Geocodes the shipping address, allocates inventory from the closest warehouse,
 * inserts the order as PENDING_PAYMENT, and inserts order line items.
 * All within a single transaction with a statement timeout.
 * Returns the order ID and warehouse ID on success.
 */
interface ReservationResult {
  orderId: string;
  warehouseId: string;
  lockedRows: LockedInventoryRow[];
}

async function reserveInventory(
  payload: OrderPayload,
  idempotencyKey: string,
  geocodingClient: IGeocodingClient,
): Promise<ReservationResult> {
  const coords = await geocodingClient.geocode(payload.shippingAddress);
  const shippingLocation = { lat: coords.lat, lng: coords.lng };

  return db.transaction(async (tx: DbTransaction) => {
    const { warehouseId, lockedRows } = await allocateInventoryGeospatially(
      payload.items,
      shippingLocation,
      tx,
    );

    const [order] = await tx
      .insert(Orders)
      .values({
        customerId: payload.customerId,
        warehouseId,
        status: 'PENDING_PAYMENT',
        idempotencyKey,
      })
      .returning({ id: Orders.id });

    await tx.insert(OrderItems).values(
      payload.items.map((item) => {
        return {
          orderId: order.id,
          productId: item.productId,
          quantity: item.quantity,
        };
      }),
    );

    return { orderId: order.id, warehouseId, lockedRows };
  });
}

function computeOrderTotalAmount(items: OrderItem[], lockedRows: LockedInventoryRow[]): number {
  const unitPriceByProductId = new Map(lockedRows.map((r) => [r.productId, r.unitPrice]));
  return items.reduce((sum, item) => {
    const unitPrice = unitPriceByProductId.get(item.productId);
    return sum + item.quantity * unitPrice;
  }, 0);
}

/**
 * Phase 3 (compensation): Restores inventory and marks the order as FAILED.
 *
 * Called when Phase 2 payment fails. Runs in its own short transaction.
 */
export async function cancelPendingOrder(
  orderId: string,
  warehouseId: string,
  items: OrderPayload['items'],
  outerTx?: DbTransaction,
): Promise<void> {
  await reuseTransactionIfAvailable(outerTx, async (tx) => {
    await tx.update(Orders).set({ status: 'FAILED' }).where(eq(Orders.id, orderId));

    await Promise.all(
      items.map((item) =>
        tx.execute(
          sql`UPDATE inventory SET quantity = quantity + ${item.quantity} WHERE warehouse_id = ${warehouseId} AND product_id = ${item.productId}`,
        ),
      ),
    );
  });
}

/**
 * Executes the complete 3-phase order creation flow:
 *   Phase 1: Reserve inventory + insert order (single DB tx, no network I/O)
 *   Phase 2: Charge payment gateway (no open DB tx)
 *   Phase 3: Update order to PAID, or compensate on failure
 */
async function createOrderFlow(
  payload: OrderPayload,
  idempotencyKey: string,
  deps: OrderServiceDeps,
): Promise<CreateOrderResult> {
  // Phase 1: DB reservation
  const { orderId, warehouseId, lockedRows } = await reserveInventory(
    payload,
    idempotencyKey,
    deps.geocodingClient,
  );

  // Phase 2: Payment (no DB connection held)
  try {
    const chargeAmount = computeOrderTotalAmount(payload.items, lockedRows);

    await deps.paymentClient.charge({
      creditCardNumber: 'tok_visa_mock',
      amount: chargeAmount,
      description: `Order ${orderId}`,
      idempotencyKey,
    });

    // IMPORTANT: If the server crashes here, the order will be conciliated by the reconciliation cron job

    // Phase 3 (success path): Mark order as PAID
    await db.update(Orders).set({ status: 'PAID' }).where(eq(Orders.id, orderId));

    return {
      status: 201,
      data: { orderId, warehouseId, status: 'PAID' },
    };
  } catch {
    // Phase 3: Compensate — restore inventory and mark FAILED
    await cancelPendingOrder(orderId, warehouseId, payload.items);
    throw new AppError(402, 'Payment failed');
  }
}

/**
 * Creates an order with full idempotency control.
 *
 * Wraps the 3-phase flow and catches the Postgres 23505 unique violation on
 * `orders.idempotency_key` to implement the recovery logic:
 *   - PENDING_PAYMENT → 409 (in-flight)
 *   - PAID → 200 with cached response
 *   - FAILED → transparent retry (previous attempt restored inventory)
 */
export async function createOrderService(
  payload: OrderPayload,
  idempotencyKey: string,
  deps: OrderServiceDeps,
): Promise<CreateOrderResult> {
  try {
    return await createOrderFlow(payload, idempotencyKey, deps);
  } catch (error: unknown) {
    if (!isIdempotencyKeyViolation(error)) {
      throw error;
    }

    const [existingOrder] = await db
      .select()
      .from(Orders)
      .where(eq(Orders.idempotencyKey, idempotencyKey))
      .limit(1);

    if (!existingOrder) {
      throw new AppError(500, 'Idempotency anomaly: constraint violation but no row found');
    }

    if (existingOrder.status === 'PENDING_PAYMENT') {
      throw new AppError(409, 'An identical request is currently processing. Retry shortly.');
    }

    if (existingOrder.status === 'PAID' || existingOrder.status === 'FAILED') {
      return {
        status: 200,
        data: {
          orderId: existingOrder.id,
          warehouseId: existingOrder.warehouseId ?? '',
          status: existingOrder.status,
          cached: true,
        },
      };
    }

    throw new AppError(500, `Unexpected order status: ${existingOrder.status}`);
  }
}
