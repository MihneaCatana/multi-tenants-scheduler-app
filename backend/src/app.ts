/*
 * Copyright (c) 2026 Mihnea Catana. All rights reserved.
 * Proprietary and Confidential. Unauthorized copying or commercial use is strictly prohibited.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { securityPlugins } from './plugins/security.js';
import { errorHandler } from './plugins/error-handler.js';
import tenantPlugin from './plugins/tenant.js';
import authPlugin from './plugins/auth.js';
import { registerApiRoutes } from './routes/index.js';
import { startLogRetentionJob } from './lib/logs/retention.js';
import { syncFlagCatalog } from './lib/flag-catalog.js';
import { clearFlagCache } from './lib/flag-cache.js';
import { globalDb } from './db/client.js';

/**
 * Build (but do not start) the Fastify app. Splitting construction from
 * listening makes the app testable in-process.
 */
export async function buildApp(): Promise<FastifyInstance> {
  // Fastify v5: a pre-built logger instance must go in `loggerInstance`. The
  // `logger` key expects a config object; passing an instance there throws
  // FST_ERR_LOG_INVALID_LOGGER_CONFIG.
  //
  // The instance is typed as `FastifyInstance` (not the pino-specialized type
  // Fastify would infer) so that helpers typed as `(app: FastifyInstance)`
  // accept it. The cast is safe: at runtime Fastify happily uses any
  // pino-compatible logger via `loggerInstance`.
  const app = Fastify({
    loggerInstance: logger,
    // Default false (set in env.ts): never trust X-Forwarded-* unless the
    // deployment is behind a known proxy and TRUST_PROXY is configured to it.
    // Tenant resolution, rate-limit keying, and session IP attribution all
    // depend on req.ip / req.hostname being the real client.
    trustProxy: env.TRUST_PROXY,
    disableRequestLogging: false,
    genReqId: () => crypto.randomUUID(),
  }) as unknown as FastifyInstance;

  // Security + infra plugins.
  await securityPlugins(app);
  // Mirror the code-defined flag catalog into the `features` table before any
  // request can read it. Idempotent; clears the flag cache (defaults may have
  // changed). Failing here is fatal — a stale/missing catalog is worse than not
  // starting.
  const catalogSync = await syncFlagCatalog();
  clearFlagCache();
  logger.info(
    { inserted: catalogSync.inserted, updated: catalogSync.updated, deleted: catalogSync.deleted },
    'Feature-flag catalog synced.',
  );
  // Start the log retention sweep (runs immediately, then every 24h).
  startLogRetentionJob(env.LOG_DIR, env.LOG_RETENTION_DAYS);
  await app.register(errorHandler);
  await app.register(authPlugin);

  // Tenant resolution runs on every request; admin/health bypass it.
  await app.register(tenantPlugin, {
    bypassPrefixes: ['/health', '/v1/admin'],
  });

  // Health — public, no tenant/auth required.
  app.get('/health', async () => ({ status: 'ok', ts: new Date().toISOString() }));

  // Readiness — verifies global database connectivity. Use as a readiness probe
  // (Docker HEALTHCHECK, K8s readinessProbe) to avoid routing traffic to an
  // instance that cannot reach its database.
  app.get('/health/ready', async (req, reply) => {
    try {
      await globalDb.execute(sql`SELECT 1`);
      return { status: 'ready', ts: new Date().toISOString() };
    } catch (err) {
      req.log.error({ err }, 'Readiness check failed — global DB unreachable.');
      return reply.status(503).send({ status: 'not ready', ts: new Date().toISOString() });
    }
  });

  // Route modules. Each feature has thin HTTP wiring in src/routes/ and its
  // handler logic in src/controllers/.
  await registerApiRoutes(app);

  return app;
}
