import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { staff, tenantSessions } from '../../db/schema/tenant/index.js';
import type { tenantSchema } from '../../db/schema/tenant/index.js';
import { env, ttlToSeconds } from '../../config/env.js';
import { hashPassword, verifyPassword, generateToken, hashToken } from '../../lib/crypto.js';
import { invalidCredentials, invalidRefreshToken, tokenReuseDetected, tokenExpired, userGone } from '../../lib/errors.js';
import { Role } from '../../lib/roles.js';

/**
 * Tenant-local authentication.
 *
 * Mirror of the global auth service (src/modules/auth/service.ts), but every
 * operation runs against a tenant's OWN database: `staff` (login identities —
 * the tenant's employees) and `tenant_sessions` (refresh tokens). Platform-admin
 * auth stays global; this module only handles tenant subdomain logins.
 *
 * Every `staff` row is a login identity by construction (passwordHash + role are
 * NOT NULL on the table), so there is no "can this row log in?" filter — unlike
 * the old unified `people` table. Clients (the tenant's customers) live in a
 * separate `clients` table and can never authenticate.
 */

type TenantDb = NodePgDatabase<typeof tenantSchema>;

const REFRESH_TTL_SECONDS = ttlToSeconds(env.REFRESH_TOKEN_TTL);

export interface TenantPublicUser {
  id: string;
  email: string;
  role: Role;
  firstName: string | null;
  lastName: string | null;
  active: boolean;
  mustChangePassword: boolean;
}

export interface TenantAuthResult {
  user: TenantPublicUser;
  refreshToken: string;
  expiresIn: number; // seconds
}

const staffSelect = {
  id: staff.id,
  email: staff.email,
  role: staff.role,
  firstName: staff.firstName,
  lastName: staff.lastName,
  active: staff.active,
  mustChangePassword: staff.mustChangePassword,
} as const;

function publicUser(s: TenantPublicUser): TenantPublicUser {
  return { ...s };
}

/** Load a staff member by email. Returns null if no such login identity. */
async function loadStaffByEmail(db: TenantDb, email: string): Promise<TenantPublicUser | null> {
  const rows = await db
    .select(staffSelect)
    .from(staff)
    .where(and(eq(staff.email, email), isNull(staff.deletedAt)))
    .limit(1);
  return rows[0] ?? null;
}

/** Load a staff member by id. Returns null if no such login identity. */
async function loadStaffById(db: TenantDb, staffId: string): Promise<TenantPublicUser | null> {
  const rows = await db
    .select(staffSelect)
    .from(staff)
    .where(and(eq(staff.id, staffId), isNull(staff.deletedAt)))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Create a refresh session row in the tenant DB and return the raw token. Only
 * the SHA-256 hash is persisted.
 */
async function issueTenantRefresh(
  db: TenantDb,
  staffId: string,
  req: FastifyRequest,
): Promise<string> {
  const raw = generateToken(32);
  const refreshHash = hashToken(raw);
  await db.insert(tenantSessions).values({
    staffId,
    refreshHash,
    userAgent: req.headers['user-agent']?.slice(0, 500),
    ip: req.ip?.slice(0, 64),
    expiresAt: new Date(Date.now() + REFRESH_TTL_SECONDS * 1000),
  });
  return raw;
}

/**
 * Verify email/password against the tenant's `staff`. Same generic "Invalid
 * email or password." message on any failure so account status isn't leaked.
 * Constant-ish time: pays the hashing cost even when no user exists.
 */
export async function authenticateTenant(
  db: TenantDb,
  email: string,
  password: string,
  req: FastifyRequest,
): Promise<TenantAuthResult> {
  const member = await loadStaffByEmail(db, email.toLowerCase().trim());
  if (!member) {
    await hashPassword(password); // constant-ish time
    throw invalidCredentials();
  }
  const hashRow = await db
    .select({ passwordHash: staff.passwordHash })
    .from(staff)
    .where(and(eq(staff.id, member.id), isNull(staff.deletedAt)))
    .limit(1);
  const hash = hashRow[0]?.passwordHash;
  if (!hash) {
    // Unreachable (passwordHash is NOT NULL on staff), defended in depth.
    throw invalidCredentials();
  }
  const ok = await verifyPassword(hash, password);
  if (!ok || !member.active) throw invalidCredentials();

  const refreshToken = await issueTenantRefresh(db, member.id, req);
  return {
    user: publicUser(member),
    refreshToken,
    expiresIn: ttlToSeconds(env.ACCESS_TOKEN_TTL),
  };
}

/** Load a staff member by id for /auth/me. Returns null if not found. */
export async function loadTenantStaffById(
  db: TenantDb,
  staffId: string,
): Promise<TenantPublicUser | null> {
  return loadStaffById(db, staffId);
}

/**
 * Refresh rotation against the tenant DB. Same compare-and-set rotation +
 * reuse-detection logic as the global service, just on `tenant_sessions`.
 */
export async function rotateTenantRefreshToken(
  db: TenantDb,
  presentedToken: string,
  req: FastifyRequest,
): Promise<TenantAuthResult> {
  const presentedHash = hashToken(presentedToken);

  const rows = await db
    .select()
    .from(tenantSessions)
    .where(eq(tenantSessions.refreshHash, presentedHash))
    .limit(1);
  const row = rows[0];
  if (!row) throw invalidRefreshToken();
  if (row.revokedAt) {
    await revokeAllTenantSessions(db, row.staffId);
    throw tokenReuseDetected();
  }
  if (row.expiresAt.getTime() < Date.now()) {
    await db
      .update(tenantSessions)
      .set({ revokedAt: new Date() })
      .where(eq(tenantSessions.id, row.id));
    throw tokenExpired();
  }

  // Compare-and-set revoke.
  const rotated = await db
    .update(tenantSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(tenantSessions.id, row.id), isNull(tenantSessions.revokedAt)))
    .returning({ id: tenantSessions.id });
  if (rotated.length === 0) {
    await revokeAllTenantSessions(db, row.staffId);
    throw tokenReuseDetected();
  }

  const member = await loadStaffById(db, row.staffId);
  if (!member) throw userGone();
  if (!member.active) {
    await db
      .update(tenantSessions)
      .set({ revokedAt: new Date() })
      .where(eq(tenantSessions.id, row.id));
    throw invalidRefreshToken();  }

  const refreshToken = await issueTenantRefresh(db, member.id, req);
  return {
    user: publicUser(member),
    refreshToken,
    expiresIn: ttlToSeconds(env.ACCESS_TOKEN_TTL),
  };
}

export async function revokeTenantSessionByToken(db: TenantDb, token: string): Promise<void> {
  const hash = hashToken(token);
  await db
    .update(tenantSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(tenantSessions.refreshHash, hash), isNull(tenantSessions.revokedAt)));
}

export async function revokeAllTenantSessions(db: TenantDb, staffId: string): Promise<void> {
  await db
    .update(tenantSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(tenantSessions.staffId, staffId), isNull(tenantSessions.revokedAt)));
}

/**
 * Revoke EVERY active session in a tenant DB — used when a tenant is suspended
 * (all members immediately lose refresh ability). Returns the count revoked.
 */
export async function revokeAllSessionsInTenantDb(db: TenantDb): Promise<number> {
  const result = await db
    .update(tenantSessions)
    .set({ revokedAt: new Date() })
    .where(isNull(tenantSessions.revokedAt))
    .returning({ id: tenantSessions.id });
  return result.length;
}

/**
 * Self-service password change against the tenant DB. Verifies the current
 * password, sets the new hash, clears `must_change_password`, and revokes all
 * sessions. Returns true on success; false if the current password is wrong.
 */
export async function changeTenantOwnPassword(
  db: TenantDb,
  staffId: string,
  currentPassword: string,
  newPassword: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: staff.id, passwordHash: staff.passwordHash })
    .from(staff)
    .where(and(eq(staff.id, staffId), isNull(staff.deletedAt)))
    .limit(1);
  const row = rows[0];
  if (!row) throw invalidCredentials();

  const ok = await verifyPassword(row.passwordHash, currentPassword);
  if (!ok) return false;

  const newHash = await hashPassword(newPassword);
  await db
    .update(staff)
    .set({ passwordHash: newHash, mustChangePassword: false, updatedAt: new Date() })
    .where(eq(staff.id, staffId));

  await revokeAllTenantSessions(db, staffId);
  return true;
}
