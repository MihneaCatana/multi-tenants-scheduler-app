import { pgTable, uuid, varchar, integer, boolean, timestamp } from 'drizzle-orm/pg-core';
import { services } from './services.js';
import type { ResourceType } from './resources.js';

/**
 * Default resource set per service — a TEMPLATE for the booking form. E.g.
 * 'Consultation' requires 1×provider + 1×room. Staff can override the actual
 * resources at booking time; this only drives defaults.
 */
export const serviceResourceRequirements = pgTable('service_resource_requirements', {
  id: uuid('id').primaryKey().defaultRandom(),
  serviceId: uuid('service_id').notNull().references(() => services.id, { onDelete: 'cascade' }),
  resourceType: varchar('resource_type', { length: 30 }).notNull().$type<ResourceType>(),
  quantity: integer('quantity').notNull().default(1),
  isRequired: boolean('is_required').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type ServiceResourceRequirement = typeof serviceResourceRequirements.$inferSelect;
export type NewServiceResourceRequirement = typeof serviceResourceRequirements.$inferInsert;
