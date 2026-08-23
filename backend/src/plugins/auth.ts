import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import jwtPlugin from '@fastify/jwt';
import { env, resolveJwtSecret, ttlToSeconds } from '../config/env.js';
import type { Role } from '../lib/roles.js';
import { isPlatformRole, isTenantRole, TENANT_ROLES } from '../lib/roles.js';
import { unauthorized, forbidden } from '../lib/errors.js';

/** The access-token payload we sign and verify. */
export interface AccessTokenClaims {
  sub: string; // user id
  role: Role;
  tenantId: string | null;
  type: 'access';
  iat?: number;
  exp?: number;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Authenticated user claims, set by the guard functions. */
    userClaims?: AccessTokenClaims;
  }
  interface FastifyInstance {
    /**
     * Verify the bearer access token and return its claims. Throws unauthorized
     * on missing / malformed / expired tokens.
     */
    verifyAccessToken(req: FastifyRequest): AccessTokenClaims;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: AccessTokenClaims;
    user: AccessTokenClaims;
  }
}

export default fp(
  async (app: FastifyInstance) => {
    const secret = resolveJwtSecret();

    await app.register(jwtPlugin, {
      secret: {
        private: secret.private,
        public: secret.public,
      },
      sign: {
        algorithm: secret.algorithm,
        expiresIn: ttlToSeconds(env.ACCESS_TOKEN_TTL),
        iss: env.JWT_ISSUER,
        aud: env.JWT_AUDIENCE,
      },
      // Verify binds the token to this issuer + audience, so a token minted by
      // another service or environment (even if it shares the signing key) is
      // rejected. `onlyCookie: false` keeps the Authorization header path.
      // (fast-jwt names these allowedIss / allowedAud, not issuer / audience.)
      verify: {
        onlyCookie: false,
        allowedIss: env.JWT_ISSUER,
        allowedAud: env.JWT_AUDIENCE,
      },
    });

    app.decorate(
      'verifyAccessToken',
      function (req: FastifyRequest): AccessTokenClaims {
        const header = req.headers.authorization;
        if (!header || !header.toLowerCase().startsWith('bearer ')) {
          // Return a generic message — distinguishing "missing" vs "malformed"
          // vs "expired" helps an attacker enumerate tenants by probing
          // subdomains and reading the error text.
          throw unauthorized();
        }
        let claims: AccessTokenClaims;
        try {
          claims = app.jwt.verify<AccessTokenClaims>(header.slice(7));
        } catch {
          // Same generic message — don't reveal whether the token is expired,
          // invalid signature, or malformed.
          throw unauthorized();
        }
        // Defense-in-depth: the claim type is asserted in the TS interface, but
        // verify() only checks signature + expiry (+ iss/aud above). Enforce it
        // at runtime so a non-access-typed token (e.g. a future 'refresh' or
        // 'email-verify' JWT) can never be honored as an access token.
        if (claims.type !== 'access') {
          throw unauthorized();
        }
        return claims;
      },
    );
  },
  { name: 'auth', fastify: '5.x' },
);

// -------------------------------------------------------------------------
// Route guards — attach claims to req.userClaims and return void so they
// satisfy Fastify's preHandler type signature.
// -------------------------------------------------------------------------

/**
 * Require an authenticated user with any role. Attaches claims to
 * `req.userClaims`.
 */
export function requireAuth(req: FastifyRequest): void {
  req.userClaims = req.server.verifyAccessToken(req);
}

/**
 * Require a platform_admin. Attaches claims to `req.userClaims`.
 * Throws if the user is not a platform admin or if they have a tenantId.
 */
export function requirePlatformAdmin(req: FastifyRequest): void {
  requireAuth(req);
  const claims = req.userClaims!;
  if (!isPlatformRole(claims.role)) {
    throw forbidden();
  }
  if (claims.tenantId !== null) {
    throw forbidden();
  }
}

/**
 * Require a tenant role, AND that the JWT's tenantId matches the tenant
 * resolved from the subdomain. This is THE core tenant-isolation check: even a
 * valid token issued for tenant A cannot be used against tenant B's subdomain.
 * Attaches claims to `req.userClaims`.
 */
export function requireTenantUser(
  req: FastifyRequest,
  options: { roles?: Role[] } = {},
): void {
  const allowedRoles = options.roles ?? TENANT_ROLES;
  requireAuth(req);
  const claims = req.userClaims!;

  if (isPlatformRole(claims.role)) {
    throw forbidden();
  }
  if (!isTenantRole(claims.role)) {
    throw forbidden();
  }
  if (!allowedRoles.includes(claims.role)) {
    throw forbidden();
  }
  if (claims.tenantId === null) {
    throw forbidden();
  }
  if (!req.tenant || claims.tenantId !== req.tenant.id) {
    throw forbidden();
  }
}
