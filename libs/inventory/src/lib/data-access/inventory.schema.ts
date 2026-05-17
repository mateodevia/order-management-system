import { pgTable, uuid, integer, primaryKey } from 'drizzle-orm/pg-core';

export const inventory = pgTable(
  'inventory',
  {
    warehouseId: uuid('warehouse_id').notNull(),
    productId: uuid('product_id').notNull(),
    quantity: integer('quantity').notNull(),
  },
  (table) => [primaryKey({ columns: [table.warehouseId, table.productId] })]
);
