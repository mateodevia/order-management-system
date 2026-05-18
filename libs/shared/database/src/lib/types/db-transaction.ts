import type { db } from '../connection';

/** Drizzle transaction handle passed to callbacks in `db.transaction`. */
export type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
