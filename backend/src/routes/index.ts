import type { FastifyInstance } from 'fastify';
import { authRoutes } from './auth.routes.js';
import { adminRoutes } from './admin.routes.js';
import { clientRoutes } from './clients.routes.js';
import { staffRoutes } from './staff.routes.js';
import { flagsRoutes } from './flags.routes.js';
import { resourceRoutes } from './resources.routes.js';
import { serviceRoutes } from './services.routes.js';
import { availabilityRoutes } from './availability.routes.js';
import { appointmentRoutes } from './appointments.routes.js';

/**
 * Register all versioned API route groups under /v1.
 *
 * Each route file defines only relative paths (e.g. '/login', '/tenants/:id').
 * The prefix is applied here at registration time, keeping route files clean and
 * DRY. The /health endpoint is registered separately in app.ts (outside /v1,
 * since health checks don't need versioning).
 *
 * Scheduling routes (resources, services, availability, appointments) are gated
 * on the APPOINTMENTS feature flag via the requireAppointments preHandler.
 */
export async function registerApiRoutes(app: FastifyInstance): Promise<void> {
  await app.register(authRoutes, { prefix: '/v1/auth' });
  await app.register(adminRoutes, { prefix: '/v1/admin' });
  await app.register(clientRoutes, { prefix: '/v1/clients' });
  await app.register(staffRoutes, { prefix: '/v1/staff' });
  await app.register(flagsRoutes, { prefix: '/v1/features' });
  await app.register(resourceRoutes, { prefix: '/v1/resources' });
  await app.register(serviceRoutes, { prefix: '/v1/services' });
  // availabilityRoutes uses mixed top-level paths (/resources/:id/working-hours,
  // /working-hours/:id, /time-off/:id, /settings/timezone) so it mounts under /v1.
  await app.register(availabilityRoutes, { prefix: '/v1' });
  await app.register(appointmentRoutes, { prefix: '/v1/appointments' });
}
