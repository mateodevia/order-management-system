import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const PG_TABLE_PATTERN = /pgTable\(\s*['"]([^'"]+)['"]/g;

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

export function loadSchemaTableNames(libsRoot: string): string[] {
  const tableNames = new Set<string>();

  for (const file of findSchemaFiles(libsRoot)) {
    const source = readFileSync(file, 'utf-8');

    for (const match of source.matchAll(PG_TABLE_PATTERN)) {
      tableNames.add(match[1]);
    }
  }

  return [...tableNames];
}
