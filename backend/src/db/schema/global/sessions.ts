import { pgTable, uuid, text, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users.js';

/**
 * Refresh-token sessions. We store the SHA-256 hash of the opaque refresh
 * token (never the raw token). Each refresh rotates the token: the old row is
 * revoked and a new one is inserted. Logout / password change revokes all of a
 * user's active rows.
 *
 * The partial unique index `sessions_refresh_hash_active_uniq` enforces that no
 * two ACTIVE (non-revoked) sessions share the same hash. This is the
 * database-level backstop for the rotation logic in
 * src/modules/auth/service.ts (rotateRefreshToken): it makes the revoke-then-
 * rotate step a compare-and-set, so two concurrent requests presenting the same
 * valid token can't both win the rotation. The partial index excludes revoked
 * rows (which are legitimately free to collide with a re-derived hash) and the
 * zero-rate collision space is already astronomically unlikely (32 random
 * bytes). It is defense-in-depth on top of the conditional UPDATE, not the
 * primary control.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    refreshHash: text('refresh_hash').notNull(),
    userAgent: text('user_agent'),
    ip: text('ip'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    refreshHashIdx: index('sessions_refresh_hash_idx').on(t.refreshHash),
    // Unique over refresh_hash WHERE the session is still active. Drizzle
    // surfaces a partial unique index via `where` on uniqueIndex.
    refreshHashActiveUniq: uniqueIndex('sessions_refresh_hash_active_uniq')
      .on(t.refreshHash)
      .where(sql`revoked_at IS NULL`),
    userIdx: index('sessions_user_idx').on(t.userId),
  }),
);

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
