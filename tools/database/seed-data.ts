import { GeocodingMockedAddress } from '@oms/shared/geocoding';

/** Fixed customer UUIDs for manual / Postman requests (not stored in DB). */
export const SEED_CUSTOMERS = {
  demo: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  repeatBuyer: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
} as const;

/** Stable product UUIDs and pricing used across seeds and API examples. */
export const SEED_PRODUCTS = {
  widgetA: {
    id: '11111111-1111-4111-8111-111111111111',
    sku: 'WIDGET-A',
    unitPrice: 1000,
    note: 'In stock at every warehouse (50 units each)',
  },
  widgetB: {
    id: '22222222-2222-4222-8222-222222222222',
    sku: 'WIDGET-B',
    unitPrice: 1500,
    note: 'In stock at every warehouse (50 units each)',
  },
  gadgetC: {
    id: '33333333-3333-4333-8333-333333333333',
    sku: 'GADGET-C',
    unitPrice: 2000,
    note: 'In stock at every warehouse (50 units each)',
  },
  splitEast: {
    id: '44444444-4444-4444-8444-444444444444',
    sku: 'SPLIT-EAST',
    unitPrice: 2500,
    note: 'Only Atlanta + Chicago — pair with SPLIT-WEST to trigger 422',
  },
  splitWest: {
    id: '55555555-5555-4555-8555-555555555555',
    sku: 'SPLIT-WEST',
    unitPrice: 3000,
    note: 'Only Dallas, Denver, Phoenix — pair with SPLIT-EAST to trigger 422',
  },
  scarce: {
    id: '66666666-6666-4666-8666-666666666666',
    sku: 'SCARCE',
    unitPrice: 500,
    note: 'Atlanta 3, others 50 — qty ≤50 succeeds (may use non-Atlanta); qty 51 → 422',
  },
} as const;

/** Re-export mock shipping addresses (must match strings exactly). */
export { GeocodingMockedAddress as SEED_ADDRESSES };

/** Warehouse rows inserted by the seeder (order affects nothing; names are the stable key). */
export const SEED_WAREHOUSES = [
  {
    name: 'Atlanta Distribution Center',
    location: { lat: 33.749, lng: -84.388 },
    nearestAddress: GeocodingMockedAddress.Atlanta,
  },
  {
    name: 'Chicago Fulfillment Hub',
    location: { lat: 41.8781, lng: -87.6298 },
    nearestAddress: GeocodingMockedAddress.Chicago,
  },
  {
    name: 'Dallas Supply Depot',
    location: { lat: 32.7767, lng: -96.797 },
    nearestAddress: GeocodingMockedAddress.Dallas,
  },
  {
    name: 'Denver Logistics Center',
    location: { lat: 39.7392, lng: -104.9903 },
    nearestAddress: GeocodingMockedAddress.Denver,
  },
  {
    name: 'Phoenix Warehouse',
    location: { lat: 33.4484, lng: -112.074 },
    nearestAddress: GeocodingMockedAddress.Phoenix,
  },
] as const;

type WarehouseName = (typeof SEED_WAREHOUSES)[number]['name'];

type InventoryInsert = {
  warehouseId: string;
  productId: string;
  quantity: number;
  unitPrice: number;
};

const ALL_WAREHOUSE_NAMES = SEED_WAREHOUSES.map((w) => w.name) as WarehouseName[];
const EAST_WAREHOUSES: WarehouseName[] = [
  'Atlanta Distribution Center',
  'Chicago Fulfillment Hub',
];
const WEST_WAREHOUSES: WarehouseName[] = [
  'Dallas Supply Depot',
  'Denver Logistics Center',
  'Phoenix Warehouse',
];

/**
 * Builds inventory rows from named warehouse → product scenarios.
 *
 * @param warehouseIdByName - Map populated after warehouse insert.
 */
export function buildInventoryRows(
  warehouseIdByName: Map<WarehouseName, string>,
): InventoryInsert[] {
  const rows: InventoryInsert[] = [];
  const push = (
    warehouseNames: readonly WarehouseName[],
    product: (typeof SEED_PRODUCTS)[keyof typeof SEED_PRODUCTS],
    quantity: number,
  ) => {
    for (const name of warehouseNames) {
      rows.push({
        warehouseId: warehouseIdByName.get(name)!,
        productId: product.id,
        quantity,
        unitPrice: product.unitPrice,
      });
    }
  };

  push(ALL_WAREHOUSE_NAMES, SEED_PRODUCTS.widgetA, 50);
  push(ALL_WAREHOUSE_NAMES, SEED_PRODUCTS.widgetB, 50);
  push(ALL_WAREHOUSE_NAMES, SEED_PRODUCTS.gadgetC, 50);

  push(EAST_WAREHOUSES, SEED_PRODUCTS.splitEast, 40);
  push(WEST_WAREHOUSES, SEED_PRODUCTS.splitWest, 40);

  push(['Atlanta Distribution Center'], SEED_PRODUCTS.scarce, 3);
  push(
    ALL_WAREHOUSE_NAMES.filter((n) => n !== 'Atlanta Distribution Center'),
    SEED_PRODUCTS.scarce,
    50,
  );

  return rows;
}

/** Human-readable scenarios printed after `npm run db:setup`. */
export const SEED_TEST_SCENARIOS = [
  {
    name: 'Happy path — single item near Atlanta',
    expected: '201 PAID — Atlanta warehouse, charge 2 × $10.00 = $20.00',
  },
  {
    name: 'Happy path — multi-SKU',
    expected: '201 PAID — WIDGET-A + WIDGET-B, charge = qty × unit prices',
  },
  {
    name: 'Geospatial routing — ship to Phoenix',
    expected: '201 PAID — response warehouseId should be Phoenix Warehouse',
  },
  {
    name: 'Split-warehouse fulfillment failure',
    expected: '422 — no single warehouse stocks SPLIT-EAST + SPLIT-WEST',
  },
  {
    name: 'Insufficient stock everywhere',
    expected: '422 — SCARCE qty 51 (max 50 per warehouse)',
  },
  {
    name: 'Unknown shipping address',
    expected: '400 — geocoding mock does not recognize the address',
  },
  {
    name: 'Validation — missing / invalid idempotency key',
    expected: '400 — Zod header validation',
  },
  {
    name: 'Validation — duplicate line items',
    expected: '400 — duplicate productId in items array',
  },
  {
    name: 'Idempotent replay',
    expected: '201 then 200 with cached: true — reuse same x-idempotency-key',
  },
] as const;
