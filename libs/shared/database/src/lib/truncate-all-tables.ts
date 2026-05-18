import { sql } from 'drizzle-orm';
import { db } from './connection';
import { loadSchemaTableNames } from './load-schema-tables';

let domainTableNames: string[] | undefined;

/**
 * Lazily loads and caches domain table names from Drizzle schema files.
 *
 * @returns Table names safe to truncate in integration tests.
 * @throws When no schema tables are discovered.
 */
function getDomainTableNames(): string[] {
  if (domainTableNames === undefined) {
    domainTableNames = loadSchemaTableNames();
    if (domainTableNames.length === 0) {
      throw new Error('No tables found in schema files');
    }
  }
  return domainTableNames;
}

/**
 * Truncates all domain tables. PostGIS system tables are never touched.
 *
 * @param database - Drizzle client exposing `execute` (defaults to the shared {@link db}).
 */
export async function truncateAllTables(database: Pick<typeof db, 'execute'> = db): Promise<void> {
  const tableNames = getDomainTableNames();
  // Safe: table names are statically extracted from our own .schema.ts files, not user input
  await database.execute(sql.raw(`TRUNCATE TABLE ${tableNames.join(', ')} CASCADE`));
}
