import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { globalDb } from '../../db/client.js';
import { tenants } from '../../db/schema/global/tenants.js';
import { staff } from '../../db/schema/tenant/staff.js';
import { tenantSchema } from '../../db/schema/tenant/index.js';
import { hashPassword } from '../../lib/crypto.js';
import { isValidSubdomain, subdomainToDbName, subdomainToOwnerRole, subdomainToAppRole } from '../../lib/subdomain.js';
import { Role } from '../../lib/roles.js';
import { env, sslConfig } from '../../config/env.js';
import { invalidSubdomain, subdomainTooShort, subdomainTaken, tenantInitFailed, internal } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { migrateTenantDb } from '../../db/migrate.js';
import { deriveTenantOwnerPassword, deriveTenantAppPassword } from '../../lib/tenant-creds.js';

export interface ProvisionInput {
  name: string;
  subdomain: string;
  ownerEmail: string;
  ownerPassword: string;
  ownerFirstName?: string;
  ownerLastName?: string;
}

export interface ProvisionResult {
  tenant: typeof tenants.$inferSelect;
  owner: { id: string; email: string; role: Role };
}

/**
 * Provision a brand-new tenant end to end:
 *   1. Validate + reserve subdomain.
 *   2. Admin (cluster superuser) creates the tenant DB from tenant_template,
 *      creates the per-tenant owner role, creates the per-tenant app role, then
 *      hands the DB to the owner.
 *   3. Owner sets default privileges so the per-tenant app role gets DML on
 *      every table migrations will create.
 *   4. Apply tenant migrations as the owner.
 *   5. Insert the tenant row + the tenant_admin owner in the global DB.
 *
 * Privilege tiers used (see CODEBASE.md §15):
 *   - TENANT_DB_ADMIN_* : cluster superuser — CREATE DATABASE (the ONE op that
 *     needs superuser) + CREATE ROLE.
 *   - tenant_<sub>_owner : per-tenant role — DDL on its own DB only.
 *   - tenant_<sub>_app   : per-tenant role — DML on its own DB only. Password
 *     is HMAC-derived from TENANT_APP_MASTER_KEY + tenantId.
 *
 * Any failure after the DB is created attempts to clean up (drop the DB +
 * roles) so we don't leave orphans.
 */
export async function provisionTenant(input: ProvisionInput): Promise<ProvisionResult> {
  const subdomain = input.subdomain.toLowerCase().trim();
  if (!isValidSubdomain(subdomain)) {
    throw invalidSubdomain();
  }
  if (subdomain.length < 2) {
    throw subdomainTooShort();
  }

  // 1. Reserve subdomain (existence check).
  const existing = await globalDb
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.subdomain, subdomain))
    .limit(1);
  if (existing.length > 0) {
    throw subdomainTaken();
  }

  const dbName = subdomainToDbName(subdomain);
  const ownerRole = subdomainToOwnerRole(subdomain);
  const appRole = subdomainToAppRole(subdomain);
  // Generate the tenant id client-side so the owner password can be derived
  // from it BEFORE the global INSERT (and thus before the DB is created).
  const tenantId = randomUUID();

  // 2. Admin creates the DB from the template + the owner role + the app role,
  // then hands the DB to the owner.
  await createTenantDatabaseAndOwner({ dbName, ownerRole, appRole, tenantId });

  // 3. Owner bakes default privileges into the new DB so the app role gets DML
  // on every table migrations will create. On failure, drop DB + role.
  try {
    await configureTenantGrants({ dbName, subdomain, tenantId });
  } catch (err) {
    await dropTenantDatabaseAndOwner({ dbName, ownerRole, appRole }).catch(() => undefined);
    logger.error({ err, dbName }, 'Tenant grant setup failed; dropped DB + roles.');
    throw tenantInitFailed();
  }

  // 4. Apply migrations as the owner. On failure, drop DB + role.
  try {
    await migrateTenantDb({ tenantId, subdomain, dbName });
  } catch (err) {
    await dropTenantDatabaseAndOwner({ dbName, ownerRole, appRole }).catch(() => undefined);
    logger.error({ err, dbName }, 'Tenant migration during provisioning failed; dropped DB + roles.');
    throw tenantInitFailed();
  }

  // 5. Insert the tenant row in the global registry, and the owner (a
  // tenant_admin login identity) into the tenant's OWN `staff` table. We supply
  // the client-generated tenantId so it matches the derived owner-role password.
  try {
    const [tenant] = await globalDb
      .insert(tenants)
      .values({ id: tenantId, name: input.name.trim(), subdomain, dbName, status: 'active' })
      .returning();

    // Insert the owner into the tenant DB's `staff` as a login identity.
    const ownerPasswordHash = await hashPassword(input.ownerPassword);
    const ownerDb = connectTenantOwnerDb(dbName, ownerRole, tenantId);
    try {
      const [owner] = await ownerDb
        .insert(staff)
        .values({
          email: input.ownerEmail.toLowerCase().trim(),
          passwordHash: ownerPasswordHash,
          role: Role.TENANT_ADMIN,
          firstName: input.ownerFirstName,
          lastName: input.ownerLastName,
        })
        .returning({ id: staff.id, email: staff.email, role: staff.role });
      return {
        tenant: tenant!,
        owner: { id: owner!.id, email: owner!.email, role: owner!.role },
      };
    } finally {
      await ownerDb.$client.end().catch(() => undefined);
    }
  } catch (err) {
    // DB created + migrated, but a post-migration insert failed — drop the
    // orphan DB + role so a retry is clean.
    await dropTenantDatabaseAndOwner({ dbName, ownerRole, appRole }).catch(() => undefined);
    logger.error({ err, subdomain }, 'Provisioning insert failed; dropped tenant DB + roles.');
    throw err;
  }
}

/**
 * Connect to a freshly-provisioned tenant DB AS the per-tenant owner role and
 * return a Drizzle instance. Used during provisioning to seed the owner row in
 * `people` before the runtime app role takes over. The caller MUST end the
 * underlying pool (`db.$client.end()`) when done.
 */
function connectTenantOwnerDb(dbName: string, ownerRole: string, tenantId: string) {
  const ownerPassword = deriveTenantOwnerPassword(tenantId);
  const pool = new pg.Pool({
    host: env.TENANT_DB_HOST,
    port: env.TENANT_DB_PORT,
    user: ownerRole,
    password: ownerPassword,
    database: dbName,
    ssl: sslConfig(),
    max: 1,
  });
  return drizzle(pool, { schema: tenantSchema });
}

/**
 * Connect as the cluster admin (superuser) to the maintenance/template DB and:
 *   - CREATE DATABASE ... TEMPLATE tenant_template  (the ONE operation that
 *     needs a cluster superuser)
 *   - CREATE ROLE tenant_<sub>_owner with the HMAC-derived password
 *   - CREATE ROLE tenant_<sub>_app with the HMAC-derived password
 *   - ALTER DATABASE ... OWNER TO so the owner has full DDL inside its own DB
 *
 * `CREATE DATABASE` and `CREATE ROLE` cannot be parameterized or run inside a
 * transaction, so dbName/ownerRole/appRole are validated by strict regex
 * (derived from a validated subdomain — only [a-z0-9_]).
 */
async function createTenantDatabaseAndOwner(args: {
  dbName: string;
  ownerRole: string;
  appRole: string;
  tenantId: string;
}): Promise<void> {
  const { dbName, ownerRole, appRole, tenantId } = args;
  if (!/^tenant_[a-z0-9_]+$/.test(dbName)) {
    throw internal(`Refusing to create database with unexpected name: ${dbName}`);
  }
  if (!/^tenant_[a-z0-9_]+_owner$/.test(ownerRole)) {
    throw internal(`Refusing to create role with unexpected name: ${ownerRole}`);
  }
  if (!/^tenant_[a-z0-9_]+_app$/.test(appRole)) {
    throw internal(`Refusing to create role with unexpected name: ${appRole}`);
  }
  const ownerPassword = deriveTenantOwnerPassword(tenantId);
  // Escape single quotes for the interpolated password literal. The value is a
  // hex HMAC so it won't contain quotes, but we defend in depth.
  const ownerPwLiteral = ownerPassword.replace(/'/g, "''");

  const appPassword = deriveTenantAppPassword(tenantId);
  const appPwLiteral = appPassword.replace(/'/g, "''");

  // Escape double quotes for SQL identifiers (defense in depth alongside the
  // regex validation above). PostgreSQL double-quoted identifiers require ""
  // to represent a literal quote character.
  const dbNameIdent = dbName.replace(/"/g, '""');
  const ownerRoleIdent = ownerRole.replace(/"/g, '""');
  const appRoleIdent = appRole.replace(/"/g, '""');

  const client = new pg.Client({
    host: env.TENANT_DB_HOST,
    port: env.TENANT_DB_PORT,
    user: env.TENANT_DB_ADMIN_USER,
    password: env.TENANT_DB_ADMIN_PASSWORD,
    database: env.TENANT_DB_TEMPLATE, // connect to template, then create new
    ssl: sslConfig(),
  });
  try {
    await client.connect();
    // CREATE DATABASE ... TEMPLATE can't run in a transaction. Idempotent: if
    // the DB somehow already exists (e.g. a retry), we continue and rewire the
    // owner below.
    try {
      await client.query(`CREATE DATABASE "${dbNameIdent}" TEMPLATE "${env.TENANT_DB_TEMPLATE}"`);
      logger.info({ dbName }, 'Created tenant database.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('already exists')) throw err;
      logger.warn({ dbName }, 'Tenant database already existed.');
    }
    // CREATE ROLE — idempotent via DO block (create-or-alter-password).
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${ownerRole}') THEN
          CREATE ROLE "${ownerRoleIdent}" LOGIN PASSWORD '${ownerPwLiteral}';
        ELSE
          ALTER ROLE "${ownerRoleIdent}" LOGIN PASSWORD '${ownerPwLiteral}';
        END IF;
      END $$;
    `);
    // Create per-tenant app role (DML only) — idempotent.
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${appRole}') THEN
          CREATE ROLE "${appRoleIdent}" LOGIN PASSWORD '${appPwLiteral}';
        ELSE
          ALTER ROLE "${appRoleIdent}" LOGIN PASSWORD '${appPwLiteral}';
        END IF;
      END $$;
    `);
    // Hand the DB to the owner. pg_database_owner resolves to this role inside
    // the DB, so the owner gets DDL + ownership of public-schema objects.
    await client.query(`ALTER DATABASE "${dbNameIdent}" OWNER TO "${ownerRoleIdent}"`);
  } finally {
    await client.end().catch(() => undefined);
  }

  // The template's public schema is owned by simi_tenant_migrate (set in
  // postgres-init-tenant.sh). The per-tenant owner needs to own the schema to
  // CREATE TABLE for drizzle migrations. ALTER SCHEMA must run *against the
  // target DB*, so we open a second admin connection to the new tenant DB.
  const tenantClient = new pg.Client({
    host: env.TENANT_DB_HOST,
    port: env.TENANT_DB_PORT,
    user: env.TENANT_DB_ADMIN_USER,
    password: env.TENANT_DB_ADMIN_PASSWORD,
    database: dbName,
    ssl: sslConfig(),
  });
  try {
    await tenantClient.connect();
    await tenantClient.query(`ALTER SCHEMA public OWNER TO "${ownerRoleIdent}"`);
    logger.info({ dbName, ownerRole, appRole }, 'Transferred public schema ownership to tenant owner.');
  } finally {
    await tenantClient.end().catch(() => undefined);
  }
}

/**
 * Connect AS the tenant's owner role and bake default privileges into the new
 * DB so the per-tenant app role (tenant_<sub>_app) gets DML on every table the
 * owner creates via future migrations. The template can't bake this for us
 * (the owner role doesn't exist at template-build time), so we do it here.
 *
 * We also grant on already-existing tables/sequences for re-provision safety.
 */
async function configureTenantGrants(args: {
  dbName: string;
  subdomain: string;
  tenantId: string;
}): Promise<void> {
  const { dbName, subdomain, tenantId } = args;
  const ownerRole = subdomainToOwnerRole(subdomain);
  const ownerPassword = deriveTenantOwnerPassword(tenantId);
  const appRole = subdomainToAppRole(subdomain);

  // Escape double quotes for SQL identifiers (defense in depth).
  const appRoleIdent = appRole.replace(/"/g, '""');
  const ownerRoleIdent = ownerRole.replace(/"/g, '""');

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
      -- App role can use the schema and select sequences.
      GRANT USAGE ON SCHEMA public TO "${appRoleIdent}";
      -- Any table/sequence the owner creates from now on → app role gets DML.
      ALTER DEFAULT PRIVILEGES FOR ROLE "${ownerRoleIdent}" IN SCHEMA public
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "${appRoleIdent}";
      ALTER DEFAULT PRIVILEGES FOR ROLE "${ownerRoleIdent}" IN SCHEMA public
        GRANT USAGE, SELECT ON SEQUENCES TO "${appRoleIdent}";
      -- Cover any tables already created (re-provision safety).
      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${appRoleIdent}";
      GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "${appRoleIdent}";
    `);
    logger.info({ dbName, ownerRole, appRole }, 'Configured tenant app-role default privileges.');
  } finally {
    await client.end().catch(() => undefined);
  }
}

/**
 * Drop a tenant DB and its owner role. Connects as the cluster admin
 * (superuser) because DROP DATABASE must terminate connections from other
 * roles (including the owner) — the owner can't drop its own DB while other
 * sessions are attached. Deprovisioning is rare and out of the hot path, so
 * using the superuser here is acceptable; per-tenant blast-radius containment
 * still holds for runtime data destruction (DROP TABLE / DELETE) which the
 * owner can do without superuser.
 */
async function dropTenantDatabaseAndOwner(args: {
  dbName: string;
  ownerRole: string;
  appRole: string;
}): Promise<void> {
  const { dbName, ownerRole, appRole } = args;
  if (!/^tenant_[a-z0-9_]+$/.test(dbName)) return;
  if (!/^tenant_[a-z0-9_]+_owner$/.test(ownerRole)) return;
  if (!/^tenant_[a-z0-9_]+_app$/.test(appRole)) return;

  // Escape double quotes for SQL identifiers (defense in depth).
  const dbNameIdent = dbName.replace(/"/g, '""');
  const ownerRoleIdent = ownerRole.replace(/"/g, '""');
  const appRoleIdent = appRole.replace(/"/g, '""');

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
    await client.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1`,
      [dbName],
    );
    await client.query(`DROP DATABASE IF EXISTS "${dbNameIdent}"`);
    await client.query(`DROP ROLE IF EXISTS "${ownerRoleIdent}"`);
    await client.query(`DROP ROLE IF EXISTS "${appRoleIdent}"`);
    logger.info({ dbName, ownerRole, appRole }, 'Dropped tenant database + owner + app roles.');
  } finally {
    await client.end().catch(() => undefined);
  }
}
