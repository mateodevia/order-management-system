import { pgTable, uuid, varchar, index } from 'drizzle-orm/pg-core';
import { geography } from '@oms/shared/database';

export const warehouses = pgTable(
  'warehouses',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: varchar('name').notNull(),
    location: geography('location').notNull(),
  },
  (table) => [
    index('warehouses_location_gist_idx').using('gist', table.location),
  ]
);
