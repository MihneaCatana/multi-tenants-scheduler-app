import { and, eq, isNull } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { staff } from '../../db/schema/tenant/staff.js';
import type { tenantSchema } from '../../db/schema/tenant/index.js';
import { hashPassword, generateToken } from '../../lib/crypto.js';
import { revokeAllTenantSessions } from '../auth/tenant-service.js';
import { staffNotFound, cannotChangeOwnRole, cannotDeactivateSelf, staffAlreadyHasStatus, staffEmailTaken, staffAlreadyDeleted } from '../../lib/errors.js';
import { Role } from '../../lib/roles.js';

/**
 * Tenant staff management — operates on the tenant's OWN `staff` table (login
 * identities: the tenant's employees) and `tenant_sessions`. Every function
 * takes the tenant DB handle (`req.tenantDb`), so a request can only ever touch
 * the calling tenant's rows — cross-tenant access is not possible.
 *
 * `staff` is physically separate from `clients` (the tenant's customers, who
 * cannot log in). There is no "can this row log in?" filter here — every staff
 * row is a login identity by construction.
 *
 * `StaffMember` omits `tenantId`: the tenant is implicit in which DB we read,
 * and the controller echoes `req.tenant.id` back for response-shape compat.
 */

type TenantDb = NodePgDatabase<typeof tenantSchema>;

export interface StaffMember {
  id: string;
  email: string;
  role: Role;
  firstName: string | null;
  lastName: string | null;
  active: boolean;
  mustChangePassword: boolean;
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

function toMember(r: StaffMember): StaffMember {
  return { ...r };
}

/**
 * Load a staff member by id. Throws 404 if not found.
 */
async function loadMember(db: TenantDb, staffId: string): Promise<StaffMember> {
  const [row] = await db.select(staffSelect).from(staff)
    .where(and(eq(staff.id, staffId), isNull(staff.deletedAt)))
    .limit(1);
  if (!row) throw staffNotFound();
  return toMember(row);
}

export interface ListStaffInput {
  status?: 'active' | 'inactive';
  limit: number;
  offset: number;
}

export async function listStaff(db: TenantDb, input: ListStaffInput): Promise<StaffMember[]> {
  const rows = await db
    .select({ ...staffSelect, createdAt: staff.createdAt })
    .from(staff)
    .where(
      and(
        isNull(staff.deletedAt),
        input.status !== undefined ? eq(staff.active, input.status === 'active') : undefined,
      ),
    )
    .limit(input.limit)
    .offset(input.offset)
    .orderBy(staff.createdAt);
  return rows.map((r) =>
    toMember({
      id: r.id,
      email: r.email,
      role: r.role,
      firstName: r.firstName,
      lastName: r.lastName,
      active: r.active,
      mustChangePassword: r.mustChangePassword,
    }),
  );
}

export async function updateStaff(
  db: TenantDb,
  args: {
    targetId: string;
    actorId: string;
    firstName?: string;
    lastName?: string;
    role?: 'tenant_admin' | 'tenant_user';
  },
): Promise<StaffMember> {
  const target = await loadMember(db, args.targetId);
  // A tenant admin may not change their own role (prevents self-demotion /
  // escalation edge cases).
  if (args.role !== undefined && args.targetId === args.actorId) {
    throw cannotChangeOwnRole();
  }
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (args.firstName !== undefined) set.firstName = args.firstName;
  if (args.lastName !== undefined) set.lastName = args.lastName;
  if (args.role !== undefined) set.role = args.role;

  const [updated] = await db
    .update(staff)
    .set(set)
    .where(eq(staff.id, target.id))
    .returning(staffSelect);
  return toMember(updated!);
}

export interface ResetPasswordResult {
  temporaryPassword: string;
}

/**
 * Admin-initiated password reset: generate a random temp password, hash it, set
 * must_change_password, and revoke all of the member's tenant sessions. The temp
 * password is returned ONCE for the admin to communicate out-of-band.
 */
export async function adminResetStaffPassword(
  db: TenantDb,
  staffId: string,
): Promise<ResetPasswordResult> {
  const target = await loadMember(db, staffId);
  // generateToken(12) produces ~16 base64url chars (~96 bits of entropy) — strong
  // enough for a temp password the user must change immediately.
  const temporaryPassword = generateToken(12).slice(0, 16);
  const hash = await hashPassword(temporaryPassword);
  await db
    .update(staff)
    .set({ passwordHash: hash, mustChangePassword: true, updatedAt: new Date() })
    .where(eq(staff.id, target.id));
  await revokeAllTenantSessions(db, target.id);
  return { temporaryPassword };
}

export async function setStaffStatus(
  db: TenantDb,
  args: { targetId: string; actorId: string; active: boolean },
): Promise<StaffMember> {
  const target = await loadMember(db, args.targetId);
  // A tenant admin may not deactivate themselves (prevents lockout).
  if (!args.active && args.targetId === args.actorId) {
    throw cannotDeactivateSelf();
  }
  if (target.active === args.active) {
    throw staffAlreadyHasStatus(args.active);
  }
  const [updated] = await db
    .update(staff)
    .set({ active: args.active, updatedAt: new Date() })
    .where(eq(staff.id, target.id))
    .returning(staffSelect);
  if (!args.active) {
    // Stop the deactivated member from refreshing into new access tokens.
    await revokeAllTenantSessions(db, target.id);
  }
  return toMember(updated!);
}

/**
 * Create a new staff member (a tenant_user login identity). Used by the tenant
 * admin's staff-management flow; self-signup is not provided.
 */
export async function createStaff(
  db: TenantDb,
  input: { email: string; password: string; firstName?: string; lastName?: string },
): Promise<StaffMember> {
  const email = input.email.toLowerCase().trim();
  const [existing] = await db.select({ id: staff.id }).from(staff)
    .where(and(eq(staff.email, email), isNull(staff.deletedAt)))
    .limit(1);
  if (existing) throw staffEmailTaken();

  const passwordHash = await hashPassword(input.password);
  const [created] = await db
    .insert(staff)
    .values({
      email,
      passwordHash,
      role: Role.TENANT_USER,
      firstName: input.firstName,
      lastName: input.lastName,
    })
    .returning(staffSelect);
  return toMember(created!);
}

/**
 * Soft-delete a staff member. Sets `deletedAt` and revokes all their sessions.
 * The staff member becomes completely invisible to the application.
 * Cannot delete yourself. Cannot delete an already-deleted member.
 */
export async function deleteStaff(
  db: TenantDb,
  args: { targetId: string; actorId: string },
): Promise<void> {
  const target = await loadMember(db, args.targetId);
  if (args.targetId === args.actorId) {
    throw cannotChangeOwnRole(); // Cannot delete yourself (reuses 403).
  }
  // Double-check not already deleted (loadMember filters deleted rows,
  // but this guard is for a direct call where we want a specific error).
  const [existing] = await db.select({ deletedAt: staff.deletedAt }).from(staff)
    .where(eq(staff.id, args.targetId))
    .limit(1);
  if (existing?.deletedAt) throw staffAlreadyDeleted();

  const now = new Date();
  await db
    .update(staff)
    .set({ deletedAt: now, updatedAt: now })
    .where(eq(staff.id, target.id));

  // Revoke all sessions so the deleted member can no longer refresh tokens.
  await revokeAllTenantSessions(db, target.id);
}
