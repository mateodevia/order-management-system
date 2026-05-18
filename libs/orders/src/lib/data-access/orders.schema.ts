import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, varchar, timestamp, uniqueIndex, integer, check } from 'drizzle-orm/pg-core';

export const Orders = pgTable(
  'orders',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    customerId: uuid('customer_id').notNull(),
    warehouseId: uuid('warehouse_id'),
    status: text('status', {
      enum: ['PENDING_PAYMENT', 'PAID', 'FAILED', 'CANCELLED', 'DLQ'],
    }).notNull(),
    idempotencyKey: varchar('idempotency_key').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    retryCount: integer('retry_count').default(0).notNull(),
    nextRetryAt: timestamp('next_retry_at'),
  },
  (table) => [
    uniqueIndex('orders_idempotency_key_idx').on(table.idempotencyKey),
    check('orders_status_check', sql`${table.status} IN ('PENDING_PAYMENT', 'PAID', 'FAILED', 'CANCELLED', 'DLQ')`),
  ],
);
