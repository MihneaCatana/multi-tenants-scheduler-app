import { pgTable, uuid, text, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { staff } from './staff.js';

/**
 * Refresh-token sessions for tenant staff (login identities) — lives ONLY in
 * that tenant's per-tenant database.
 *
 * Mirrors the design of the global `sessions` table: we store the SHA-256 hash
 * of the opaque refresh token (never the raw token). Each refresh rotates the
 * token: the old row is revoked and a new one inserted. Logout / password
 * change revokes all of a staff member's active rows.
 *
 * The partial unique index `tenant_sessions_refresh_hash_active_uniq` is the
 * database-level backstop for the rotation logic: it makes the revoke-then-
 * rotate step a compare-and-set, so two concurrent requests presenting the
 * same valid token can't both win the rotation. Excludes revoked rows (which
 * are free to collide with a re-derived hash).
 *
 * FK to `staff` with ON DELETE CASCADE so deleting a staff member removes their
 * sessions. Clients never get a session (they can't log in).
 */
export const tenantSessions = pgTable(
  'tenant_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    staffId: uuid('staff_id')
      .notNull()
      .references(() => staff.id, { onDelete: 'cascade' }),
    refreshHash: text('refresh_hash').notNull(),
    userAgent: text('user_agent'),
    ip: text('ip'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    refreshHashIdx: index('tenant_sessions_refresh_hash_idx').on(t.refreshHash),
    // Unique over refresh_hash WHERE the session is still active.
    refreshHashActiveUniq: uniqueIndex('tenant_sessions_refresh_hash_active_uniq')
      .on(t.refreshHash)
      .where(sql`revoked_at IS NULL`),
    staffIdx: index('tenant_sessions_staff_idx').on(t.staffId),
  }),
);

export type TenantSession = typeof tenantSessions.$inferSelect;
export type NewTenantSession = typeof tenantSessions.$inferInsert;
