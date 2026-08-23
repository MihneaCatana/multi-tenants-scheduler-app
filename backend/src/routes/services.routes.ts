import type { FastifyInstance } from 'fastify';
import { servicesController } from '../controllers/services.controller.js';
import { requireAppointments } from '../lib/require-appointments.js';
import { Role } from '../lib/roles.js';

/**
 * Tenant-scoped SERVICES catalog CRUD + nested requirements. Reads open to any
 * tenant user; writes require tenant_admin. Gated on APPOINTMENTS flag.
 */
export async function serviceRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: requireAppointments(), handler: servicesController.list });
  app.get('/:id', { preHandler: requireAppointments(), handler: servicesController.getById });
  app.post('/', {
    preHandler: requireAppointments({ roles: [Role.TENANT_ADMIN] }),
    handler: servicesController.create,
  });
  app.patch('/:id', {
    preHandler: requireAppointments({ roles: [Role.TENANT_ADMIN] }),
    handler: servicesController.update,
  });
  app.delete('/:id', {
    preHandler: requireAppointments({ roles: [Role.TENANT_ADMIN] }),
    handler: servicesController.remove,
  });
  app.get('/:id/requirements', {
    preHandler: requireAppointments(),
    handler: servicesController.listRequirements,
  });
  app.put('/:id/requirements', {
    preHandler: requireAppointments({ roles: [Role.TENANT_ADMIN] }),
    handler: servicesController.replaceRequirements,
  });
}
