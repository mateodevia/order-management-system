import { db } from './connection';
import { DbTransaction } from './types/db-transaction';

/**
 * Runs `callback` in the provided transaction, or starts a new one when `tx` is omitted.
 *
 * @param tx - Optional existing transaction to reuse (avoids nested `db.transaction` calls).
 * @param callback - Work to execute within a {@link DbTransaction}.
 * @returns Result of `callback`.
 */
export const reuseTransactionIfAvailable = <T>(
  tx: DbTransaction | undefined,
  callback: (tx: DbTransaction) => Promise<T>,
): Promise<T> => {
  if (tx) {
    return callback(tx);
  }
  return db.transaction(async (tx) => {
    return callback(tx);
  });
};
