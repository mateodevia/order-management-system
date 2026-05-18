import { sql } from 'drizzle-orm';
import { db } from '@oms/shared/database';
import { AppError } from '@oms/shared/util-errors';
import { inventory } from './inventory.schema';

type Location = { lat: number; lng: number };
type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type LockedInventoryRow = {
  warehouseId: string;
  productId: string;
  quantity: number;
};

/**
 * Attempts to acquire row-level locks on inventory entries for the closest single warehouse
 * that can fulfill all requested order items.
 *
 * - Uses a CTE to parse the order items from JSON and determines which warehouses (if any)
 *   have sufficient stock for every item.
 * - Chooses the nearest qualifying warehouse to the provided shipping location (using PostGIS).
 * - Locks, in deterministic product_id order, all relevant inventory rows within the selected warehouse.
 *
 * @param tx - The database transaction runner for the current Postgres transaction context.
 * @param itemsJson - JSON string representing the array of order items ({ productId, qty }).
 * @param expectedItemCount - The expected number of distinct items to be locked (should match order).
 * @param shippingLocation - The target shipping location ({ lat, lng }) for proximity routing.
 * @returns Promise resolving to the locked inventory rows for the qualifying, chosen warehouse.
 * @throws {AppError} If no single warehouse is found that can fulfill the complete order.
 */
export async function lockClosestWarehouseInventory(
  itemsJson: string,
  expectedItemCount: number,
  shippingLocation: Location,
  tx: DbTransaction,
) {
  const res = await tx.execute<LockedInventoryRow>(sql`
    WITH requested_items AS (
      SELECT
        (value->>'productId')::uuid AS product_id,
        (value->>'qty')::int AS required_qty
      FROM json_array_elements(${itemsJson}::json)
    ),
    closest_warehouse AS (
      SELECT w.id
      FROM warehouses w
      WHERE NOT EXISTS (
          SELECT 1
          FROM requested_items ri
          LEFT JOIN inventory i
            ON i.warehouse_id = w.id AND i.product_id = ri.product_id
          WHERE i.quantity IS NULL OR i.quantity < ri.required_qty
      )
      ORDER BY w.location <-> ST_SetSRID(ST_MakePoint(${shippingLocation.lng}, ${shippingLocation.lat}), 4326)::geography
      LIMIT 1
    )
    SELECT
      i.warehouse_id as "warehouseId",
      i.product_id as "productId",
      i.quantity
    FROM inventory i
    JOIN closest_warehouse cw ON i.warehouse_id = cw.id
    WHERE i.product_id IN (SELECT product_id FROM requested_items)
    ORDER BY i.product_id ASC
    FOR UPDATE OF i
  `);

  if (res.rows.length !== expectedItemCount) {
    console.error('No single warehouse has sufficient stock to fulfill the entire order.');
    throw new AppError(
      422,
      'No single warehouse has sufficient stock to fulfill the entire order.',
    );
  }

  return res.rows;
}

export type InventoryUpdate = { warehouseId: string; productId: string; qty: number };

export async function decreaseInventory(updates: InventoryUpdate[], tx: DbTransaction) {
  await Promise.all(
    updates.map((u) =>
      tx
        .update(inventory)
        .set({ quantity: sql`${inventory.quantity} - ${u.qty}` })
        .where(
          sql`${inventory.warehouseId} = ${u.warehouseId} AND ${inventory.productId} = ${u.productId}`,
        ),
    ),
  );
}
