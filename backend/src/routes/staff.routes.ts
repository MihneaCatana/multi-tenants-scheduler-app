import type { FastifyInstance } from 'fastify';
import { staffController } from '../controllers/staff.controller.js';
import { requireTenantUser } from '../plugins/auth.js';
import { Role } from '../lib/roles.js';
import { env } from '../config/env.js';

/**
 * Tenant-scoped STAFF management (the tenant's employees who can log in). All
 * routes require a tenant_admin whose JWT tenantId matches the resolved
 * subdomain (enforced by requireTenantUser). Operates on the `staff` table via
 * req.tenantDb — physically separate from `clients`.
 */
export async function staffRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', {
    preHandler: async (req) => requireTenantUser(req, { roles: [Role.TENANT_ADMIN] }),
    handler: staffController.list,
  });

  app.post('/', {
    preHandler: async (req) => requireTenantUser(req, { roles: [Role.TENANT_ADMIN] }),
    config: { rateLimit: { max: env.RATE_LIMIT_MUTATION_MAX, timeWindow: env.RATE_LIMIT_GLOBAL_WINDOW } },
    handler: staffController.create,
  });

  app.patch('/:id', {
    preHandler: async (req) => requireTenantUser(req, { roles: [Role.TENANT_ADMIN] }),
    config: { rateLimit: { max: env.RATE_LIMIT_HEAVY_MUTATION_MAX, timeWindow: env.RATE_LIMIT_GLOBAL_WINDOW } },
    handler: staffController.update,
  });

  app.post('/:id/reset-password', {
    preHandler: async (req) => requireTenantUser(req, { roles: [Role.TENANT_ADMIN] }),
    config: { rateLimit: { max: env.RATE_LIMIT_AUTH_MAX, timeWindow: env.RATE_LIMIT_GLOBAL_WINDOW } },
    handler: staffController.resetPassword,
  });

  app.patch('/:id/status', {
    preHandler: async (req) => requireTenantUser(req, { roles: [Role.TENANT_ADMIN] }),
    config: { rateLimit: { max: env.RATE_LIMIT_MUTATION_MAX, timeWindow: env.RATE_LIMIT_GLOBAL_WINDOW } },
    handler: staffController.updateStatus,
  });

  app.delete('/:id', {
    preHandler: async (req) => requireTenantUser(req, { roles: [Role.TENANT_ADMIN] }),
    config: { rateLimit: { max: env.RATE_LIMIT_AUTH_MAX, timeWindow: env.RATE_LIMIT_GLOBAL_WINDOW } },
    handler: staffController.remove,
  });
}
