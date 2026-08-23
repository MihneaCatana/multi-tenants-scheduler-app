import type { FastifyRequest } from 'fastify';
import { requireTenantUser } from '../plugins/auth.js';
import type { Role } from './roles.js';
import { isEnabled, FeatureFlag } from './flags.js';
import { notFound } from './errors.js';

/**
 * Compose the two scheduling guards: a valid tenant user in the allowed roles,
 * AND the APPOINTMENTS feature flag enabled for this tenant. When the flag is
 * off, scheduling routes return 404 (the feature is invisible) rather than 403
 * — matching how a disabled feature should appear not to exist.
 *
 * Returns a Fastify preHandler function.
 */
export function requireAppointments(options: { roles?: Role[] } = {}) {
  return async (req: FastifyRequest): Promise<void> => {
    requireTenantUser(req, options);
    if (!isEnabled(req, FeatureFlag.APPOINTMENTS)) {
      throw notFound();
    }
  };
}
