import type { FastifyInstance } from 'fastify';
import { resourcesController } from '../controllers/resources.controller.js';
import { requireAppointments } from '../lib/require-appointments.js';
import { Role } from '../lib/roles.js';

/**
 * Tenant-scoped RESOURCES CRUD. Reads open to any tenant user; writes require
 * tenant_admin. All gated on the APPOINTMENTS feature flag.
 */
export async function resourceRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: requireAppointments(), handler: resourcesController.list });
  app.get('/:id', { preHandler: requireAppointments(), handler: resourcesController.getById });
  app.post('/', {
    preHandler: requireAppointments({ roles: [Role.TENANT_ADMIN] }),
    handler: resourcesController.create,
  });
  app.patch('/:id', {
    preHandler: requireAppointments({ roles: [Role.TENANT_ADMIN] }),
    handler: resourcesController.update,
  });
  app.delete('/:id', {
    preHandler: requireAppointments({ roles: [Role.TENANT_ADMIN] }),
    handler: resourcesController.remove,
  });
}
