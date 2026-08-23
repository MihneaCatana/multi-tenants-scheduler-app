import type { FastifyReply, FastifyRequest } from 'fastify';
import { auditLog } from '../lib/audit.js';
import {
  listStaffQuery,
  updateStaffBody,
  updateStatusBody,
  staffIdParam,
  createStaffBody,
} from '../modules/staff/schema.js';
import {
  listStaff,
  updateStaff,
  adminResetStaffPassword,
  setStaffStatus,
  createStaff,
  deleteStaff,
} from '../modules/staff/service.js';
import type { StaffMember } from '../modules/staff/service.js';

/**
 * Tenant-admin STAFF management handlers. "Staff" = the employees of a tenant
 * who can log in: the tenant admin and any tenant_user they create. These are
 * the login-identity rows of `people` (rows with `passwordHash IS NOT NULL`).
 *
 * The tenant's CLIENTS (customers without logins) are managed via /clients.
 * Both views read the same `people` table, filtered differently.
 *
 * Every handler runs behind requireTenantUser('tenant_admin') and operates on
 * `req.tenantDb` — the tenant's OWN database — so it can only ever touch the
 * calling tenant's staff. `tenantId` is echoed back from req.tenant.id for
 * frontend response-shape compatibility (it is not stored on the person row).
 */
function withTenantId<T extends object>(s: T, tenantId: string): T & { tenantId: string } {
  return { ...s, tenantId };
}

export const staffController = {
  async list(req: FastifyRequest, _reply: FastifyReply) {
    const q = listStaffQuery.parse(req.query);
    const rows = await listStaff(req.tenantDb!, {
      status: q.status,
      limit: q.limit,
      offset: q.offset,
    });
    return { staff: rows.map((s) => withTenantId(s, req.tenant!.id)) };
  },

  async create(req: FastifyRequest, reply: FastifyReply) {
    const input = createStaffBody.parse(req.body);
    const member = await createStaff(req.tenantDb!, input);
    auditLog(req, {
      action: 'staff.create',
      target: { resource: 'staff', id: member.id },
      msg: 'Tenant admin created a staff member.',
    });
    reply.status(201).send({ staff: withTenantId(member, req.tenant!.id) });
  },

  async update(req: FastifyRequest, reply: FastifyReply) {
    const { id } = staffIdParam.parse(req.params);
    const input = updateStaffBody.parse(req.body);
    const member = await updateStaff(req.tenantDb!, {
      targetId: id,
      actorId: req.userClaims!.sub,
      firstName: input.firstName,
      lastName: input.lastName,
      role: input.role,
    });
    auditLog(req, {
      action: 'staff.update',
      target: { resource: 'staff', id },
      msg: 'Tenant admin updated a staff member.',
      extra: { changed: Object.keys(input) },
    });
    reply.send({ staff: withTenantId(member, req.tenant!.id) });
  },

  async resetPassword(req: FastifyRequest, reply: FastifyReply) {
    const { id } = staffIdParam.parse(req.params);
    const result = await adminResetStaffPassword(req.tenantDb!, id);
    auditLog(req, {
      action: 'staff.password_reset',
      target: { resource: 'staff', id },
      msg: 'Tenant admin reset a staff password.',
    });
    reply.send(result);
  },

  async updateStatus(req: FastifyRequest, reply: FastifyReply) {
    const { id } = staffIdParam.parse(req.params);
    const { active } = updateStatusBody.parse(req.body);
    const member = await setStaffStatus(req.tenantDb!, {
      targetId: id,
      actorId: req.userClaims!.sub,
      active,
    });
    auditLog(req, {
      action: active ? 'staff.activate' : 'staff.deactivate',
      target: { resource: 'staff', id },
      msg: active ? 'Tenant admin activated a staff member.' : 'Tenant admin deactivated a staff member.',
    });
    reply.send({ staff: withTenantId(member, req.tenant!.id) });
  },

  async remove(req: FastifyRequest, reply: FastifyReply) {
    const { id } = staffIdParam.parse(req.params);
    await deleteStaff(req.tenantDb!, {
      targetId: id,
      actorId: req.userClaims!.sub,
    });
    auditLog(req, {
      action: 'staff.delete',
      target: { resource: 'staff', id },
      msg: 'Tenant admin soft-deleted a staff member.',
    });
    reply.status(204).send();
  },
};

// Re-exported for type ergonomics at import sites.
export type { StaffMember };
