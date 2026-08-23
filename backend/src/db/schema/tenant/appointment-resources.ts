import { pgTable, uuid, varchar, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { isNull } from 'drizzle-orm';
import { appointments } from './appointments.js';
import { resources } from './resources.js';
import { tstzrange } from './tstzrange.js';

/**
 * Appointment ↔ Resource join. Each row represents one resource reserved for one
 * appointment, over the window `[start − buffer_before, end + buffer_after)`.
 *
 * This table carries the GiST exclusion constraint that makes double-booking
 * physically impossible (added by hand in migration 0005, since Drizzle's DSL
 * cannot express EXCLUDE USING gist). The constraint is PARTIAL — it only
 * applies where `deleted_at IS NULL`, so cancelling an appointment (which
 * soft-deletes its rows here) frees the slot for rebooking.
 *
 * `booked_range` is a regular tstzrange column (PG can't generate it from two
 * other tables). The scheduling service computes and writes it; the reschedule
 * function is the SINGLE owner of its mutation (no direct time PATCH elsewhere).
 */
export const appointmentResources = pgTable(
  'appointment_resources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    appointmentId: uuid('appointment_id').notNull().references(() => appointments.id, { onDelete: 'cascade' }),
    resourceId: uuid('resource_id').notNull().references(() => resources.id),
    bookedRange: tstzrange('booked_range').notNull(),
    role: varchar('role', { length: 30 }).notNull().default('primary'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    // A resource appears at most once per appointment. PARTIAL: only among
    // non-deleted rows, so reschedule (which soft-deletes then re-inserts the
    // same appointment_id/resource_id pair) does not trip the unique index.
    appointmentResourceIdx: uniqueIndex('appointment_resources_uniq_idx')
      .on(t.appointmentId, t.resourceId)
      .where(isNull(t.deletedAt)),
  }),
);

export type AppointmentResource = typeof appointmentResources.$inferSelect;
export type NewAppointmentResource = typeof appointmentResources.$inferInsert;
