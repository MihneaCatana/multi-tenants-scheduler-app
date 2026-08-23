import { pgTable, uuid, varchar, integer, numeric, boolean, text, timestamp, index } from 'drizzle-orm/pg-core';
import { isNull } from 'drizzle-orm';

/**
 * Services — the tenant's bookable catalog (e.g. 'Haircut', 'Consultation',
 * 'Deep Tissue Massage'). Carries duration and buffer (prep/cleanup) minutes.
 *
 * A service also has a default set of required resource types
 * (service_resource_requirements) used to pre-fill the booking form — but staff
 * can override the actual resources at booking time.
 */
export const services = pgTable(
  'services',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 120 }).notNull(),
    description: text('description'),
    category: varchar('category', { length: 80 }),
    durationMinutes: integer('duration_minutes').notNull(),
    bufferBeforeMinutes: integer('buffer_before_minutes').notNull().default(0),
    bufferAfterMinutes: integer('buffer_after_minutes').notNull().default(0),
    price: numeric('price', { precision: 10, scale: 2 }),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    categoryIdx: index('services_category_idx').on(t.category).where(isNull(t.deletedAt)),
  }),
);

export type Service = typeof services.$inferSelect;
export type NewService = typeof services.$inferInsert;
