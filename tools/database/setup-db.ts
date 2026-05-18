import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { sql } from 'drizzle-orm';
import { Warehouses } from '../../libs/inventory/src/lib/data-access/warehouses.schema';
import { Inventory } from '../../libs/inventory/src/lib/data-access/inventory.schema';
import path from 'path';
import { loadSchemaTableNames } from '../../libs/shared/database/src/lib/load-schema-tables';

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

  console.log('Enabling PostGIS extension...');
  await pool.query('CREATE EXTENSION IF NOT EXISTS postgis;');

  console.log('Running migrations...');
  await migrate(db, {
    migrationsFolder: path.resolve(__dirname, '../../libs/shared/database/src/lib/migrations'),
  });

  console.log('Truncating existing data...');
  const tableNames = loadSchemaTableNames();
  if (tableNames.length === 0) {
    throw new Error('No tables found in schema files');
  }
  // Safe: table names are statically extracted from our own .schema.ts files, not user input
  await db.execute(sql.raw(`TRUNCATE TABLE ${tableNames.join(', ')} CASCADE`));

  console.log('Seeding warehouses...');
  const seededWarehouses = await db
    .insert(Warehouses)
    .values([
      {
        name: 'Atlanta Distribution Center',
        location: { lat: 33.749, lng: -84.388 },
      },
      {
        name: 'Chicago Fulfillment Hub',
        location: { lat: 41.8781, lng: -87.6298 },
      },
      {
        name: 'Dallas Supply Depot',
        location: { lat: 32.7767, lng: -96.797 },
      },
      {
        name: 'Denver Logistics Center',
        location: { lat: 39.7392, lng: -104.9903 },
      },
      {
        name: 'Phoenix Warehouse',
        location: { lat: 33.4484, lng: -112.074 },
      },
    ])
    .returning({ id: Warehouses.id, name: Warehouses.name });

  console.log(`Seeded ${seededWarehouses.length} warehouses`);

  const productIds = [
    '11111111-1111-1111-1111-111111111111',
    '22222222-2222-2222-2222-222222222222',
    '33333333-3333-3333-3333-333333333333',
    '44444444-4444-4444-4444-444444444444',
    '55555555-5555-5555-5555-555555555555',
  ];

  console.log('Seeding inventory...');
  const inventoryRows = seededWarehouses.flatMap((wh) =>
    productIds.map((productId, idx) => ({
      warehouseId: wh.id,
      productId,
      quantity: 50 + idx * 10,
      unitPrice: 1000 + idx * 500,
    })),
  );

  await db.insert(Inventory).values(inventoryRows);
  console.log(`Seeded ${inventoryRows.length} inventory records`);

  await pool.end();
  console.log('Database setup complete.');
}

main().catch((err) => {
  console.error('Setup failed:', err);
  process.exit(1);
});
