import { pgTable, uuid, varchar, text, timestamp, index } from 'drizzle-orm/pg-core';
import { appointments } from './appointments.js';
import { staff } from './staff.js';
import type { AppointmentStatus } from './appointments.js';

/**
 * One row per appointment status transition. `from_status` is NULL on creation
 * (the initial row). This is the source of the "where is this client right now"
 * timeline the staff calendar displays.
 */
export const appointmentStatusHistory = pgTable(
  'appointment_status_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    appointmentId: uuid('appointment_id').notNull().references(() => appointments.id, { onDelete: 'cascade' }),
    fromStatus: varchar('from_status', { length: 20 }).$type<AppointmentStatus>(),
    toStatus: varchar('to_status', { length: 20 }).notNull().$type<AppointmentStatus>(),
    changedByStaffId: uuid('changed_by_staff_id').notNull().references(() => staff.id),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    appointmentIdx: index('appointment_status_history_appointment_idx').on(t.appointmentId),
  }),
);

export type AppointmentStatusHistory = typeof appointmentStatusHistory.$inferSelect;
export type NewAppointmentStatusHistory = typeof appointmentStatusHistory.$inferInsert;
