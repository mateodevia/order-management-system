import { customLogger } from '@oms/shared/monitoring';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { sql } from 'drizzle-orm';
import { Warehouses } from '../../libs/inventory/src/lib/data-access/warehouses.schema';
import { Inventory } from '../../libs/inventory/src/lib/data-access/inventory.schema';
import path from 'path';
import { loadSchemaTableNames } from '../../libs/shared/database/src/lib/load-schema-tables';
import {
  SEED_WAREHOUSES,
  SEED_PRODUCTS,
  SEED_CUSTOMERS,
  SEED_ADDRESSES,
  SEED_TEST_SCENARIOS,
  buildInventoryRows,
} from './seed-data';

/**
 * One-shot database bootstrap: PostGIS, migrations, truncate, and seed warehouses/inventory.
 */
async function main() {
  const connectionString = process.env['DATABASE_URL'];
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is required');
  }

  const pool = new Pool({ connectionString });
  const db = drizzle(pool);

  customLogger.info('Enabling PostGIS extension');
  await pool.query('CREATE EXTENSION IF NOT EXISTS postgis;');

  customLogger.info('Running migrations');
  await migrate(db, {
    migrationsFolder: path.resolve(__dirname, '../../libs/shared/database/src/lib/migrations'),
  });

  customLogger.info('Truncating existing data');
  const tableNames = loadSchemaTableNames();
  if (tableNames.length === 0) {
    throw new Error('No tables found in schema files');
  }
  // Safe: table names are statically extracted from our own .schema.ts files, not user input
  await db.execute(sql.raw(`TRUNCATE TABLE ${tableNames.join(', ')} CASCADE`));

  customLogger.info('Seeding warehouses');
  const seededWarehouses = await db
    .insert(Warehouses)
    .values(SEED_WAREHOUSES.map(({ name, location }) => ({ name, location })))
    .returning({ id: Warehouses.id, name: Warehouses.name });

  customLogger.info('Seeded warehouses', { count: seededWarehouses.length });

  const warehouseIdByName = new Map(
    seededWarehouses.map((w) => [w.name, w.id] as const),
  );

  const inventoryRows = buildInventoryRows(warehouseIdByName);
  await db.insert(Inventory).values(inventoryRows);
  customLogger.info('Seeded inventory records', { count: inventoryRows.length });

  logSeedManifest();

  await pool.end();
  customLogger.info('Database setup complete');
}

/** Prints stable IDs and manual-test hints to stdout after seeding. */
function logSeedManifest(): void {
  customLogger.info('─── Seed manifest (use in Postman / curl) ───');
  customLogger.info('See tools/database/API-TESTING.md for copy-paste curl examples');

  customLogger.info('Customers', SEED_CUSTOMERS);
  customLogger.info('Products', {
    widgetA: SEED_PRODUCTS.widgetA.id,
    widgetB: SEED_PRODUCTS.widgetB.id,
    gadgetC: SEED_PRODUCTS.gadgetC.id,
    splitEast: SEED_PRODUCTS.splitEast.id,
    splitWest: SEED_PRODUCTS.splitWest.id,
    scarce: SEED_PRODUCTS.scarce.id,
  });
  customLogger.info('Shipping addresses (exact strings)', SEED_ADDRESSES);

  for (const scenario of SEED_TEST_SCENARIOS) {
    customLogger.info(`Scenario: ${scenario.name}`, { expected: scenario.expected });
  }
}

main().catch((err) => {
  customLogger.error('Setup failed', {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
