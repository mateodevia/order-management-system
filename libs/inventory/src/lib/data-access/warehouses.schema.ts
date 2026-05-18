import { pgTable, uuid, varchar, index } from 'drizzle-orm/pg-core';
import { geography } from '@oms/shared/database';

/** Drizzle schema for warehouse locations (PostGIS geography + GiST index). */
export const Warehouses = pgTable(
  'warehouses',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: varchar('name').notNull(),
    location: geography('location').notNull(),
  },
  (table) => [index('warehouses_location_gist_idx').using('gist', table.location)],
);
