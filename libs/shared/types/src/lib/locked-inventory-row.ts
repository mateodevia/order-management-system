/**
 * Inventory row snapshot returned after `FOR UPDATE` lock acquisition.
 *
 * Used for post-lock sufficiency checks and order total calculation.
 */
export type LockedInventoryRow = {
  warehouseId: string;
  productId: string;
  /** On-hand quantity at lock time (may differ from requested quantity). */
  quantity: number;
  /** Unit price in the smallest currency unit (e.g. cents). */
  unitPrice: number;
};
