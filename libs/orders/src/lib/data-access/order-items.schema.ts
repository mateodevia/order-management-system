import { pgTable, uuid, integer } from 'drizzle-orm/pg-core';
import { Orders } from './orders.schema';

/** Drizzle schema for the `order_items` table (line items per order). */
export const OrderItems = pgTable('order_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  orderId: uuid('order_id')
    .notNull()
    .references(() => Orders.id, { onDelete: 'cascade' }),
  productId: uuid('product_id').notNull(),
  quantity: integer('quantity').notNull(),
});
