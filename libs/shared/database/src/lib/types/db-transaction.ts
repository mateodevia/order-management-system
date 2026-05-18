import type { db } from '../connection';

export type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
