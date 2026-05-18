import { sql } from 'drizzle-orm';
import { db } from '@oms/shared/database';
import type { OrderItem } from '@oms/shared/types';
import {
  decreaseInventory,
  lockClosestWarehouseInventory,
  LockedInventoryRow,
  InventoryUpdate,
} from '../data-access/inventory-queries';
import { AppError } from '@oms/shared/util-errors';

type Location = { lat: number; lng: number };
type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

function isPostgresStatementTimeout(e: unknown): boolean {
  let current: unknown = e;
  while (current && typeof current === 'object') {
    if ('code' in current && current.code === '57014') {
      return true;
    }
    current = 'cause' in current ? current.cause : undefined;
  }
  return false;
}

/**
 * Verifies that locked inventory rows still satisfy the order under READ COMMITTED.
 *
 * Between the routing query and `FOR UPDATE`, another transaction may have reduced
 * stock. Returns `false` when any line item is missing or below the requested qty.
 *
 * @param lockedRows - Rows returned by {@link lockClosestWarehouseInventory}.
 * @param requestedByProductId - Requested quantities keyed by product id.
 * @returns `true` when every locked row covers its requested quantity.
 */
function isLockSufficient(
  lockedRows: LockedInventoryRow[],
  requestedByProductId: Map<string, OrderItem>,
): boolean {
  for (const lockedRow of lockedRows) {
    const requested = requestedByProductId.get(lockedRow.productId);
    if (!requested || lockedRow.quantity < requested.qty) {
      return false;
    }
  }

  return true;
}

/**
 * Attempts to acquire locks on the closest single warehouse's inventory rows needed to fulfill all requested items,
 * retrying as long as the READ COMMITTED snapshot is stale (i.e., the locked rows do not cover requested quantities).
 * This loop mitigates the chance that inventory has changed between the routing query and lock acquisition,
 * ensuring the final locked snapshot actually satisfies the entire order.
 *
 * @param tx - The DbTransaction runner instance for the current Postgres transaction.
 * @param itemsJson - A JSON string representing the sorted order items to be fulfilled.
 * @param expectedItemCount - The total count of individual items expected in the locked result.
 * @param shippingLocation - The shipping location as { lat, lng } used for warehouse proximity calculations.
 * @param requestedByProductId - A map of productId to order item for quickly finding required quantities.
 * @returns Promise resolving to an array of LockedInventoryRow objects that are exclusively locked and fulfill the order.
 *
 * @throws {AppError} If no warehouse fulfills the order.
 */
async function lockInventoryWithReadCommittedRetry(
  tx: DbTransaction,
  itemsJson: string,
  expectedItemCount: number,
  shippingLocation: Location,
  requestedByProductId: Map<string, OrderItem>,
): Promise<LockedInventoryRow[]> {
  let lockedRows = await lockClosestWarehouseInventory(
    itemsJson,
    expectedItemCount,
    shippingLocation,
    tx,
  );

  while (!isLockSufficient(lockedRows, requestedByProductId)) {
    console.log('Lock acquired, but not sufficient, retrying...');
    lockedRows = await lockClosestWarehouseInventory(
      itemsJson,
      expectedItemCount,
      shippingLocation,
      tx,
    );
  }

  return lockedRows;
}

async function allocateInventoryGeospatiallyLogic(
  sortedItems: OrderItem[],
  requestedByProductId: Map<string, OrderItem>,
  shippingLocation: Location,
  tx: DbTransaction,
): Promise<string> {
  try {
    const startTime = Date.now();
    console.log('Allocated inventory started at', startTime);
    // Connection Pool Protection: kill this transaction after 3 seconds.
    await tx.execute(sql`SET LOCAL statement_timeout = '3000ms'`);

    const itemsJson = JSON.stringify(sortedItems);

    // Spatial Relational Division + Lock (retry while READ COMMITTED snapshot is stale)
    const lockedRows = await lockInventoryWithReadCommittedRetry(
      tx,
      itemsJson,
      sortedItems.length,
      shippingLocation,
      requestedByProductId,
    );

    // Decrement inventory while holding exclusive locks using a single UPDATE ... FROM json_array_elements.
    const fulfillingWarehouseId = lockedRows[0].warehouseId;
    const updates: InventoryUpdate[] = lockedRows
      .map((row) => {
        const requested = requestedByProductId.get(row.productId);
        if (!requested) return null;
        return { warehouseId: fulfillingWarehouseId, productId: row.productId, qty: requested.qty };
      })
      .filter((u): u is InventoryUpdate => u !== null);

    await decreaseInventory(updates, tx);

    const endTime = Date.now();
    console.log('Allocated inventory ended at', endTime);
    console.log('Allocated inventory took', endTime - startTime, 'ms');

    return fulfillingWarehouseId;
  } catch (e) {
    if (isPostgresStatementTimeout(e)) {
      console.error('Inventory allocation timed out');
      throw new AppError(503, 'could not acquire inventory lock');
    }
    throw e;
  }
}
/**
 * Allocates inventory for a set of order items by finding and locking inventory rows
 * from the geographically closest single warehouse that can fulfill all requested quantities.
 *
 * This function:
 *  - Sorts items by productId to prevent deadlocks when acquiring row-level locks.
 *  - Runs a transactional block with a 3-second statement timeout to avoid holding connections indefinitely.
 *  - Atomically:
 *    - Locates the closest qualifying warehouse via spatial query and locks its inventory rows.
 *    - Retries if the READ COMMITTED snapshot is stale (rows do not actually fulfill the order).
 *    - Decrements inventory, holding exclusive locks on all needed rows.
 *
 * @param {OrderItem[]} items - Array of order items, each specifying product and desired quantity.
 * @param {Location} shippingLocation - The shipping destination, used to compute proximity to warehouses.
 *
 * @returns {Promise<string>} - The ID of the selected and allocated warehouse.
 *
 * @throws {AppError} - If no warehouse can satisfy the entire order, or if inventory allocation times out.
 */
export async function allocateInventoryGeospatially(
  items: OrderItem[],
  shippingLocation: Location,
  tx?: DbTransaction,
): Promise<string> {
  // Deadlock Prevention: sort items lexically by productId before requesting locks.
  const sortedItems = [...items].sort((a, b) => a.productId.localeCompare(b.productId));
  const requestedByProductId = new Map(sortedItems.map((item) => [item.productId, item]));

  if (tx) {
    return await allocateInventoryGeospatiallyLogic(
      sortedItems,
      requestedByProductId,
      shippingLocation,
      tx,
    );
  }
  return db.transaction(async (tx) => {
    return await allocateInventoryGeospatiallyLogic(
      sortedItems,
      requestedByProductId,
      shippingLocation,
      tx,
    );
  });
}
