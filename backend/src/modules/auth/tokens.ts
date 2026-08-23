import type { FastifyInstance } from 'fastify';
import type { Role } from '../../lib/roles.js';
import type { AccessTokenClaims } from '../../plugins/auth.js';

/**
 * Token issuance helpers built on top of @fastify/jwt.
 *
 * - Access token: short-lived JWT carrying identity + role + tenantId.
 * - Refresh token: opaque random string; only its SHA-256 hash is stored.
 */
export function signAccessToken(
  app: FastifyInstance,
  payload: { sub: string; role: Role; tenantId: string | null },
): string {
  const claims: AccessTokenClaims = { ...payload, type: 'access' };
  return app.jwt.sign(claims);
}
