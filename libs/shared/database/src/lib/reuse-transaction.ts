import { db } from './connection';
import { DbTransaction } from './types/db-transaction';

export const reuseTransactionIfAvailable = <T>(
  tx: DbTransaction,
  callback: (tx: DbTransaction) => Promise<T>,
): Promise<T> => {
  if (tx) {
    return callback(tx);
  }
  return db.transaction(async (tx) => {
    return callback(tx);
  });
};
