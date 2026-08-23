import { defineConfig } from 'drizzle-kit';
import { env, sslConfig } from './src/config/env.js';

/**
 * Drizzle Kit config for the GLOBAL database.
 * `db:generate:global` diffs src/db/schema/global and writes SQL into
 * src/db/migrations/global. Migrations are applied to the single global DB.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/global/index.ts',
  out: './src/db/migrations/global',
  dbCredentials: {
    host: env.GLOBAL_DB_HOST,
    port: env.GLOBAL_DB_PORT,
    // drizzle-kit runs DDL/introspection → use the migrate role (has CREATE on
    // public + owns the schema). Never the app role (no DDL). See §15.
    user: env.GLOBAL_DB_MIGRATE_USER,
    password: env.GLOBAL_DB_MIGRATE_PASSWORD,
    database: env.GLOBAL_DB_NAME,
    ssl: sslConfig() ?? false,
  },
  verbose: true,
  strict: true,
});
