import { pgTable, uuid, text, varchar, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

export const Orders = pgTable(
  'orders',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    customerId: uuid('customer_id').notNull(),
    warehouseId: uuid('warehouse_id'),
    status: text('status', {
      enum: ['PENDING_PAYMENT', 'PAID', 'FAILED', 'CANCELLED'],
    }).notNull(),
    idempotencyKey: varchar('idempotency_key').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [uniqueIndex('orders_idempotency_key_idx').on(table.idempotencyKey)],
);
