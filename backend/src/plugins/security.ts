import type { FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import cookie from '@fastify/cookie';
import { env } from '../config/env.js';

/**
 * Registers security-focused plugins:
 * - helmet  : secure HTTP headers
 * - cors    : configurable origins (tighten for production)
 * - rateLimit : global limiter (auth routes get a stricter one at the route)
 * - cookie  : signed/secure cookie support for refresh tokens
 */
export async function securityPlugins(app: FastifyInstance): Promise<void> {
  await app.register(helmet, {
    contentSecurityPolicy: env.NODE_ENV === 'production' ? undefined : false,
  });

  // CORS: explicit origin allowlist. Never use `origin: true` (reflects any
  // requesting origin, enabling cross-origin attacks on staging/UAT).
  const allowedOrigins = env.CORS_ORIGINS
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  await app.register(cors, {
    origin: allowedOrigins.length > 0 ? allowedOrigins : false,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  });

  await app.register(rateLimit, {
    max: env.RATE_LIMIT_GLOBAL_MAX,
    timeWindow: env.RATE_LIMIT_GLOBAL_WINDOW as `${number} ${string}`,
    // Allow platform staff to operate even under noisy neighbors; per-IP by default.
    keyGenerator: (req) => req.ip,
  });

  await app.register(cookie, {
    secret: env.COOKIE_SECRET,
    // We set HttpOnly + Secure on the cookies themselves in the auth handler.
  });
}
