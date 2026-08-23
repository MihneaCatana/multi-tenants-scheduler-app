import { pgTable, uuid, varchar, boolean, text, timestamp, index } from 'drizzle-orm/pg-core';

/**
 * Resources — the typed, BOOKABLE things in a tenant. A booking reserves a set
 * of these. Types: 'provider' (a staff member), 'room', 'equipment', 'chair'.
 *
 * `linked_staff_id` bridges to the existing `staff` table: it is present ONLY
 * when type='provider' (a provider resource IS a bookable view of a staff
 * member). Non-staff resources have it null. Enforced in the service layer.
 *
 * Soft-deleted resources are excluded from new bookings and listings.
 */
export const RESOURCES_TYPE_VALUES = ['provider', 'room', 'equipment', 'chair'] as const;
export type ResourceType = (typeof RESOURCES_TYPE_VALUES)[number];

export const resources = pgTable(
  'resources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 120 }).notNull(),
    type: varchar('type', { length: 30 }).notNull().$type<ResourceType>(),
    linkedStaffId: uuid('linked_staff_id'),
    isActive: boolean('is_active').notNull().default(true),
    color: varchar('color', { length: 20 }),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    typeIdx: index('resources_type_idx').on(t.type),
    linkedStaffIdx: index('resources_linked_staff_idx').on(t.linkedStaffId),
  }),
);

export type Resource = typeof resources.$inferSelect;
export type NewResource = typeof resources.$inferInsert;
