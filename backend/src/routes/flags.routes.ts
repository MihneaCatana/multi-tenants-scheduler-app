import type { FastifyInstance } from 'fastify';
import { flagsController } from '../controllers/flags.controller.js';
import { requireTenantUser } from '../plugins/auth.js';

/**
 * Tenant-user feature flags (read-only resolved map for THIS tenant).
 *
 * Admin flag routes live in admin.routes.ts (registered under /v1/admin).
 * This file handles only the tenant-scoped GET endpoint.
 */
export async function flagsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', {
    preHandler: async (req) => requireTenantUser(req),
    handler: flagsController.getMyFlags,
  });
}
