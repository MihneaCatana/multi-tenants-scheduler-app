import type { FastifyInstance } from 'fastify';
import { appointmentsController } from '../controllers/appointments.controller.js';
import { requireAppointments } from '../lib/require-appointments.js';

/**
 * Tenant-scoped APPOINTMENTS. Create/patch open to any tenant user (receptionist
 * + admin); the single PATCH endpoint dispatches reschedule + all status
 * transitions + cancel via a discriminated {action} body.
 */
export async function appointmentRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: requireAppointments(), handler: appointmentsController.list });
  app.get('/:id', { preHandler: requireAppointments(), handler: appointmentsController.getById });
  app.post('/', { preHandler: requireAppointments(), handler: appointmentsController.create });
  app.patch('/:id', { preHandler: requireAppointments(), handler: appointmentsController.patch });
  app.get('/:id/history', {
    preHandler: requireAppointments(),
    handler: appointmentsController.history,
  });
}
