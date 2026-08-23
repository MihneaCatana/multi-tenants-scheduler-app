#!/usr/bin/env bash
# Tenant cluster first-init script.
# Runs once, on first init of the Postgres data directory.
#
# The default DB created by POSTGRES_DB is `tenant_template`. This script
# creates the migrate role, bakes grants + REVOKE CREATE on public +
# default privileges into `tenant_template` so that every future
# `CREATE DATABASE ... TEMPLATE tenant_template` inherits them automatically.
#
# Role model (see CODEBASE.md §15):
#   $POSTGRES_USER         — cluster superuser. Used only for CREATE DATABASE
#                            at provisioning + backups. Never at runtime.
#   $TENANT_DB_MIGRATE_USER — DDL on the template DB only (for drizzle-kit
#                              introspection during db:generate:tenant).
#                              Actual per-tenant migrations run as each tenant's
#                              owner role (tenant_<sub>_owner).
#
# Per-tenant app roles (tenant_<sub>_app) are NOT created here. They don't
# exist at template-build time and are created at provisioning by
# src/modules/tenants/provision.ts. Grants for those app roles are set
# inside each new DB at provisioning time (configureTenantGrants).
#
# Every psql call passes --dbname "$POSTGRES_DB" (see §12 Docker gotchas).
set -euo pipefail

# Env vars are set by docker-compose.yml. All are required — no defaults.
# set -u (enabled below) will catch missing variables.
TENANT_MIGRATE_USER="${TENANT_DB_MIGRATE_USER}"
TENANT_MIGRATE_PASSWORD="${TENANT_DB_MIGRATE_PASSWORD}"
TEMPLATE_DB="${TENANT_DB_TEMPLATE}"

# Escape single quotes for safe SQL string interpolation.
escape_sql() { printf '%s' "$1" | sed "s/'/''/g"; }

TENANT_MIGRATE_USER_ESC="$(escape_sql "$TENANT_MIGRATE_USER")"
TENANT_MIGRATE_PASSWORD_ESC="$(escape_sql "$TENANT_MIGRATE_PASSWORD")"

# ── Roles ────────────────────────────────────────────────────────────────
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  -- Migration role (DDL on template only, for drizzle-kit introspection).
  DO \$\$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${TENANT_MIGRATE_USER_ESC}') THEN
      CREATE ROLE "${TENANT_MIGRATE_USER}" LOGIN PASSWORD '${TENANT_MIGRATE_PASSWORD_ESC}';
    ELSE
      ALTER ROLE "${TENANT_MIGRATE_USER}" LOGIN PASSWORD '${TENANT_MIGRATE_PASSWORD_ESC}';
    END IF;
  END \$\$;

  -- ── Schema grants (baked into tenant_template) ─────────────────────
  GRANT USAGE ON SCHEMA public TO "${TENANT_MIGRATE_USER}";
  -- Migrate role needs CREATE on the database to create the "drizzle" schema
  -- that drizzle-orm's migrate() runner uses for its migration tracking table.
  GRANT CREATE ON DATABASE "${POSTGRES_DB}" TO "${TENANT_MIGRATE_USER}";
  GRANT CREATE ON SCHEMA public TO "${TENANT_MIGRATE_USER}";
  ALTER SCHEMA public OWNER TO "${TENANT_MIGRATE_USER}";

  -- ── Hardening: REVOKE CREATE on public ─────────────────────────────
  REVOKE CREATE ON SCHEMA public FROM PUBLIC;
EOSQL

echo "Initialized tenant cluster template migrate role and hardening."

# ── Extensions (baked into tenant_template, inherited by all tenants) ───
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$TEMPLATE_DB" <<-EOSQL
  CREATE EXTENSION IF NOT EXISTS "pgcrypto";
  CREATE EXTENSION IF NOT EXISTS "citext";
  CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
EOSQL

echo "Initialized tenant cluster extensions."
