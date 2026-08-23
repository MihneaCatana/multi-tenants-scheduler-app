import pg from 'pg';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { env, sslConfig } from '../config/env.js';
import { tenantSchema } from './schema/tenant/index.js';
import { deriveTenantAppPassword } from '../lib/tenant-creds.js';
import { subdomainToAppRole } from '../lib/subdomain.js';
import { logger } from '../lib/logger.js';

/**
 * Per-tenant database client manager.
 *
 * Each tenant has its own PostgreSQL database on the tenant server, accessed
 * via a per-tenant app role (`tenant_<sub>_app`) whose password is HMAC-derived
 * from TENANT_APP_MASTER_KEY + tenantId. This means a leaked credential for
 * tenant A cannot access tenant B's database.
 *
 * We keep a small LRU cache of `pg.Pool`s (and the Drizzle instance built on
 * each) keyed by tenant id + dbName, so a warm tenant is served without
 * reconnecting.
 *
 * CRITICAL: handlers obtain a tenant db ONLY via this module, after the tenant
 * plugin has resolved the request subdomain to a tenant row. There is no API
 * here that takes an arbitrary dbName from user input — the dbName always comes
 * from the authenticated tenant lookup in the global DB.
 */

export type TenantDb = NodePgDatabase<typeof tenantSchema>;

interface TenantPoolEntry {
  pool: pg.Pool;
  db: TenantDb;
  tenantId: string;
  dbName: string;
  subdomain: string;
  lastUsed: number;
}

const cache = new Map<string, TenantPoolEntry>();
const MAX_CACHED_POOLS = 50;

function cacheKey(tenantId: string, dbName: string): string {
  return `${tenantId}::${dbName}`;
}

function buildPool(dbName: string, tenantId: string, subdomain: string): pg.Pool {
  const appRole = subdomainToAppRole(subdomain);
  const appPassword = deriveTenantAppPassword(tenantId);
  const pool = new pg.Pool({
    host: env.TENANT_DB_HOST,
    port: env.TENANT_DB_PORT,
    user: appRole,
    password: appPassword,
    database: dbName,
    max: env.TENANT_DB_POOL_MAX,
    ssl: sslConfig(),
    // Same timeout guards as the global pool — see src/db/client.ts comments.
    connectionTimeoutMillis: 5_000,
    statement_timeout: 30_000,
    idleTimeoutMillis: 10_000,
  });
  pool.on('error', (err) => {
    logger.error({ err, dbName }, '[tenantDb pool] Unhandled pool error');
  });
  return pool;
}

/**
 * Get (or create) the Drizzle instance for a tenant's database.
 */
export function tenantDbFor(tenantId: string, dbName: string, subdomain: string): TenantDb {
  const key = cacheKey(tenantId, dbName);
  const existing = cache.get(key);
  if (existing) {
    existing.lastUsed = Date.now();
    return existing.db;
  }

  const pool = buildPool(dbName, tenantId, subdomain);
  const db = drizzle(pool, { schema: tenantSchema });
  const entry: TenantPoolEntry = {
    pool,
    db,
    tenantId,
    dbName,
    subdomain,
    lastUsed: Date.now(),
  };

  if (cache.size >= MAX_CACHED_POOLS) {
    evictOldest();
  }
  cache.set(key, entry);
  return db;
}

/**
 * Build a one-off tenant client without caching. Used by the migrate runner and
 * provisioning so we don't hold a long-lived pool open for short DDL work.
 */
export function tenantPoolForOneOff(dbName: string, tenantId: string, subdomain: string): pg.Pool {
  return buildPool(dbName, tenantId, subdomain);
}

function evictOldest(): void {
  let oldestKey: string | null = null;
  let oldestTime = Infinity;
  for (const [key, entry] of cache) {
    if (entry.lastUsed < oldestTime) {
      oldestTime = entry.lastUsed;
      oldestKey = key;
    }
  }
  if (oldestKey) {
    void closeTenant(oldestKey);
  }
}

/** Close and drop a specific tenant pool from the cache (e.g. on suspend). */
export async function closeTenant(key: string): Promise<void> {
  const entry = cache.get(key);
  if (!entry) return;
  cache.delete(key);
  await entry.pool.end().catch(() => undefined);
}

export async function closeTenantById(tenantId: string, dbName: string): Promise<void> {
  await closeTenant(cacheKey(tenantId, dbName));
}

/** Close all cached tenant pools — call on shutdown. */
export async function closeAllTenantPools(): Promise<void> {
  const entries = [...cache.values()];
  cache.clear();
  await Promise.all(entries.map((e) => e.pool.end().catch(() => undefined)));
}
