import pg from 'pg';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { env, sslConfig } from '../config/env.js';
import { logger } from '../lib/logger.js';
import * as globalSchema from './schema/global/index.js';

/**
 * Global database client (single shared pool + Drizzle instance).
 *
 * Used for: auth, users, tenant registry, sessions.
 * NEVER used to read or write tenant data — that goes through tenantDbFor().
 */

const globalPool = new pg.Pool({
  host: env.GLOBAL_DB_HOST,
  port: env.GLOBAL_DB_PORT,
  user: env.GLOBAL_DB_USER,
  password: env.GLOBAL_DB_PASSWORD,
  database: env.GLOBAL_DB_NAME,
  max: env.GLOBAL_DB_POOL_MAX,
  ssl: sslConfig(),
  // UUIDs come back as strings by default; we keep that (string ids everywhere).

  // Guard against pool exhaustion: if all `max` connections are checked out and
  // none are returned within 5 s the waiter receives an error instead of hanging
  // indefinitely (the pg default is 0 = wait forever, which caused the /users
  // and /features freeze).
  connectionTimeoutMillis: 5_000,
  // Kill TCP connections to the server if the handshake takes longer than 5 s
  // (e.g. unreachable host, DNS stall).
  statement_timeout: 30_000,
  idleTimeoutMillis: 10_000,
});

// Log (and surface) pool-level errors — e.g. a client disconnects while idle,
// or an checked-out connection is forced back by the server. Without this
// listener pg silently swallows the error and the pool gradually empties.
globalPool.on('error', (err) => {
  logger.error({ err }, '[globalDb pool] Unhandled pool error');
});

export type GlobalDb = NodePgDatabase<typeof globalSchema> & {
  $client: pg.Pool;
};

export const globalDb = drizzle(globalPool, {
  schema: globalSchema,
}) as GlobalDb;

export const globalPoolClient = globalPool;

export async function closeGlobalDb(): Promise<void> {
  await globalPool.end();
}

/**
 * Run a function inside a single pooled connection. Handy for transactional
 * DDL (e.g. provisioning) where we need a connection we fully control.
 */
export async function withGlobalConnection<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await globalPool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}
