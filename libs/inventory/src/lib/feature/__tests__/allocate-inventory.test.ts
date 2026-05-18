import { sql, eq, and } from 'drizzle-orm';
import { db, pool, truncateAllTables } from '@oms/shared/database';
import { Pool } from 'pg';
import { warehouses } from '../../data-access/warehouses.schema';
import { inventory } from '../../data-access/inventory.schema';
import { AppError } from '@oms/shared/util-errors';
import { allocateInventoryGeospatially } from '../allocate-inventory';

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await truncateAllTables();
});

describe('allocateInventoryGeospatially', () => {
  describe('business logic', () => {
    test('When the nearest warehouse is missing an item, then it bypasses it and selects the farther fully-stocked warehouse', async () => {
      // ARRANGE
      // Warehouse A: 5km away from customer, missing 1 of 3 items
      const [warehouseA] = await db
        .insert(warehouses)
        .values({
          name: 'Close Incomplete Warehouse',
          location: sql`ST_SetSRID(ST_MakePoint(-73.9857, 40.7484), 4326)::geography`,
        })
        .returning({ id: warehouses.id });

      // Warehouse B: 50km away from customer, has all 3 items
      const [warehouseB] = await db
        .insert(warehouses)
        .values({
          name: 'Far Complete Warehouse',
          location: sql`ST_SetSRID(ST_MakePoint(-74.5, 40.2), 4326)::geography`,
        })
        .returning({ id: warehouses.id });

      const product1 = '00000000-0000-0000-0000-000000000101';
      const product2 = '00000000-0000-0000-0000-000000000102';
      const product3 = '00000000-0000-0000-0000-000000000103';

      // Warehouse A only has 2 of 3 products
      await db.insert(inventory).values([
        { warehouseId: warehouseA.id, productId: product1, quantity: 100 },
        { warehouseId: warehouseA.id, productId: product2, quantity: 100 },
        // Warehouse B has all 3
        { warehouseId: warehouseB.id, productId: product1, quantity: 50 },
        { warehouseId: warehouseB.id, productId: product2, quantity: 50 },
        { warehouseId: warehouseB.id, productId: product3, quantity: 50 },
      ]);

      // Customer near Warehouse A
      const shippingLocation = { lat: 40.7128, lng: -74.006 };

      // ACT
      const result = await allocateInventoryGeospatially(
        [
          { productId: product1, qty: 5 },
          { productId: product2, qty: 5 },
          { productId: product3, qty: 5 },
        ],
        shippingLocation,
      );

      // ASSERT
      expect(result).toBe(warehouseB.id);
    });

    test('When no single warehouse stocks all items (split-warehouse), then it throws a 422 AppError', async () => {
      // ARRANGE
      const [warehouseA] = await db
        .insert(warehouses)
        .values({
          name: 'Warehouse A',
          location: sql`ST_SetSRID(ST_MakePoint(-74.006, 40.7128), 4326)::geography`,
        })
        .returning({ id: warehouses.id });

      const [warehouseB] = await db
        .insert(warehouses)
        .values({
          name: 'Warehouse B',
          location: sql`ST_SetSRID(ST_MakePoint(-73.9857, 40.7484), 4326)::geography`,
        })
        .returning({ id: warehouses.id });

      const productX = '00000000-0000-0000-0000-000000000201';
      const productY = '00000000-0000-0000-0000-000000000202';

      // A has X but not Y; B has Y but not X
      await db.insert(inventory).values([
        { warehouseId: warehouseA.id, productId: productX, quantity: 100 },
        { warehouseId: warehouseB.id, productId: productY, quantity: 100 },
      ]);

      // ACT
      const promise = allocateInventoryGeospatially(
        [
          { productId: productX, qty: 5 },
          { productId: productY, qty: 5 },
        ],
        { lat: 40.7128, lng: -74.006 },
      );

      // ASSERT
      await expect(promise).rejects.toMatchObject({ statusCode: 422 });
    });

    test('When multiple warehouses qualify, then it selects the closest one to the shipping location', async () => {
      // ARRANGE
      const [warehouseClose] = await db
        .insert(warehouses)
        .values({
          name: 'Close Warehouse',
          location: sql`ST_SetSRID(ST_MakePoint(-74.006, 40.7128), 4326)::geography`,
        })
        .returning({ id: warehouses.id });

      const [warehouseFar] = await db
        .insert(warehouses)
        .values({
          name: 'Far Warehouse',
          location: sql`ST_SetSRID(ST_MakePoint(-74.5, 40.2), 4326)::geography`,
        })
        .returning({ id: warehouses.id });

      const productId = '00000000-0000-0000-0000-000000000501';

      await db.insert(inventory).values([
        { warehouseId: warehouseClose.id, productId, quantity: 20 },
        { warehouseId: warehouseFar.id, productId, quantity: 20 },
      ]);

      // Customer is at the same coordinates as the close warehouse
      const shippingLocation = { lat: 40.7128, lng: -74.006 };

      // ACT
      const result = await allocateInventoryGeospatially([{ productId, qty: 3 }], shippingLocation);

      // ASSERT
      expect(result).toBe(warehouseClose.id);
    });

    test('When a single warehouse has a single product with sufficient stock, then it allocates and decrements correctly', async () => {
      // ARRANGE
      const [warehouse] = await db
        .insert(warehouses)
        .values({
          name: 'Only Warehouse',
          location: sql`ST_SetSRID(ST_MakePoint(-74.006, 40.7128), 4326)::geography`,
        })
        .returning({ id: warehouses.id });

      const productId = '00000000-0000-0000-0000-000000000a01';

      await db.insert(inventory).values({
        warehouseId: warehouse.id,
        productId,
        quantity: 50,
      });

      // ACT
      const result = await allocateInventoryGeospatially([{ productId, qty: 10 }], {
        lat: 40.7128,
        lng: -74.006,
      });

      // ASSERT
      expect(result).toBe(warehouse.id);

      const [row] = await db
        .select()
        .from(inventory)
        .where(and(eq(inventory.warehouseId, warehouse.id), eq(inventory.productId, productId)));
      expect(row.quantity).toBe(40);
    });

    test('When the nearest warehouse has insufficient quantity for one item, then it falls back to a farther warehouse', async () => {
      // ARRANGE
      const [warehouseClose] = await db
        .insert(warehouses)
        .values({
          name: 'Close Low-Stock Warehouse',
          location: sql`ST_SetSRID(ST_MakePoint(-74.006, 40.7128), 4326)::geography`,
        })
        .returning({ id: warehouses.id });

      const [warehouseFar] = await db
        .insert(warehouses)
        .values({
          name: 'Far Full-Stock Warehouse',
          location: sql`ST_SetSRID(ST_MakePoint(-74.5, 40.2), 4326)::geography`,
        })
        .returning({ id: warehouses.id });

      const productId = '00000000-0000-0000-0000-000000000b01';

      // Close warehouse has the product but not enough quantity
      await db.insert(inventory).values([
        { warehouseId: warehouseClose.id, productId, quantity: 3 },
        { warehouseId: warehouseFar.id, productId, quantity: 50 },
      ]);

      // ACT — request 10 units, close warehouse only has 3
      const result = await allocateInventoryGeospatially([{ productId, qty: 10 }], {
        lat: 40.7128,
        lng: -74.006,
      });

      // ASSERT
      expect(result).toBe(warehouseFar.id);
    });

    test('When a multi-item order is fulfilled, then each product quantity is decremented correctly', async () => {
      // ARRANGE
      const [warehouse] = await db
        .insert(warehouses)
        .values({
          name: 'Multi-Item Warehouse',
          location: sql`ST_SetSRID(ST_MakePoint(-74.006, 40.7128), 4326)::geography`,
        })
        .returning({ id: warehouses.id });

      const product1 = '00000000-0000-0000-0000-000000000c01';
      const product2 = '00000000-0000-0000-0000-000000000c02';
      const product3 = '00000000-0000-0000-0000-000000000c03';

      await db.insert(inventory).values([
        { warehouseId: warehouse.id, productId: product1, quantity: 100 },
        { warehouseId: warehouse.id, productId: product2, quantity: 50 },
        { warehouseId: warehouse.id, productId: product3, quantity: 25 },
      ]);

      // ACT
      const result = await allocateInventoryGeospatially(
        [
          { productId: product1, qty: 7 },
          { productId: product2, qty: 3 },
          { productId: product3, qty: 12 },
        ],
        { lat: 40.7128, lng: -74.006 },
      );

      // ASSERT
      expect(result).toBe(warehouse.id);

      const rows = await db.select().from(inventory).where(eq(inventory.warehouseId, warehouse.id));

      const byProduct = new Map(rows.map((r) => [r.productId, r.quantity]));
      expect(byProduct.get(product1)).toBe(93);
      expect(byProduct.get(product2)).toBe(47);
      expect(byProduct.get(product3)).toBe(13);
    });

    test('When coordinates are at extreme boundary values, then it still processes correctly', async () => {
      // ARRANGE - warehouse at the international date line
      const [warehouse] = await db
        .insert(warehouses)
        .values({
          name: 'Date Line Warehouse',
          location: sql`ST_SetSRID(ST_MakePoint(179.9, -45.0), 4326)::geography`,
        })
        .returning({ id: warehouses.id });

      const productId = '00000000-0000-0000-0000-000000000701';

      await db.insert(inventory).values({
        warehouseId: warehouse.id,
        productId,
        quantity: 50,
      });

      // ACT - shipping location also near date line
      const result = await allocateInventoryGeospatially([{ productId, qty: 2 }], {
        lat: -44.5,
        lng: 179.5,
      });

      // ASSERT
      expect(result).toBe(warehouse.id);

      const [row] = await db
        .select()
        .from(inventory)
        .where(and(eq(inventory.warehouseId, warehouse.id), eq(inventory.productId, productId)));
      expect(row.quantity).toBe(48);
    });

    test('When stock is exactly equal to the requested quantity, then allocation succeeds with zero remaining', async () => {
      // ARRANGE
      const [warehouse] = await db
        .insert(warehouses)
        .values({
          name: 'Exact Stock Warehouse',
          location: sql`ST_SetSRID(ST_MakePoint(-74.006, 40.7128), 4326)::geography`,
        })
        .returning({ id: warehouses.id });

      const productId = '00000000-0000-0000-0000-000000000801';

      await db.insert(inventory).values({
        warehouseId: warehouse.id,
        productId,
        quantity: 7,
      });

      // ACT
      const result = await allocateInventoryGeospatially([{ productId, qty: 7 }], {
        lat: 40.7128,
        lng: -74.006,
      });

      // ASSERT
      expect(result).toBe(warehouse.id);

      const [row] = await db
        .select()
        .from(inventory)
        .where(and(eq(inventory.warehouseId, warehouse.id), eq(inventory.productId, productId)));
      expect(row.quantity).toBe(0);
    });

    test('When no warehouses exist, then it throws a 422 AppError', async () => {
      // ARRANGE — no warehouses, no inventory
      const productId = '00000000-0000-0000-0000-000000000d01';

      // ACT
      const promise = allocateInventoryGeospatially([{ productId, qty: 1 }], {
        lat: 40.7128,
        lng: -74.006,
      });

      // ASSERT
      await expect(promise).rejects.toMatchObject({ statusCode: 422 });
    });

    test('When the first allocation depletes the closest warehouse, then the next allocation routes to the second closest', async () => {
      // ARRANGE
      const [warehouseClose] = await db
        .insert(warehouses)
        .values({
          name: 'Close Warehouse',
          location: sql`ST_SetSRID(ST_MakePoint(-74.006, 40.7128), 4326)::geography`,
        })
        .returning({ id: warehouses.id });

      const [warehouseFar] = await db
        .insert(warehouses)
        .values({
          name: 'Far Warehouse',
          location: sql`ST_SetSRID(ST_MakePoint(-74.5, 40.2), 4326)::geography`,
        })
        .returning({ id: warehouses.id });

      const productId = '00000000-0000-0000-0000-000000000e01';

      await db.insert(inventory).values([
        { warehouseId: warehouseClose.id, productId, quantity: 5 },
        { warehouseId: warehouseFar.id, productId, quantity: 10 },
      ]);

      const shippingLocation = { lat: 40.7128, lng: -74.006 };

      // ACT — first allocation depletes close warehouse
      const first = await allocateInventoryGeospatially([{ productId, qty: 5 }], shippingLocation);

      // Second allocation must fall back to far warehouse (close is now at 0)
      const second = await allocateInventoryGeospatially([{ productId, qty: 3 }], shippingLocation);

      // ASSERT
      expect(first).toBe(warehouseClose.id);
      expect(second).toBe(warehouseFar.id);

      const rows = await db.select().from(inventory).where(eq(inventory.productId, productId));
      const byWarehouse = new Map(rows.map((r) => [r.warehouseId, r.quantity]));
      expect(byWarehouse.get(warehouseClose.id)).toBe(0);
      expect(byWarehouse.get(warehouseFar.id)).toBe(7);
    });
  });

  describe('concurrency edge cases', () => {
    test('When two concurrent allocations compete for limited stock on a single warehouse, then one succeeds and the other throws 422', async () => {
      // ARRANGE — single warehouse with stock for only one of the two requests
      const [warehouse] = await db
        .insert(warehouses)
        .values({
          name: 'Limited Stock Warehouse',
          location: sql`ST_SetSRID(ST_MakePoint(-74.006, 40.7128), 4326)::geography`,
        })
        .returning({ id: warehouses.id });

      const productId = '00000000-0000-0000-0000-000000000301';

      await db.insert(inventory).values({
        warehouseId: warehouse.id,
        productId,
        quantity: 5,
      });

      // ACT — two concurrent requests for 3 units each (only 5 available)
      const results = await Promise.allSettled([
        allocateInventoryGeospatially([{ productId, qty: 3 }], { lat: 40.7128, lng: -74.006 }),
        allocateInventoryGeospatially([{ productId, qty: 3 }], { lat: 40.7128, lng: -74.006 }),
      ]);

      // ASSERT
      const fulfilled = results.filter(
        (r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled',
      );
      const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      // Winner was routed to the only warehouse
      expect(fulfilled[0].value).toBe(warehouse.id);

      expect(rejected[0].reason).toBeInstanceOf(AppError);
      expect((rejected[0].reason as AppError).statusCode).toBe(422);

      // Inventory must reflect exactly one successful decrement (5 - 3 = 2)
      const [row] = await db
        .select()
        .from(inventory)
        .where(and(eq(inventory.warehouseId, warehouse.id), eq(inventory.productId, productId)));
      expect(row.quantity).toBe(2);
    });

    test('When three concurrent allocations contend for the closest warehouse but alternatives exist, then all succeed on different warehouses', async () => {
      // ARRANGE — three warehouses at increasing distances, each with stock for exactly one order
      const [warehouseClose] = await db
        .insert(warehouses)
        .values({
          name: 'Close Warehouse',
          location: sql`ST_SetSRID(ST_MakePoint(-74.006, 40.7128), 4326)::geography`,
        })
        .returning({ id: warehouses.id });

      const [warehouseMid] = await db
        .insert(warehouses)
        .values({
          name: 'Mid Warehouse',
          location: sql`ST_SetSRID(ST_MakePoint(-74.2, 40.6), 4326)::geography`,
        })
        .returning({ id: warehouses.id });

      const [warehouseFar] = await db
        .insert(warehouses)
        .values({
          name: 'Far Warehouse',
          location: sql`ST_SetSRID(ST_MakePoint(-74.5, 40.2), 4326)::geography`,
        })
        .returning({ id: warehouses.id });

      const productId = '00000000-0000-0000-0000-000000000302';

      // Each warehouse has exactly 5 units — enough for one order of qty=5
      await db.insert(inventory).values([
        { warehouseId: warehouseClose.id, productId, quantity: 5 },
        { warehouseId: warehouseMid.id, productId, quantity: 5 },
        { warehouseId: warehouseFar.id, productId, quantity: 5 },
      ]);

      const shippingLocation = { lat: 40.7128, lng: -74.006 };

      // ACT — three concurrent requests, each for exactly 5 units
      const results = await Promise.allSettled([
        allocateInventoryGeospatially([{ productId, qty: 5 }], shippingLocation),
        allocateInventoryGeospatially([{ productId, qty: 5 }], shippingLocation),
        allocateInventoryGeospatially([{ productId, qty: 5 }], shippingLocation),
      ]);

      // ASSERT — all three must succeed
      const fulfilled = results.filter(
        (r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled',
      );
      expect(fulfilled).toHaveLength(3);

      // Each must have been routed to a different warehouse
      const assignedWarehouseIds = fulfilled.map((r) => r.value).sort();
      const allWarehouseIds = [warehouseClose.id, warehouseMid.id, warehouseFar.id].sort();
      expect(assignedWarehouseIds).toEqual(allWarehouseIds);

      // Every warehouse's inventory must be fully depleted (5 - 5 = 0)
      const rows = await db.select().from(inventory).where(eq(inventory.productId, productId));
      for (const row of rows) {
        expect(row.quantity).toBe(0);
      }
    });

    test('When two concurrent orders request different products from the same warehouse, then both succeed without blocking each other', async () => {
      // ARRANGE — single warehouse, two products, each with ample stock
      const [warehouse] = await db
        .insert(warehouses)
        .values({
          name: 'Shared Warehouse',
          location: sql`ST_SetSRID(ST_MakePoint(-74.006, 40.7128), 4326)::geography`,
        })
        .returning({ id: warehouses.id });

      const productA = '00000000-0000-0000-0000-000000000f01';
      const productB = '00000000-0000-0000-0000-000000000f02';

      await db.insert(inventory).values([
        { warehouseId: warehouse.id, productId: productA, quantity: 50 },
        { warehouseId: warehouse.id, productId: productB, quantity: 50 },
      ]);

      const shippingLocation = { lat: 40.7128, lng: -74.006 };

      // ACT — two concurrent orders for non-overlapping products
      // FOR UPDATE OF i locks only the specific inventory rows, not the warehouse.
      const results = await Promise.allSettled([
        allocateInventoryGeospatially([{ productId: productA, qty: 10 }], shippingLocation),
        allocateInventoryGeospatially([{ productId: productB, qty: 7 }], shippingLocation),
      ]);

      // ASSERT — both must succeed on the same warehouse
      const fulfilled = results.filter(
        (r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled',
      );
      expect(fulfilled).toHaveLength(2);
      expect(fulfilled[0].value).toBe(warehouse.id);
      expect(fulfilled[1].value).toBe(warehouse.id);

      // Verify each product was decremented independently
      const rows = await db.select().from(inventory).where(eq(inventory.warehouseId, warehouse.id));

      const byProduct = new Map(rows.map((r) => [r.productId, r.quantity]));
      expect(byProduct.get(productA)).toBe(40);
      expect(byProduct.get(productB)).toBe(43);
    });

    test('When an external lock blocks the transaction beyond statement_timeout, then it aborts cleanly', async () => {
      // ARRANGE
      const [warehouse] = await db
        .insert(warehouses)
        .values({
          name: 'Locked Warehouse',
          location: sql`ST_SetSRID(ST_MakePoint(-74.006, 40.7128), 4326)::geography`,
        })
        .returning({ id: warehouses.id });

      const productId = '00000000-0000-0000-0000-000000000401';

      await db.insert(inventory).values({
        warehouseId: warehouse.id,
        productId,
        quantity: 100,
      });

      // Open an independent connection and hold a lock without committing
      const blockingPool = new Pool({
        connectionString: process.env['DATABASE_URL'],
        max: 1,
      });
      const blockingClient = await blockingPool.connect();

      try {
        await blockingClient.query('BEGIN');
        await blockingClient.query(
          `SELECT * FROM inventory WHERE warehouse_id = $1 AND product_id = $2 FOR UPDATE`,
          [warehouse.id, productId],
        );

        // ACT
        const startTime = Date.now();
        const promise = allocateInventoryGeospatially([{ productId, qty: 1 }], {
          lat: 40.7128,
          lng: -74.006,
        });

        // ASSERT
        await expect(promise).rejects.toMatchObject({ statusCode: 503 });

        // verify it aborts around 3000ms (allow some tolerance)
        const elapsed = Date.now() - startTime;
        expect(elapsed).toBeGreaterThanOrEqual(2800);
        expect(elapsed).toBeLessThan(5000);
      } finally {
        await blockingClient.query('ROLLBACK');
        blockingClient.release();
        await blockingPool.end();
      }
    }, 10000);
  });
});
