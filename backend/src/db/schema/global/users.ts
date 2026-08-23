import { pgTable, uuid, text, timestamp, varchar, boolean, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { Role } from '../../../lib/roles.js';

/**
 * Platform-admin login identities, living in the GLOBAL (control-plane)
 * database.
 *
 * This table holds ONLY platform staff (role = platform_admin). Tenant users —
 * tenant admins and their staff — live in each tenant's OWN `people` table and
 * authenticate against their tenant database. Keeping platform admins here lets
 * login, JWT verification, and session management for the apex/admin host stay
 * centralized, fully separate from tenant data.
 *
 * Emails are normalized to lowercase by the application layer before any
 * insert/lookup, so the unique index below gives case-insensitive uniqueness
 * without depending on the citext extension.
 */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: varchar('email', { length: 254 }).notNull(),
    passwordHash: text('password_hash').notNull(),
    role: varchar('role', { length: 30 }).notNull().$type<Role>(),
    firstName: varchar('first_name', { length: 80 }),
    lastName: varchar('last_name', { length: 80 }),
    // An inactive user cannot authenticate.
    active: boolean('active').notNull().default(true),
    // Set true by admin password-reset; cleared on self password change. While
    // true the frontend forces the user onto the change-password screen.
    mustChangePassword: boolean('must_change_password').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    emailIdx: uniqueIndex('users_email_idx').on(t.email),
    roleIdx: index('users_role_idx').on(t.role),
  }),
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
