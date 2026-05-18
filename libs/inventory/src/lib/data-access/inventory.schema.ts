import { sql } from 'drizzle-orm';
import { pgTable, uuid, integer, primaryKey, check } from 'drizzle-orm/pg-core';

export const Inventory = pgTable(
  'inventory',
  {
    warehouseId: uuid('warehouse_id').notNull(),
    productId: uuid('product_id').notNull(),
    quantity: integer('quantity').notNull(),
    unitPrice: integer('unit_price').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.warehouseId, table.productId] }),
    check('inventory_quantity_non_negative', sql`${table.quantity} >= 0`),
  ],
);
