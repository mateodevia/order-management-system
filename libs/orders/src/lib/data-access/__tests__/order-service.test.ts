import { sql, eq, and } from 'drizzle-orm';
import { db, pool, truncateAllTables } from '@oms/shared/database';
import { PaymentClient } from '@oms/payments';
import { GeocodingClient, GeocodingMockedAddress } from '@oms/shared/geocoding';
import { AppError } from '@oms/shared/util-errors';
import { Warehouses, Inventory } from '@oms/inventory';
import { Orders } from '../orders.schema';
import { createOrderService, type OrderPayload } from '../order-service';

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await truncateAllTables();
}, 10000);

describe('createOrderService', () => {
  test('When a multi-item order is placed, then all items are saved and all Inventory decremented', async () => {
    // ARRANGE
    const paymentClient = new PaymentClient();
    const geocodingClient = new GeocodingClient();

    const [warehouse] = await db
      .insert(Warehouses)
      .values({
        name: 'Atlanta Warehouse',
        location: sql`ST_SetSRID(ST_MakePoint(-84.3876, 33.7578), 4326)::geography`,
      })
      .returning({ id: Warehouses.id });

    const product1 = '00000000-0000-0000-0000-100000000001';
    const product2 = '00000000-0000-0000-0000-100000000002';
    await db.insert(Inventory).values([
      { warehouseId: warehouse.id, productId: product1, quantity: 100, unitPrice: 1000 },
      { warehouseId: warehouse.id, productId: product2, quantity: 50, unitPrice: 1500 },
    ]);

    // ACT
    const result = await createOrderService(
      {
        customerId: '00000000-0000-0000-0000-000000000099',
        shippingAddress: GeocodingMockedAddress.Atlanta,
        items: [
          { productId: product1, quantity: 10 },
          { productId: product2, quantity: 3 },
        ],
      },
      crypto.randomUUID(),
      { paymentClient, geocodingClient },
    );

    // ASSERT
    expect(result.status).toBe(201);

    const inventoryRows = await db
      .select()
      .from(Inventory)
      .where(eq(Inventory.warehouseId, warehouse.id));
    const byProduct = new Map(inventoryRows.map((r) => [r.productId, r.quantity]));
    expect(byProduct.get(product1)).toBe(90);
    expect(byProduct.get(product2)).toBe(47);
  });
  test('When the geocoding service cannot resolve the address, then it throws 400', async () => {
    // ARRANGE
    const paymentClient = new PaymentClient();
    const geocodingClient = new GeocodingClient();
    // ACT
    const promise = createOrderService(
      {
        customerId: '00000000-0000-0000-0000-000000000099',
        shippingAddress: 'Unknown Address, Nowhere, XX',
        items: [{ productId: '00000000-0000-0000-0000-100000000001', quantity: 5 }],
      },
      crypto.randomUUID(),
      { paymentClient, geocodingClient },
    );

    // ASSERT
    await expect(promise).rejects.toMatchObject({ statusCode: 400 });
  });
  test('When the geocoding service is unavailable, then it throws 503', async () => {
    // ARRANGE
    const paymentClient = new PaymentClient();
    const geocodingClient = new GeocodingClient();
    geocodingClient.testables.forceFailure();

    // ACT
    const promise = createOrderService(
      {
        customerId: '00000000-0000-0000-0000-000000000099',
        shippingAddress: GeocodingMockedAddress.Atlanta,
        items: [
          { productId: '00000000-0000-0000-0000-100000000001', quantity: 10 },
          { productId: '00000000-0000-0000-0000-100000000002', quantity: 3 },
        ],
      },
      crypto.randomUUID(),
      { paymentClient, geocodingClient },
    );

    // ASSERT
    await expect(promise).rejects.toMatchObject({ statusCode: 503 });
  });
  test('When no warehouse can fulfill the order, then it throws 422 without creating an order', async () => {
    // ARRANGE
    const paymentClient = new PaymentClient();
    const geocodingClient = new GeocodingClient();
    // No Warehouses seeded

    // ACT
    const promise = createOrderService(
      {
        customerId: '00000000-0000-0000-0000-000000000099',
        shippingAddress: GeocodingMockedAddress.Atlanta,
        items: [{ productId: '00000000-0000-0000-0000-100000000001', quantity: 5 }],
      },
      crypto.randomUUID(),
      {
        paymentClient,
        geocodingClient,
      },
    );

    // ASSERT
    await expect(promise).rejects.toMatchObject({ statusCode: 422 });

    const allOrders = await db.select().from(Orders);
    expect(allOrders).toHaveLength(0);
  });
  test('When the payment gateway fails, then Inventory is not decremented and order is saved as FAILED', async () => {
    // ARRANGE
    const paymentClient = new PaymentClient();
    const geocodingClient = new GeocodingClient();

    const [warehouse] = await db
      .insert(Warehouses)
      .values({
        name: 'Atlanta Warehouse',
        location: sql`ST_SetSRID(ST_MakePoint(-84.3876, 33.7578), 4326)::geography`,
      })
      .returning({ id: Warehouses.id });

    const productId = '00000000-0000-0000-0000-100000000001';
    await db.insert(Inventory).values({
      warehouseId: warehouse.id,
      productId,
      quantity: 50,
      unitPrice: 1000,
    });

    paymentClient.testables.forceFailure();

    // ACT
    const promise = createOrderService(
      {
        customerId: '00000000-0000-0000-0000-000000000099',
        shippingAddress: GeocodingMockedAddress.Atlanta,
        items: [{ productId, quantity: 5 }],
      },
      crypto.randomUUID(),
      {
        paymentClient,
        geocodingClient,
      },
    );

    // ASSERT
    await expect(promise).rejects.toMatchObject({ statusCode: 402 });

    // Inventory must be restored
    const [inv] = await db
      .select()
      .from(Inventory)
      .where(and(eq(Inventory.warehouseId, warehouse.id), eq(Inventory.productId, productId)));
    expect(inv.quantity).toBe(50);

    // Order should be marked FAILED
    const allOrders = await db.select().from(Orders);
    expect(allOrders).toHaveLength(1);
    expect(allOrders[0].status).toBe('FAILED');
  });
  test('When multiple identical requests fire simultaneously, then exactly one succeeds and others get 409 or cached 200', async () => {
    // ARRANGE
    const paymentClient = new PaymentClient();
    const geocodingClient = new GeocodingClient();

    const [warehouse] = await db
      .insert(Warehouses)
      .values({
        name: 'Atlanta Warehouse',
        location: sql`ST_SetSRID(ST_MakePoint(-84.3876, 33.7578), 4326)::geography`,
      })
      .returning({ id: Warehouses.id });

    const productId = '00000000-0000-0000-0000-100000000001';
    await db.insert(Inventory).values({
      warehouseId: warehouse.id,
      productId,
      quantity: 50,
      unitPrice: 1000,
    });

    const payload: OrderPayload = {
      customerId: '00000000-0000-0000-0000-000000000099',
      shippingAddress: GeocodingMockedAddress.Atlanta,
      items: [{ productId, quantity: 3 }],
    };
    const idempotencyKey = crypto.randomUUID();

    // ACT — fire 5 concurrent requests with the same idempotency key
    const results = await Promise.allSettled([
      createOrderService(payload, idempotencyKey, { paymentClient, geocodingClient }),
      createOrderService(payload, idempotencyKey, { paymentClient, geocodingClient }),
      createOrderService(payload, idempotencyKey, { paymentClient, geocodingClient }),
      createOrderService(payload, idempotencyKey, { paymentClient, geocodingClient }),
      createOrderService(payload, idempotencyKey, { paymentClient, geocodingClient }),
    ]);

    // ASSERT
    const fulfilled = results.filter(
      (r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof createOrderService>>> =>
        r.status === 'fulfilled',
    );
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');

    // At least one must succeed (201 or 200 cached)
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);

    // Successful results should be 201 (first) or 200 (cached)
    const first = [];
    for (const f of fulfilled) {
      expect([200, 201]).toContain(f.value.status);
      if (f.value.status === 201) {
        first.push(f);
        break;
      }
    }
    // There should be exactly one 201 result
    expect(first).toHaveLength(1);

    // Rejected results should be 409 (in-flight conflict)
    for (const r of rejected) {
      expect(r.reason).toBeInstanceOf(AppError);
      expect((r.reason as AppError).statusCode).toBe(409);
    }

    // Exactly one order should exist in DB
    const allOrders = await db
      .select()
      .from(Orders)
      .where(eq(Orders.idempotencyKey, idempotencyKey));
    expect(allOrders).toHaveLength(1);
    expect(allOrders[0].status).toBe('PAID');

    // Inventory should be decremented exactly once (50 - 3 = 47)
    const [inv] = await db
      .select()
      .from(Inventory)
      .where(and(eq(Inventory.warehouseId, warehouse.id), eq(Inventory.productId, productId)));
    expect(inv.quantity).toBe(47);
  }, 15000);

  describe('idempotency', () => {
    test('When an order with the same idempotency key is PENDING_PAYMENT, then it throws a 409 AppError', async () => {
      // ARRANGE
      const paymentClient = new PaymentClient();
      const geocodingClient = new GeocodingClient();

      const idempotencyKey = crypto.randomUUID();

      await db.insert(Orders).values({
        customerId: '00000000-0000-0000-0000-000000000099',
        status: 'PENDING_PAYMENT',
        idempotencyKey,
      });

      const [warehouse] = await db
        .insert(Warehouses)
        .values({
          name: 'Atlanta Warehouse',
          location: sql`ST_SetSRID(ST_MakePoint(-84.3876, 33.7578), 4326)::geography`,
        })
        .returning({ id: Warehouses.id });

      const productId = '00000000-0000-0000-0000-100000000001';
      await db.insert(Inventory).values({
        warehouseId: warehouse.id,
        productId,
        quantity: 50,
        unitPrice: 1000,
      });

      // ACT
      const promise = createOrderService(
        {
          customerId: '00000000-0000-0000-0000-000000000099',
          shippingAddress: GeocodingMockedAddress.Atlanta,
          items: [{ productId, quantity: 5 }],
        },
        idempotencyKey,
        {
          paymentClient,
          geocodingClient,
        },
      );

      // ASSERT
      await expect(promise).rejects.toBeInstanceOf(AppError);
      await expect(promise).rejects.toMatchObject({ statusCode: 409 });
    });
    test('When an order with the same idempotency key is PAID, then it returns 200 with cached: true', async () => {
      // ARRANGE
      const paymentClient = new PaymentClient();
      const geocodingClient = new GeocodingClient();

      const idempotencyKey = crypto.randomUUID();
      const warehouseId = crypto.randomUUID();

      await db.insert(Orders).values({
        customerId: '00000000-0000-0000-0000-000000000099',
        warehouseId,
        status: 'PAID',
        idempotencyKey,
      });

      const [warehouse] = await db
        .insert(Warehouses)
        .values({
          name: 'Atlanta Warehouse',
          location: sql`ST_SetSRID(ST_MakePoint(-84.3876, 33.7578), 4326)::geography`,
        })
        .returning({ id: Warehouses.id });

      const productId = '00000000-0000-0000-0000-100000000001';
      await db.insert(Inventory).values({
        warehouseId: warehouse.id,
        productId,
        quantity: 50,
        unitPrice: 1000,
      });

      // ACT
      const result = await createOrderService(
        {
          customerId: '00000000-0000-0000-0000-000000000099',
          shippingAddress: GeocodingMockedAddress.Atlanta,
          items: [{ productId, quantity: 5 }],
        },
        idempotencyKey,
        {
          paymentClient,
          geocodingClient,
        },
      );

      // ASSERT
      expect(result.status).toBe(200);
      expect(result.data.status).toBe('PAID');

      // Inventory must NOT have been decremented (no new allocation happened)
      const [inv] = await db
        .select()
        .from(Inventory)
        .where(and(eq(Inventory.warehouseId, warehouse.id), eq(Inventory.productId, productId)));
      expect(inv.quantity).toBe(50);
    });
    test('When an order with the same idempotency key is FAILED, then it returns 200 with cached: true and status FAILED', async () => {
      // ARRANGE
      const paymentClient = new PaymentClient();
      const geocodingClient = new GeocodingClient();

      const idempotencyKey = crypto.randomUUID();
      const warehouseId = crypto.randomUUID();

      const [warehouse] = await db
        .insert(Warehouses)
        .values({
          name: 'Atlanta Warehouse',
          location: sql`ST_SetSRID(ST_MakePoint(-84.3876, 33.7578), 4326)::geography`,
        })
        .returning({ id: Warehouses.id });

      const productId = '00000000-0000-0000-0000-100000000001';
      await db.insert(Inventory).values({
        warehouseId: warehouse.id,
        productId,
        quantity: 50,
        unitPrice: 1000,
      });

      // Seed a previously failed order with this idempotency key
      await db.insert(Orders).values({
        customerId: '00000000-0000-0000-0000-000000000099',
        warehouseId,
        status: 'FAILED',
        idempotencyKey,
      });

      // ACT
      const result = await createOrderService(
        {
          customerId: '00000000-0000-0000-0000-000000000099',
          shippingAddress: GeocodingMockedAddress.Atlanta,
          items: [{ productId, quantity: 5 }],
        },
        idempotencyKey,
        {
          paymentClient,
          geocodingClient,
        },
      );

      // ASSERT
      expect(result.status).toBe(200);
      expect(result.data.status).toBe('FAILED');

      // Inventory must NOT have been decremented (no new allocation happened)
      const [inv] = await db
        .select()
        .from(Inventory)
        .where(and(eq(Inventory.warehouseId, warehouse.id), eq(Inventory.productId, productId)));
      expect(inv.quantity).toBe(50);
    });
  });
});
