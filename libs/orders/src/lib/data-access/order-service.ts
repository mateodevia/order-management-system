import { eq, sql } from 'drizzle-orm';
import { db, reuseTransactionIfAvailable, type DbTransaction } from '@oms/shared/database';
import { AppError } from '@oms/shared/util-errors';
import { allocateInventoryGeospatially } from '@oms/inventory';
import { Orders } from './orders.schema';
import { OrderItems } from './order-items.schema';
import type { IPaymentClient } from '@oms/payments';
import type { IGeocodingClient } from '@oms/shared/geocoding';
import type { LockedInventoryRow, OrderItem } from '@oms/shared/types';

/** Validated input for the order creation flow. */
export interface OrderPayload {
  /** Customer placing the order. */
  customerId: string;
  /** Raw credit card number for the payment charge. */
  creditCardNumber: string;
  /** Free-text shipping address geocoded during Phase 1. */
  shippingAddress: string;
  /** Line items to fulfill from a single warehouse. */
  items: OrderItem[];
}

/** HTTP response envelope returned by {@link createOrderService}. */
export interface CreateOrderResult {
  /** HTTP status code (201, 200, or surfaced via thrown {@link AppError}). */
  status: number;
  data: {
    orderId: string;
    warehouseId: string;
    status: string;
    /** Present when the response is rebuilt from an existing idempotent order. */
    cached?: boolean;
  };
}

/** Injectable dependencies for the order creation orchestrator. */
interface OrderServiceDeps {
  /** Payment gateway used in Phase 2 and reconciliation. */
  paymentClient: IPaymentClient;
  /** Geocoding service used to resolve the shipping address in Phase 1. */
  geocodingClient: IGeocodingClient;
}

/**
 * Walks the error cause chain for a Postgres unique violation on `orders.idempotency_key`.
 *
 * @param error - Caught error from Phase 1 insert.
 * @returns `true` when the error is constraint `orders_idempotency_key_idx` (SQLSTATE 23505).
 */
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

/** Outcome of Phase 1 inventory reservation and order insert. */
interface ReservationResult {
  orderId: string;
  warehouseId: string;
  lockedRows: LockedInventoryRow[];
}

/**
 * Phase 1: geocode, allocate inventory, insert `PENDING_PAYMENT` order and line items.
 *
 * @param payload - Order input.
 * @param idempotencyKey - Client idempotency key stored on the order row.
 * @param geocodingClient - Address geocoding dependency.
 * @returns New order id, fulfilling warehouse id, and locked inventory rows (for pricing).
 */
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

/**
 * Sums line totals using unit prices from the locked inventory snapshot.
 *
 * @param items - Requested order line items.
 * @param lockedRows - Inventory rows locked during allocation (carry `unitPrice`).
 * @returns Charge amount in the smallest currency unit (e.g. cents).
 */
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
 * Uses `SELECT FOR UPDATE SKIP LOCKED` to prevent the double-restoration race
 * between the main flow's compensation and the reconciliation worker. If the
 * row is already locked by another process, this call becomes a safe no-op.
 *
 * @param orderId - Order to mark terminal.
 * @param warehouseId - Warehouse whose inventory rows are restored.
 * @param items - Line items whose quantities are added back to stock.
 * @param outerTx - Optional transaction to join (reconciliation passes its open tx).
 */
export async function cancelPendingOrder(
  orderId: string,
  warehouseId: string,
  items: OrderPayload['items'],
  outerTx?: DbTransaction,
): Promise<void> {
  await reuseTransactionIfAvailable(outerTx, async (tx) => {
    const locked = await tx.execute<{ id: string }>(
      sql`SELECT id FROM orders WHERE id = ${orderId} AND status = 'PENDING_PAYMENT' FOR UPDATE SKIP LOCKED`,
    );

    if (locked.rows.length === 0) {
      return;
    }

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
/**
 * Executes Phase 1 → Phase 2 → Phase 3 without idempotency recovery.
 *
 * @param payload - Order input.
 * @param idempotencyKey - Client idempotency key forwarded to the payment gateway.
 * @param deps - Payment and geocoding clients.
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
      creditCardNumber: payload.creditCardNumber,
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
 *
 * @param payload - Validated order input.
 * @param idempotencyKey - Client idempotency key from `x-idempotency-key`.
 * @param deps - Payment and geocoding clients.
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
