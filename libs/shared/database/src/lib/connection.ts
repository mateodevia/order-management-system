import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

/** Shared PostgreSQL connection pool for the OMS service. */
const pool = new Pool({
  connectionString: process.env['DATABASE_URL'],
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

export { pool };

/** Drizzle database client bound to {@link pool}. */
export const db = drizzle(pool);
