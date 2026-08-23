/**
 * Lightweight test app factory.
 *
 * Unlike buildApp() (src/app.ts), this creates a minimal Fastify instance
 * without database connections, flag catalog sync, log retention jobs, or the
 * tenant resolution plugin. It also avoids importing the shared logger to
 * prevent side effects from module-level initialization (pino-pretty,
 * TenantRoutingStream, etc.).
 *
 * Use it for unit and integration tests of individual route handlers where
 * you control the full request context.
 *
 * For end-to-end tests against a real database, use buildApp() with a test DB.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import type { Role } from '../lib/roles.js';

export interface TestAppOptions {
  /** Register the auth/JWT plugin (enables verifyAccessToken). */
  auth?: boolean;
}

/**
 * Build a minimal Fastify instance suitable for tests.
 * Call `app.close()` when done (or use vi.afterEach).
 */
export async function buildTestApp(
  options: TestAppOptions = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    trustProxy: false,
  });

  // Minimal error handler mirroring the shape of the real one
  // (HttpError → status, ZodError → 422, everything else → 500).
  app.setErrorHandler((err: Error & { statusCode?: number; code?: string }, _req, reply) => {
    const statusCode = err.statusCode ?? 500;
    reply.status(statusCode).send({
      error: {
        code: err.code ?? 'INTERNAL',
        message: err.message ?? 'Internal server error.',
      },
    });
  });

  if (options.auth) {
    // Dynamic import to avoid pulling in env.ts at module parse time.
    const authPlugin = (await import('../plugins/auth.js')).default;
    await app.register(authPlugin);
  }

  return app;
}

/**
 * Sign a fake access token and return it as a Bearer string.
 * Requires the auth plugin to be registered on the app.
 */
export function signToken(
  app: FastifyInstance,
  overrides: Partial<{ sub: string; role: Role; tenantId: string | null; type: 'access' }> = {},
): string {
  const claims = {
    sub: '00000000-0000-0000-0000-000000000001',
    role: 'platform_admin' as Role,
    tenantId: null,
    type: 'access' as const,
    ...overrides,
  };
  return app.jwt.sign(claims);
}
