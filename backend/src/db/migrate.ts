import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { drizzle } from 'drizzle-orm/node-postgres';
import { env, sslConfig } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { globalPoolClient } from './client.js';
import { tenants } from './schema/global/tenants.js';
import { eq } from 'drizzle-orm';
import { tenantSchema } from './schema/tenant/index.js';
import { subdomainToOwnerRole } from '../lib/subdomain.js';
import { deriveTenantOwnerPassword } from '../lib/tenant-creds.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GLOBAL_MIGRATIONS = path.join(__dirname, 'migrations', 'global');
const TENANT_MIGRATIONS = path.join(__dirname, 'migrations', 'tenant');

async function migrateGlobal(): Promise<void> {
  logger.info('Migrating global database…');
  // DDL requires the migrate role (NOT the app role), which owns the schema
  // and has CREATE on public. See CODEBASE.md §15.
  const pool = new pg.Pool({
    host: env.GLOBAL_DB_HOST,
    port: env.GLOBAL_DB_PORT,
    user: env.GLOBAL_DB_MIGRATE_USER,
    password: env.GLOBAL_DB_MIGRATE_PASSWORD,
    database: env.GLOBAL_DB_NAME,
    max: 1,
    ssl: sslConfig(),
  });
  try {
    const db = drizzle(pool);
    await migrate(db, { migrationsFolder: GLOBAL_MIGRATIONS });
    logger.info('✓ Global database up to date.');
  } finally {
    await pool.end();
  }
}

/**
 * Migrate ONE tenant DB, connecting as that tenant's owner role.
 *
 * The owner role is per-tenant (e.g. `tenant_acme_owner`) and owns its own DB,
 * so it can run DDL there — but it has zero access to any other tenant DB or
 * the global cluster. The password is HMAC-derived from the tenant id (see
 * src/lib/tenant-creds.ts). Using the owner here means a tenant migration bug
 * can never affect another tenant.
 */
async function migrateOneTenant(args: {
  tenantId: string;
  subdomain: string;
  dbName: string;
}): Promise<void> {
  const { tenantId, subdomain, dbName } = args;
  const ownerRole = subdomainToOwnerRole(subdomain);
  const ownerPassword = deriveTenantOwnerPassword(tenantId);
  const pool = new pg.Pool({
    host: env.TENANT_DB_HOST,
    port: env.TENANT_DB_PORT,
    user: ownerRole,
    password: ownerPassword,
    database: dbName,
    max: 1,
    ssl: sslConfig(),
  });
  try {
    const db = drizzle(pool, { schema: tenantSchema });
    await migrate(db, { migrationsFolder: TENANT_MIGRATIONS });
    logger.info({ dbName }, '✓ Tenant database up to date.');
  } finally {
    await pool.end();
  }
}

async function migrateAllTenants(): Promise<void> {
  logger.info('Migrating tenant databases…');
  const rows = await globalPoolClient.query(
    'SELECT id, db_name, subdomain FROM tenants WHERE status = $1 ORDER BY created_at ASC',
    ['active'],
  );

  if (rows.rows.length === 0) {
    logger.info('No active tenants yet — skipping tenant migrations.');
    return;
  }

  let ok = 0;
  let failed = 0;
  for (const row of rows.rows as Array<{ id: string; db_name: string; subdomain: string }>) {
    try {
      await migrateOneTenant({
        tenantId: row.id,
        subdomain: row.subdomain,
        dbName: row.db_name,
      });
      ok++;
    } catch (err) {
      failed++;
      logger.error({ err, tenantId: row.id, subdomain: row.subdomain }, 'Tenant migration failed.');
    }
  }
  logger.info({ ok, failed, total: rows.rows.length }, 'Tenant migrations complete.');
  if (failed > 0) {
    process.exitCode = 1;
  }
}

/**
 * Apply migrations to a single tenant DB. Used by the provisioning flow
 * (no caching, one-off pool). Connects as the tenant's owner role, so
 * provisioning must have created the role + ALTER DATABASE OWNER TO first.
 */
export async function migrateTenantDb(args: {
  tenantId: string;
  subdomain: string;
  dbName: string;
}): Promise<void> {
  await migrateOneTenant(args);
}

async function main(): Promise<void> {
  try {
    await migrateGlobal();
    await migrateAllTenants();
  } catch (err) {
    logger.error({ err }, 'Migration run failed.');
    process.exitCode = 1;
  }
}

// Re-export for the modules layer.
export { tenants, eq };

// Run when invoked directly (`pnpm db:migrate`).
import { isMainModule } from '../lib/is-main.js';
if (isMainModule(import.meta.url)) {
  main().finally(async () => {
    const { closeGlobalDb } = await import('./client.js');
    await closeGlobalDb();
    process.exit(process.exitCode ?? 0);
  });
}
