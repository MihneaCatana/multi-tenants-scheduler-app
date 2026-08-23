import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { globalDb } from '../db/client.js';
import { tenants } from '../db/schema/global/tenants.js';
import { provisionTenant } from '../modules/tenants/provision.js';
import { provisionOwnerBody } from '../modules/auth/schema.js';
import { closeTenantById, tenantDbFor } from '../db/tenant-pool.js';
import { revokeAllSessionsInTenantDb } from '../modules/auth/tenant-service.js';
import { notFound, tenantAlreadyHasStatus, tenantConcurrentUpdate } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

const listTenantsQuery = z.object({
  status: z.enum(['active', 'suspended']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const provisionBody = provisionOwnerBody.extend({
  name: z.string().min(1).max(120),
  subdomain: z.string().min(2).max(63),
});

const tenantIdParam = z.object({
  id: z.string().uuid(),
});

const updateStatusBody = z.object({
  status: z.enum(['active', 'suspended']),
});

/**
 * Platform-admin request handlers. These run on the apex host (no tenant).
 * (The platform_admin guard lives in each route's preHandler.) Handlers never
 * reference `this`; Fastify invokes them as `(req, reply)`.
 */
export const adminController = {
  async listTenants(req: FastifyRequest, _reply: FastifyReply) {
    const q = listTenantsQuery.parse(req.query);
    const rows = await globalDb
      .select({
        id: tenants.id,
        name: tenants.name,
        subdomain: tenants.subdomain,
        status: tenants.status,
        createdAt: tenants.createdAt,
      })
      .from(tenants)
      .where(q.status ? eq(tenants.status, q.status) : undefined)
      .limit(q.limit)
      .offset(q.offset)
      .orderBy(tenants.createdAt);
    return { tenants: rows };
  },

  async provisionTenant(req: FastifyRequest, reply: FastifyReply) {
    const input = provisionBody.parse(req.body);
    const result = await provisionTenant({
      name: input.name,
      subdomain: input.subdomain,
      ownerEmail: input.email,
      ownerPassword: input.password,
      ownerFirstName: input.firstName,
      ownerLastName: input.lastName,
    });
    reply.status(201).send(result);
  },

  /**
   * Suspend / activate a tenant. On suspend we additionally close the cached
   * tenant DB pool and revoke all of the tenant's users' refresh sessions, so
   * no new access tokens can be minted and the pool doesn't keep an open
   * connection to a now-dark database. The tenant-resolution hook already
   * rejects non-active tenants on every request — this handler is the
   * controlled way to flip that status and its side effects in one place.
   */
  async updateTenantStatus(req: FastifyRequest, reply: FastifyReply) {
    const { id } = tenantIdParam.parse(req.params);
    const { status } = updateStatusBody.parse(req.body);

    const [tenant] = await globalDb
      .select({ id: tenants.id, name: tenants.name, status: tenants.status, dbName: tenants.dbName, subdomain: tenants.subdomain })
      .from(tenants)
      .where(eq(tenants.id, id))
      .limit(1);
    if (!tenant) throw notFound();

    if (tenant.status === status) {
      throw tenantAlreadyHasStatus(status);
    }

    const [updated] = await globalDb
      .update(tenants)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(tenants.id, id), eq(tenants.status, tenant.status)))
      .returning({
        id: tenants.id,
        name: tenants.name,
        subdomain: tenants.subdomain,
        status: tenants.status,
        updatedAt: tenants.updatedAt,
      });

    // CAS guard: status changed under us — report current state rather than
    // acting on stale data.
    if (!updated) {
      throw tenantConcurrentUpdate();
    }

    if (status === 'suspended') {
      // Revoke all tenant sessions (via the tenant DB) THEN drop the cached
      // pool. Order matters: revoke while the pool is still open, then close it
      // so members can't keep refreshing access tokens.
      const tenantDb = tenantDbFor(tenant.id, tenant.dbName, tenant.subdomain);
      const revoked = await revokeAllSessionsInTenantDb(tenantDb);
      await closeTenantById(tenant.id, tenant.dbName);
      logger.info(
        { tenantId: tenant.id, status, dbName: tenant.dbName, revokedSessions: revoked },
        'Tenant suspended; sessions revoked + pool closed.',
      );
    } else {
      logger.info({ tenantId: tenant.id, status }, 'Tenant activated.');
    }

    reply.send({ tenant: updated });
  },
};
