import { defineConfig } from 'drizzle-kit';
import { env, sslConfig } from './src/config/env.js';

/**
 * Drizzle Kit config for the TENANT database schema.
 * `db:generate:tenant` diffs src/db/schema/tenant and writes SQL into
 * src/db/migrations/tenant. These migrations are applied to EVERY tenant DB
 * (by src/db/migrate.ts) and to each newly provisioned tenant DB.
 *
 * `dbCredentials` here point at the template DB so `drizzle-kit` introspection
 * works during development; the programmatic migrate() runner uses per-tenant
 * connections at runtime.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/tenant/index.ts',
  out: './src/db/migrations/tenant',
  dbCredentials: {
    host: env.TENANT_DB_HOST,
    port: env.TENANT_DB_PORT,
    // drizzle-kit runs DDL/introspection → use the migrate role on the tenant
    // cluster. Never the app role (no DDL). See §15.
    user: env.TENANT_DB_MIGRATE_USER,
    password: env.TENANT_DB_MIGRATE_PASSWORD,
    database: env.TENANT_DB_NAME,
    ssl: sslConfig() ?? false,
  },
  verbose: true,
  strict: true,
});
