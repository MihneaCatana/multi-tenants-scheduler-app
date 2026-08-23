import type { FastifyInstance } from 'fastify';
import { availabilityController } from '../controllers/availability.controller.js';
import { requireAppointments } from '../lib/require-appointments.js';
import { Role } from '../lib/roles.js';

/**
 * Tenant-scoped AVAILABILITY: working hours + time off per resource, plus the
 * tenant timezone setting. Reads open to any tenant user; writes require admin.
 *
 * Registered under /v1 (NOT /v1/availability) because the paths are mixed:
 * /resources/:id/working-hours, /working-hours/:id, /time-off/:id, /settings/timezone.
 */
export async function availabilityRoutes(app: FastifyInstance): Promise<void> {
  // Working hours, nested under the resource
  app.get('/resources/:id/working-hours', {
    preHandler: requireAppointments(),
    handler: availabilityController.listWorkingHours,
  });
  app.post('/resources/:id/working-hours', {
    preHandler: requireAppointments({ roles: [Role.TENANT_ADMIN] }),
    handler: availabilityController.createWorkingHour,
  });
  app.patch('/working-hours/:id', {
    preHandler: requireAppointments({ roles: [Role.TENANT_ADMIN] }),
    handler: availabilityController.updateWorkingHour,
  });
  app.delete('/working-hours/:id', {
    preHandler: requireAppointments({ roles: [Role.TENANT_ADMIN] }),
    handler: availabilityController.deleteWorkingHour,
  });

  // Time off, nested under the resource
  app.get('/resources/:id/time-off', {
    preHandler: requireAppointments(),
    handler: availabilityController.listTimeOff,
  });
  app.post('/resources/:id/time-off', {
    preHandler: requireAppointments({ roles: [Role.TENANT_ADMIN] }),
    handler: availabilityController.createTimeOff,
  });
  app.delete('/time-off/:id', {
    preHandler: requireAppointments({ roles: [Role.TENANT_ADMIN] }),
    handler: availabilityController.deleteTimeOff,
  });

  // Tenant timezone
  app.get('/settings/timezone', {
    preHandler: requireAppointments(),
    handler: availabilityController.getTimezone,
  });
  app.put('/settings/timezone', {
    preHandler: requireAppointments({ roles: [Role.TENANT_ADMIN] }),
    handler: availabilityController.setTimezone,
  });
}
