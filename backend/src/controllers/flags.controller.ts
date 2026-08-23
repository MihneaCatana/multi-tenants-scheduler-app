import type { FastifyReply, FastifyRequest } from 'fastify';
import { auditLog } from '../lib/audit.js';
import { tenantIdParam, updateTenantFlagsBody } from '../modules/flags/schema.js';
import {
  listCatalog,
  getTenantFlagsList,
  setTenantFlags,
} from '../modules/flags/service.js';

/**
 * Platform-admin flag handlers (apex host) + tenant-user read handler
 * (subdomain). Admin handlers run behind `requirePlatformAdmin`; the tenant read
 * runs behind `requireTenantUser`.
 */
export const flagsController = {
  /** GET /admin/features — read-only catalog. */
  async listCatalog(_req: FastifyRequest, _reply: FastifyReply) {
    return { features: listCatalog() };
  },

  /** GET /admin/tenants/:id/flags — resolved per-tenant. */
  async getTenantFlags(req: FastifyRequest, reply: FastifyReply) {
    const { id } = tenantIdParam.parse(req.params);
    const flags = await getTenantFlagsList(id);
    reply.send({ flags });
  },

  /** PUT /admin/tenants/:id/flags — upsert overrides, audit, return resolved. */
  async updateTenantFlags(req: FastifyRequest, reply: FastifyReply) {
    const { id } = tenantIdParam.parse(req.params);
    const { flags } = updateTenantFlagsBody.parse(req.body);

    // Compute the before-state for the audit diff.
    const before = await getTenantFlagsList(id);
    const beforeMap = new Map(before.map((f) => [f.key, f.enabled]));

    const resolved = await setTenantFlags(id, flags);

    const changes: Record<string, [boolean, boolean]> = {};
    for (const o of flags) {
      const from = beforeMap.get(o.key);
      if (from !== o.enabled) changes[o.key] = [from ?? false, o.enabled];
    }
    auditLog(req, {
      action: 'tenant.flags_update',
      target: { resource: 'tenant', id },
      msg: 'Platform admin updated tenant feature flags.',
      extra: { changes },
    });

    reply.send({ flags: resolved });
  },

  /** GET /features (tenant subdomain) — this tenant's resolved map. */
  async getMyFlags(req: FastifyRequest, _reply: FastifyReply) {
    return { flags: req.tenantFlags ?? {} };
  },
};
