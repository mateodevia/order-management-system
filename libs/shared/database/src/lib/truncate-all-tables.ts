import { sql } from 'drizzle-orm';
import { db } from './connection';

const DOMAIN_TABLES = ['inventory', 'warehouses', 'order_items', 'orders'];

/**
 * Truncates all domain tables. PostGIS system tables are never touched.
 */
export async function truncateAllTables(database: Pick<typeof db, 'execute'> = db): Promise<void> {
  await database.execute(
    sql.raw(`TRUNCATE TABLE ${DOMAIN_TABLES.join(', ')} CASCADE`),
  );
}
