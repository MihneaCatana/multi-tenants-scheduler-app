import { pgTable, uuid, varchar, text, boolean, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { isNull } from 'drizzle-orm';
import { Role } from '../../../lib/roles.js';

/**
 * Staff — the employees of a tenant who can LOG IN. Lives ONLY in that tenant's
 * per-tenant database.
 *
 * A staff row always has `passwordHash` + `role` (it is a login identity by
 * definition — that's what distinguishes it from a client). The tenant's owner
 * (provisioned at tenant creation) and every tenant_user the admin creates land
 * here. `tenant_sessions` foreign-keys to this table.
 *
 * Kept physically SEPARATE from `clients` (the tenant's customers, who never
 * log in) so no query path can cross the two: a client row cannot appear in a
 * staff listing, and a staff credential can never leak through a client view.
 * Emails are normalized to lowercase app-side before any insert/lookup.
 *
 * Deletion is soft: `deletedAt` is set instead of removing the row. All queries
 * filter `WHERE deleted_at IS NULL`. The unique email index is partial so that
 * a deleted staff member's email can be reused. Deletion is distinct from
 * deactivation (`active=false`): a deleted staff member is completely invisible
 * to the application.
 */
export const staff = pgTable(
  'staff',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: varchar('email', { length: 254 }).notNull(),
    passwordHash: text('password_hash').notNull(),
    role: varchar('role', { length: 30 }).notNull().$type<Role>(),
    firstName: varchar('first_name', { length: 80 }),
    lastName: varchar('last_name', { length: 80 }),
    // An inactive staff member cannot authenticate. Defaults true.
    active: boolean('active').notNull().default(true),
    // Set true by admin password-reset; cleared on self password change. While
    // true the frontend forces the user onto the change-password screen.
    mustChangePassword: boolean('must_change_password').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    // Partial unique index: only enforce uniqueness among non-deleted rows
    // so a soft-deleted staff member's email can be reused.
    emailIdx: uniqueIndex('staff_email_idx').on(t.email).where(isNull(t.deletedAt)),
    roleIdx: index('staff_role_idx').on(t.role),
  }),
);

export type StaffMember = typeof staff.$inferSelect;
export type NewStaffMember = typeof staff.$inferInsert;
