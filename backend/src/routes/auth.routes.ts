import type { FastifyInstance } from 'fastify';
import { authController } from '../controllers/auth.controller.js';
import { requireAuth } from '../plugins/auth.js';
import { env } from '../config/env.js';

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // -------------------------------------------------------------------------
  // Login — works on both apex (platform_admin) and subdomain (tenant users).
  // The role check happens implicitly at protected routes.
  // -------------------------------------------------------------------------
  app.post('/login', {
    config: { rateLimit: { max: env.RATE_LIMIT_AUTH_MAX, timeWindow: env.RATE_LIMIT_GLOBAL_WINDOW } },
    handler: authController.login,
  });

  // -------------------------------------------------------------------------
  // Refresh — accept the httpOnly refresh cookie only.
  // -------------------------------------------------------------------------
  app.post('/refresh', {
    config: { rateLimit: { max: env.RATE_LIMIT_MUTATION_MAX, timeWindow: env.RATE_LIMIT_GLOBAL_WINDOW } },
    handler: authController.refresh,
  });

  // -------------------------------------------------------------------------
  // Logout — revoke the presented refresh token and clear the cookie.
  // -------------------------------------------------------------------------
  app.post('/logout', {
    preHandler: async (req) => requireAuth(req),
    handler: authController.logout,
  });

  // -------------------------------------------------------------------------
  // /me — who am I? Requires any valid access token.
  // -------------------------------------------------------------------------
  app.get('/me', {
    preHandler: async (req) => requireAuth(req),
    handler: authController.me,
  });

  // -------------------------------------------------------------------------
  // Self-service password change. Available to any authenticated user.
  // -------------------------------------------------------------------------
  app.post('/change-password', {
    preHandler: async (req) => requireAuth(req),
    config: { rateLimit: { max: env.RATE_LIMIT_AUTH_MAX, timeWindow: env.RATE_LIMIT_GLOBAL_WINDOW } },
    handler: authController.changePassword,
  });
}
