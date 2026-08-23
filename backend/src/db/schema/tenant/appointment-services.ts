import { pgTable, uuid, integer, primaryKey } from 'drizzle-orm/pg-core';
import { appointments } from './appointments.js';
import { services } from './services.js';

/**
 * Appointment ↔ Service junction. An appointment can have multiple services
 * that run sequentially. sortIndex controls the order.
 */
export const appointmentServices = pgTable(
  'appointment_services',
  {
    appointmentId: uuid('appointment_id').notNull().references(() => appointments.id, { onDelete: 'cascade' }),
    serviceId: uuid('service_id').notNull().references(() => services.id),
    sortIndex: integer('sort_index').notNull().default(0),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.appointmentId, t.serviceId] }),
  }),
);

export type AppointmentService = typeof appointmentServices.$inferSelect;
export type NewAppointmentService = typeof appointmentServices.$inferInsert;
