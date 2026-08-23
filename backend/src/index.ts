/*
 * Copyright (c) 2026 Mihnea Catana. All rights reserved.
 * Proprietary and Confidential. Unauthorized copying or commercial use is strictly prohibited.
 */

import { buildApp } from './app.js';
import { env, hasProductionJwtKeys } from './config/env.js';
import { closeAllTenantPools } from './db/tenant-pool.js';
import { closeGlobalDb } from './db/client.js';
import { logger, closeLogStreams } from './lib/logger.js';

async function start(): Promise<void> {
  // Production guards: refuse to start with insecure defaults.
  if (env.NODE_ENV === 'production') {
    if (!hasProductionJwtKeys) {
      logger.error('Running in production without asymmetric JWT keys — refusing to start.');
      process.exit(1);
    }
    if (!env.COOKIE_SECURE) {
      logger.error(
        'COOKIE_SECURE must be true in production. Refresh tokens would be sent over plaintext HTTP.',
      );
      process.exit(1);
    }
    if (!env.DB_SSL) {
      logger.error(
        'DB_SSL must be true in production. Database connections would be sent in plaintext.',
      );
      process.exit(1);
    }
  }

  // Development warnings.
  if (env.NODE_ENV !== 'production' && env.JWT_ALGORITHM === 'HS256') {
    logger.warn(
      '⚠️  Using HS256 dev JWT keys. Tokens will not survive a restart and this is unsafe in production.',
    );
  }

  const app = await buildApp();

  try {
    await app.listen({ host: env.HOST, port: env.PORT });
    logger.info(`🚀 Simi backend listening on http://${env.HOST}:${env.PORT}`);
    logger.info(
      `   Tenant subdomains: *.<tenant>.${env.BASE_DOMAIN}   |   Admin host: ${env.BASE_DOMAIN}`,
    );
  } catch (err) {
    logger.error({ err }, 'Failed to start server.');
    process.exit(1);
  }

  // Graceful shutdown.
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down…');
    await app.close().catch(() => undefined);
    await closeAllTenantPools();
    await closeGlobalDb();
    closeLogStreams();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

start().catch((err) => {
  logger.error({ err }, 'Fatal startup error.');
  process.exit(1);
});
