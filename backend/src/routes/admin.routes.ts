import type { FastifyInstance } from 'fastify';
import { adminController } from '../controllers/admin.controller.js';
import { flagsController } from '../controllers/flags.controller.js';
import { requirePlatformAdmin } from '../plugins/auth.js';
import { env } from '../config/env.js';

/**
 * Platform-admin routes. These run on the apex host (no tenant). All handlers
 * require a platform_admin access token — staff who by construction have no
 * tenantId and therefore no path to any tenant's data.
 *
 * Includes both tenant management routes and feature flag admin routes.
 */
export async function adminRoutes(app: FastifyInstance): Promise<void> {
  // --- Tenant management ---

  app.get('/tenants', {
    preHandler: async (req) => requirePlatformAdmin(req),
    handler: adminController.listTenants,
  });

  app.post('/tenants', {
    preHandler: async (req) => requirePlatformAdmin(req),
    config: { rateLimit: { max: env.RATE_LIMIT_AUTH_MAX, timeWindow: env.RATE_LIMIT_GLOBAL_WINDOW } },
    handler: adminController.provisionTenant,
  });

  // -------------------------------------------------------------------------
  // Suspend / activate a tenant. On suspend we additionally close the cached
  // tenant DB pool and revoke all of the tenant's users' refresh sessions.
  // -------------------------------------------------------------------------
  app.patch('/tenants/:id/status', {
    preHandler: async (req) => requirePlatformAdmin(req),
    config: { rateLimit: { max: env.RATE_LIMIT_MUTATION_MAX, timeWindow: env.RATE_LIMIT_GLOBAL_WINDOW } },
    handler: adminController.updateTenantStatus,
  });

  // --- Feature flag management ---

  app.get('/features', {
    preHandler: async (req) => requirePlatformAdmin(req),
    handler: flagsController.listCatalog,
  });

  app.get('/tenants/:id/flags', {
    preHandler: async (req) => requirePlatformAdmin(req),
    handler: flagsController.getTenantFlags,
  });

  app.put('/tenants/:id/flags', {
    preHandler: async (req) => requirePlatformAdmin(req),
    config: { rateLimit: { max: env.RATE_LIMIT_MUTATION_MAX, timeWindow: env.RATE_LIMIT_GLOBAL_WINDOW } },
    handler: flagsController.updateTenantFlags,
  });
}
