import { mkdirSync } from 'node:fs';
import pino, { multistream, type Logger, type Level, type StreamEntry } from 'pino';
import { env } from '../config/env.js';
import { TenantRoutingStream } from './logs/routing-stream.js';

/**
 * Shared pino logger.
 *
 * Every log line flows through `TenantRoutingStream`, which writes it to
 * `LOG_DIR/<subdomain>/YYYY-MM-DD.json` when the line carries a
 * `tenantSubdomain` binding, otherwise to `LOG_DIR/global/YYYY-MM-DD.json`.
 *
 * In development we additionally tee a pino-pretty console stream so the
 * terminal stays readable. pino-pretty is a devDependency, so it is loaded via
 * a guarded dynamic import — production never resolves it and needs no
 * devDeps installed. Production emits JSON only (file via the routing stream).
 */

// Ensure the log directory exists and is writable before routing any lines.
// The explicit 0o777 mode bypasses umask so all users (including the
// container's non-root `app` user) can create subdirectories inside it.
mkdirSync(env.LOG_DIR, { recursive: true, mode: 0o777 });

const routingStream = new TenantRoutingStream({ logDir: env.LOG_DIR });

const redactPaths = [
  'req.headers.authorization',
  'req.headers.cookie',
  '*.password',
  '*.passwordHash',
  '*.refreshToken',
  '*.refreshHash',
  '*.temporaryPassword',
];

const level: Level = (env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL) as Level;

const streams: StreamEntry[] = [{ level, stream: routingStream as unknown as NodeJS.WritableStream }];
if (env.NODE_ENV === 'development') {
  const { default: pretty } = await import('pino-pretty');
  streams.push({
    level,
    stream: pretty({ colorize: true, translateTime: 'HH:MM:ss' }) as unknown as NodeJS.WritableStream,
  });
}

export const logger: Logger = pino(
  {
    level,
    base: { service: 'simi-backend' },
    redact: { paths: redactPaths, censor: '[REDACTED]' },
  },
  multistream(streams),
);

/**
 * Child logger bound to a tenant. Returns (and caches) a child whose every line
 * carries `tenantSubdomain` + `tenantId`, which the routing stream uses to pick
 * the destination folder. `bucketKey` of 'global' returns the root logger.
 */
const tenantLoggerCache = new Map<string, Logger>();
export function getTenantLogger(subdomain: string | null, tenantId: string | null): Logger {
  if (!subdomain || !tenantId) return logger;
  const cached = tenantLoggerCache.get(subdomain);
  if (cached) return cached;
  const child = logger.child({ tenantSubdomain: subdomain, tenantId });
  tenantLoggerCache.set(subdomain, child);
  return child;
}

/** Close all open log file streams — call on shutdown before process exit. */
export function closeLogStreams(): void {
  routingStream.end();
}
