import { readFileSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';

const PG_TABLE_PATTERN = /pgTable\(\s*['"]([^'"]+)['"]/g;

/** Workspace `libs/` directory — domain schemas live under inventory, orders, etc. */
export const SCHEMA_LIBS_ROOT = resolve(__dirname, '../../../..');

/**
 * Recursively collects all `*.schema.ts` files under a directory tree.
 *
 * @param dir - Root directory to search (typically a `libs/` subtree).
 * @returns Absolute paths to Drizzle schema source files.
 */
function findSchemaFiles(dir: string): string[] {
  const files: string[] = [];

  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      files.push(...findSchemaFiles(fullPath));
    } else if (entry.endsWith('.schema.ts')) {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * Extracts Postgres table names from `pgTable('...')` declarations in domain schema files.
 *
 * @param libsRoot - Workspace `libs/` root used to discover `*.schema.ts` files.
 * @returns Sorted unique table names for truncate/setup scripts.
 */
export function loadSchemaTableNames(libsRoot: string = SCHEMA_LIBS_ROOT): string[] {
  const tableNames = new Set<string>();

  for (const file of findSchemaFiles(libsRoot)) {
    const source = readFileSync(file, 'utf-8');

    for (const match of source.matchAll(PG_TABLE_PATTERN)) {
      tableNames.add(match[1]);
    }
  }

  return [...tableNames];
}
