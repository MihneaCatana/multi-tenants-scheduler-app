import { pgTable, uuid, varchar, timestamp, index } from 'drizzle-orm/pg-core';
import { resources } from './resources.js';

/**
 * Time off — ABSOLUTE exceptions to a resource's recurring availability: PTO,
 * holidays, one-off closures. `start_at`/`end_at` are absolute timestamps (UTC).
 * The slot engine subtracts these from the recurring blocks.
 */
export const timeOff = pgTable(
  'time_off',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    resourceId: uuid('resource_id').notNull().references(() => resources.id, { onDelete: 'cascade' }),
    startAt: timestamp('start_at', { withTimezone: true }).notNull(),
    endAt: timestamp('end_at', { withTimezone: true }).notNull(),
    reason: varchar('reason', { length: 200 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    resourceIdx: index('time_off_resource_idx').on(t.resourceId),
    startIdx: index('time_off_start_idx').on(t.startAt),
  }),
);

export type TimeOff = typeof timeOff.$inferSelect;
export type NewTimeOff = typeof timeOff.$inferInsert;
