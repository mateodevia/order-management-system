/**
 * Outcome of a gateway status query, used by the reconciliation sweeper to resolve
 * stale PENDING_PAYMENT orders.
 *
 * - `SUCCESS`   — charge completed; order can be moved to PAID.
 * - `PENDING`   — charge is still in flight; sweeper should wait.
 * - `DECLINED`  — card was declined; restore inventory and mark FAILED.
 * - `NOT_FOUND` — gateway has no record; treat as never charged, restore inventory.
 */
export enum PaymentStatus {
  SUCCESS = 'SUCCESS',
  DECLINED = 'DECLINED',
  PENDING = 'PENDING',
  NOT_FOUND = 'NOT_FOUND',
}
