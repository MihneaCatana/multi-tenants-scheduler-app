import { pgTable, uuid, varchar, text, timestamp, index } from 'drizzle-orm/pg-core';
import { clients } from './clients.js';
import { resources } from './resources.js';
import { staff } from './staff.js';

/**
 * Appointment status values. The legal transitions between these are defined
 * in modules/scheduling/state-machine.ts. `requested` is included for
 * forward-compat (client self-booking, phase 5) but is NOT reachable in phase 1
 * — staff booking always creates directly in `confirmed`.
 */
export const APPOINTMENT_STATUS_VALUES = [
  'requested',
  'confirmed',
  'checked_in',
  'in_progress',
  'completed',
  'cancelled',
  'no_show',
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUS_VALUES)[number];

/** Statuses whose appointment_resources rows count as "active" (occupying a slot). */
export const ACTIVE_STATUSES: AppointmentStatus[] = [
  'requested',
  'confirmed',
  'checked_in',
  'in_progress',
];

/**
 * Appointments — the header record. `start_at`/`end_at` are the "real" display
 * times; the per-resource booked window (including buffers) lives in
 * appointment_resources.booked_range. `client_id` is nullable
 * (walk-ins, custom appointments). `cancellation_reason` is set on cancel.
 * Services are linked via the `appointment_services` junction table (many-to-many).
 */
export const appointments = pgTable(
  'appointments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: uuid('client_id').references(() => clients.id),
    primaryResourceId: uuid('primary_resource_id').notNull().references(() => resources.id),
    startAt: timestamp('start_at', { withTimezone: true }).notNull(),
    endAt: timestamp('end_at', { withTimezone: true }).notNull(),
    status: varchar('status', { length: 20 }).notNull().$type<AppointmentStatus>().default('confirmed'),
    summary: varchar('summary', { length: 200 }),
    notes: text('notes'),
    cancellationReason: varchar('cancellation_reason', { length: 200 }),
    createdByStaffId: uuid('created_by_staff_id').notNull().references(() => staff.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    primaryResourceIdx: index('appointments_primary_resource_idx').on(t.primaryResourceId),
    clientIdx: index('appointments_client_idx').on(t.clientId),
    startIdx: index('appointments_start_idx').on(t.startAt),
    statusIdx: index('appointments_status_idx').on(t.status),
  }),
);

export type Appointment = typeof appointments.$inferSelect;
export type NewAppointment = typeof appointments.$inferInsert;
