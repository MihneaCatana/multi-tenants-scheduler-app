import { and, eq, isNotNull, isNull, lt, or } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { globalDb } from '../../db/client.js';
import { users } from '../../db/schema/global/users.js';
import { sessions } from '../../db/schema/global/sessions.js';
import { env, ttlToSeconds } from '../../config/env.js';
import { hashPassword, verifyPassword, generateToken, hashToken, timingSafeEqualStrings } from '../../lib/crypto.js';
import { invalidCredentials, invalidRefreshToken, tokenReuseDetected, tokenExpired, userGone } from '../../lib/errors.js';
import { Role, TENANT_ROLES } from '../../lib/roles.js';
import type { User } from '../../db/schema/global/users.js';

const REFRESH_TTL_SECONDS = ttlToSeconds(env.REFRESH_TOKEN_TTL);

export interface PublicUser {
  id: string;
  email: string;
  role: Role;
  tenantId: string | null;
  firstName: string | null;
  lastName: string | null;
  active: boolean;
  mustChangePassword: boolean;
}

export interface AuthResult {
  user: PublicUser;
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // seconds
}

function publicUser(u: User): PublicUser {
  return {
    id: u.id,
    email: u.email,
    role: u.role,
    // Global users are platform admins only — never tenant-scoped.
    tenantId: null,
    firstName: u.firstName,
    lastName: u.lastName,
    active: u.active,
    mustChangePassword: u.mustChangePassword,
  };
}

/**
 * Create a refresh token row and return the raw token to send to the client.
 * Only the hash is persisted.
 */
async function issueRefresh(
  userId: string,
  req: FastifyRequest,
): Promise<{ token: string; id: string }> {
  const raw = generateToken(32);
  const refreshHash = hashToken(raw);
  const [row] = await globalDb
    .insert(sessions)
    .values({
      userId,
      refreshHash,
      userAgent: req.headers['user-agent']?.slice(0, 500),
      ip: req.ip?.slice(0, 64),
      expiresAt: new Date(Date.now() + REFRESH_TTL_SECONDS * 1000),
    })
    .returning({ id: sessions.id });
  return { token: raw, id: row!.id };
}

/**
 * Register a NEW tenant user.
 *
 * NOTE: tenant-user registration now lives in the tenant auth service
 * (src/modules/auth/tenant-service.ts → registerTenantPerson), operating on the
 * tenant's `people` table. This module is GLOBAL auth (platform admins) only.
 */

export async function authenticate(
  email: string,
  password: string,
  req: FastifyRequest,
): Promise<AuthResult> {
  const [user] = await globalDb
    .select()
    .from(users)
    .where(eq(users.email, email.toLowerCase().trim()))
    .limit(1);

  // Constant-ish time: if no user, still pay the hashing cost.
  if (!user) {
    await hashPassword(password);
    throw invalidCredentials();
  }
  const ok = await verifyPassword(user.passwordHash, password);
  // Inactive users may not authenticate. Use the same generic message as a bad
  // password so we don't leak account status.
  if (!ok || !user.active) throw invalidCredentials();

  return issueTokensFor(user, req);
}

export async function issueTokensFor(user: User, req: FastifyRequest): Promise<AuthResult> {
  const { token } = await issueRefresh(user.id, req);
  return {
    user: publicUser(user),
    accessToken: '', // filled in by the route layer (needs app instance for signing)
    refreshToken: token,
    expiresIn: ttlToSeconds(env.ACCESS_TOKEN_TTL),
  };
}

export interface RefreshContext {
  app: { signAccessToken: (p: { sub: string; role: Role; tenantId: string | null }) => string };
}

/**
 * Refresh-rotation: validate the presented token against its hash, revoke it,
 * issue a new pair. Detects token reuse (a revoked-but-presented token means
 * theft — we revoke ALL of that user's sessions in that case).
 *
 * The revoke step is a single compare-and-set UPDATE (revoked_at IS NULL →
 * now()), not a read-then-revoke. Under READ COMMITTED two concurrent refresh
 * requests presenting the same token could both read the row as un-revoked
 * before either lands its UPDATE; a plain UPDATE would then let both proceed.
 * The conditional WHERE means exactly one of the two racers can flip the row —
 * the loser gets zero rows back and we treat that as reuse → revoke all. The
 * partial unique index `sessions_refresh_hash_active_uniq` backs this up at the
 * DB level.
 */
export async function rotateRefreshToken(
  presentedToken: string,
  req: FastifyRequest,
): Promise<AuthResult> {
  const presentedHash = hashToken(presentedToken);

  const [row] = await globalDb
    .select()
    .from(sessions)
    .where(eq(sessions.refreshHash, presentedHash))
    .limit(1);

  if (!row) throw invalidRefreshToken();
  if (row.revokedAt) {
    // Token reuse — likely theft. Revoke every active session for this user.
    await revokeAllSessions(row.userId);
    throw tokenReuseDetected();
  }
  if (row.expiresAt.getTime() < Date.now()) {
    await globalDb
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(eq(sessions.id, row.id));
    throw tokenExpired();
  }

  // Compare-and-set revoke: only flips the row if it is still active. If a
  // concurrent request already revoked it, this returns [] → reuse detected.
  const rotated = await globalDb
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.id, row.id), isNull(sessions.revokedAt)))
    .returning({ id: sessions.id });

  if (rotated.length === 0) {
    await revokeAllSessions(row.userId);
    throw tokenReuseDetected();
  }

  const [user] = await globalDb
    .select()
    .from(users)
    .where(eq(users.id, row.userId))
    .limit(1);
  if (!user) throw userGone();
  // A deactivated user must not be able to mint new access tokens. Revoke the
  // rotated session and reject.
  if (!user.active) {
    await globalDb
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(eq(sessions.id, row.id));
    throw invalidRefreshToken();  }

  const { token } = await issueRefresh(user.id, req);
  return {
    user: publicUser(user),
    accessToken: '',
    refreshToken: token,
    expiresIn: ttlToSeconds(env.ACCESS_TOKEN_TTL),
  };
}

export async function revokeSessionByToken(token: string): Promise<void> {
  const hash = hashToken(token);
  await globalDb
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.refreshHash, hash), isNull(sessions.revokedAt)));
}

export async function revokeAllSessions(userId: string): Promise<void> {
  await globalDb
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
}

/**
 * Revoke every active refresh session belonging to users of a given tenant.
 * Used when a tenant is suspended, so that no member of that tenant can refresh
 * an access token (existing short-lived access tokens still expire normally).
 * Returns the number of sessions revoked.
 */
/**
 * Revoke all GLOBAL (platform-admin) sessions. Tenant sessions now live in each
 * tenant's own `tenant_sessions` table; revoking those is handled by the tenant
 * auth service (revokeAllTenantSessionsInDb) at suspend time. This function is
 * kept for completeness/global-session maintenance only.
 */
export async function revokeAllGlobalSessions(): Promise<number> {
  const result = await globalDb
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(isNull(sessions.revokedAt))
    .returning({ id: sessions.id });
  return result.length;
}

/** Purge expired/revoked sessions — call from a periodic job. */
export async function purgeStaleSessions(): Promise<number> {
  const cutoff = new Date(Date.now() - 7 * 86_400_000); // keep revoked rows 7d for forensics
  const result = await globalDb
    .delete(sessions)
    .where(
      or(
        lt(sessions.expiresAt, new Date()),
        and(isNotNull(sessions.revokedAt), lt(sessions.revokedAt, cutoff)),
      ),
    )
    .returning({ id: sessions.id });
  return result.length;
}

/**
 * Change the calling user's own password. Verifies the current password, sets
 * the new hash, clears `must_change_password`, and revokes every OTHER session
 * (so old sessions on other devices can't keep refreshing with the old password).
 * Returns true on success; false if the current password is wrong.
 */
export async function changeOwnPassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<boolean> {
  const [user] = await globalDb
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) throw invalidCredentials();

  const ok = await verifyPassword(user.passwordHash, currentPassword);
  if (!ok) return false;

  const newHash = await hashPassword(newPassword);
  await globalDb
    .update(users)
    .set({ passwordHash: newHash, mustChangePassword: false, updatedAt: new Date() })
    .where(eq(users.id, userId));

  // Revoke all sessions; the caller re-authenticates / refreshes afterward.
  await revokeAllSessions(userId);
  return true;
}

export { publicUser, timingSafeEqualStrings };
export const TENANT_ALLOWED_ROLES = TENANT_ROLES;
