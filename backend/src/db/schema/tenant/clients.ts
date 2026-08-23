import { pgTable, uuid, varchar, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { isNull } from 'drizzle-orm';

/**
 * Clients — the CUSTOMERS of a tenant, living ONLY in that tenant's per-tenant
 * database.
 *
 * A client is a pure contact/CRM record: they have NO password and NO role, and
 * therefore CANNOT log in. They are managed via the `/clients` endpoints
 * (list/create/update/delete). Kept physically separate from `staff` so the two
 * populations can never cross: a client cannot appear in a staff listing, and
 * no identity field exists on this table to leak.
 *
 * If a client ever needs to become a login identity, a staff row is created for
 * them (a new identity); the client record stays as the customer-of-record.
 *
 * Deletion is soft: `deletedAt` is set instead of removing the row. All queries
 * filter `WHERE deleted_at IS NULL`. The unique email index is partial so that
 * a deleted client's email can be reused.
 */
export const clients = pgTable(
  'clients',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: varchar('email', { length: 254 }).notNull(),
    firstName: varchar('first_name', { length: 80 }),
    lastName: varchar('last_name', { length: 80 }),
    phone: varchar('phone', { length: 40 }),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    // Partial unique index: only enforce uniqueness among non-deleted rows
    // so a soft-deleted client's email can be reused.
    emailIdx: uniqueIndex('clients_email_idx').on(t.email).where(isNull(t.deletedAt)),
  }),
);

export type Client = typeof clients.$inferSelect;
export type NewClient = typeof clients.$inferInsert;
