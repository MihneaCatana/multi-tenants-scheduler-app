import { pgTable, uuid, smallint, date, time, timestamp, index } from 'drizzle-orm/pg-core';
import { resources } from './resources.js';

/**
 * Working hours — weekly RECURRING availability for a resource. Multiple rows
 * per resource per day (e.g. a morning block + an afternoon block). `day_of_week`
 * is 0–6 (Sun–Sat) matching PostgreSQL's `EXTRACT(DOW FROM ...)` so the slot
 * engine (phase 2) can join directly.
 *
 * `valid_from`/`valid_to` lets a contract change take effect on a future date
 * without rewriting history: future bookings respect the new window while past
 * appointments keep their context. NULL `valid_to` = open-ended.
 *
 * `start_time`/`end_time` are local TIME (no date, no tz); they are interpreted
 * in the tenant's timezone at query time.
 */
export const workingHours = pgTable(
  'working_hours',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    resourceId: uuid('resource_id').notNull().references(() => resources.id, { onDelete: 'cascade' }),
    dayOfWeek: smallint('day_of_week').notNull(),
    startTime: time('start_time', { withTimezone: false }).notNull(),
    endTime: time('end_time', { withTimezone: false }).notNull(),
    validFrom: date('valid_from').notNull(),
    validTo: date('valid_to'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    resourceIdx: index('working_hours_resource_idx').on(t.resourceId),
    dayIdx: index('working_hours_day_idx').on(t.dayOfWeek),
  }),
);

export type WorkingHour = typeof workingHours.$inferSelect;
export type NewWorkingHour = typeof workingHours.$inferInsert;
