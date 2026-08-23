import type { FastifyInstance } from 'fastify';
import { clientsController } from '../controllers/clients.controller.js';
import { requireTenantUser } from '../plugins/auth.js';
import { Role } from '../lib/roles.js';

/**
 * Tenant-scoped CLIENTS (customers) CRUD. Reads are open to any tenant user;
 * writes require a tenant_admin. Operates on the `clients` table via
 * req.tenantDb — physically separate from `staff`.
 */
export async function clientRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', {
    preHandler: async (req) => requireTenantUser(req),
    handler: clientsController.list,
  });

  app.get('/:id', {
    preHandler: async (req) => requireTenantUser(req),
    handler: clientsController.getById,
  });

  app.post('/', {
    preHandler: async (req) => requireTenantUser(req, { roles: [Role.TENANT_ADMIN] }),
    handler: clientsController.create,
  });

  app.patch('/:id', {
    preHandler: async (req) => requireTenantUser(req, { roles: [Role.TENANT_ADMIN] }),
    handler: clientsController.update,
  });

  app.delete('/:id', {
    preHandler: async (req) => requireTenantUser(req, { roles: [Role.TENANT_ADMIN] }),
    handler: clientsController.remove,
  });
}
