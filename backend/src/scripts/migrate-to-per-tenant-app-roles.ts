import pg from 'pg';
import { env, sslConfig } from '../config/env.js';
import { globalPoolClient } from '../db/client.js';
import { subdomainToOwnerRole, subdomainToAppRole } from '../lib/subdomain.js';
import { deriveTenantOwnerPassword, deriveTenantAppPassword } from '../lib/tenant-creds.js';
import { logger } from '../lib/logger.js';

/**
 * One-time migration script: convert existing tenants from the shared
 * `simi_tenant_app` role to per-tenant `tenant_<sub>_app` roles.
 *
 * For each active tenant:
 *   1. Connect as cluster admin → CREATE ROLE tenant_<sub>_app (idempotent)
 *   2. Connect as tenant owner → GRANT DML to the per-tenant app role
 *
 * Safe to run idempotently. After running this script:
 *   - The shared `simi_tenant_app` role still exists but is no longer used.
 *   - You can optionally DROP ROLE simi_tenant_app afterward.
 *   - Restart the app to pick up the new TENANT_APP_MASTER_KEY env var.
 *
 * Usage:
 *   pnpm migrate:app-roles
 */

interface TenantRow {
  id: string;
  subdomain: string;
  db_name: string;
}

async function createAppRoleAsAdmin(
  appRole: string,
  appPassword: string,
): Promise<void> {
  const pwLiteral = appPassword.replace(/'/g, "''");
  const client = new pg.Client({
    host: env.TENANT_DB_HOST,
    port: env.TENANT_DB_PORT,
    user: env.TENANT_DB_ADMIN_USER,
    password: env.TENANT_DB_ADMIN_PASSWORD,
    database: env.TENANT_DB_TEMPLATE,
    ssl: sslConfig(),
  });
  try {
    await client.connect();
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${appRole}') THEN
          CREATE ROLE "${appRole}" LOGIN PASSWORD '${pwLiteral}';
        ELSE
          ALTER ROLE "${appRole}" LOGIN PASSWORD '${pwLiteral}';
        END IF;
      END $$;
    `);
    logger.info({ appRole }, 'Created (or updated) per-tenant app role.');
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function grantDmlAsOwner(args: {
  dbName: string;
  ownerRole: string;
  ownerPassword: string;
  appRole: string;
}): Promise<void> {
  const { dbName, ownerRole, ownerPassword, appRole } = args;
  const client = new pg.Client({
    host: env.TENANT_DB_HOST,
    port: env.TENANT_DB_PORT,
    user: ownerRole,
    password: ownerPassword,
    database: dbName,
    ssl: sslConfig(),
  });
  try {
    await client.connect();
    await client.query(`
      -- App role can use the schema.
      GRANT USAGE ON SCHEMA public TO "${appRole}";
      -- Any table/sequence the owner creates from now on → app role gets DML.
      ALTER DEFAULT PRIVILEGES FOR ROLE "${ownerRole}" IN SCHEMA public
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "${appRole}";
      ALTER DEFAULT PRIVILEGES FOR ROLE "${ownerRole}" IN SCHEMA public
        GRANT USAGE, SELECT ON SEQUENCES TO "${appRole}";
      -- Cover any existing tables.
      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${appRole}";
      GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "${appRole}";
    `);
    logger.info({ dbName, appRole }, 'Granted DML privileges to per-tenant app role.');
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function migrateAllTenants(): Promise<void> {
  logger.info('Migrating all active tenants to per-tenant app roles…');

  const rows = await globalPoolClient.query(
    'SELECT id, subdomain, db_name FROM tenants WHERE status = $1 ORDER BY created_at ASC',
    ['active'],
  );

  if (rows.rows.length === 0) {
    logger.info('No active tenants found — nothing to migrate.');
    return;
  }

  let ok = 0;
  let failed = 0;

  for (const row of rows.rows as TenantRow[]) {
    const { id: tenantId, subdomain, db_name: dbName } = row;
    const ownerRole = subdomainToOwnerRole(subdomain);
    const ownerPassword = deriveTenantOwnerPassword(tenantId);
    const appRole = subdomainToAppRole(subdomain);
    const appPassword = deriveTenantAppPassword(tenantId);

    try {
      logger.info({ subdomain, dbName, appRole }, 'Migrating tenant…');
      await createAppRoleAsAdmin(appRole, appPassword);
      await grantDmlAsOwner({ dbName, ownerRole, ownerPassword, appRole });
      ok++;
    } catch (err) {
      failed++;
      logger.error({ err, subdomain, dbName }, 'Failed to migrate tenant to per-tenant app role.');
    }
  }

  logger.info({ ok, failed, total: rows.rows.length }, 'Per-tenant app role migration complete.');
  if (failed > 0) {
    process.exitCode = 1;
  }
}

migrateAllTenants()
  .catch((err) => {
    logger.error({ err }, 'Migration script failed.');
    process.exitCode = 1;
  })
  .finally(async () => {
    const { closeGlobalDb } = await import('../db/client.js');
    await closeGlobalDb();
    process.exit(process.exitCode ?? 0);
  });
