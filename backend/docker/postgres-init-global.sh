#!/usr/bin/env bash
# Global cluster first-init script.
# Runs once, on first init of the Postgres data directory.
#
# Creates the least-privilege roles the application uses at runtime and for
# migrations, wires up schema-level grants, revokes CREATE on public (hardening
# against dblink/postgres_fdw lateral moves), and installs extensions.
#
# Role model (see CODEBASE.md §15):
#   $POSTGRES_USER        — cluster superuser. Used by backups and break-glass
#                           admin only. Never by the app at runtime.
#   $GLOBAL_DB_USER       — DML only (SELECT/INSERT/UPDATE/DELETE). Used by the
#                           runtime pool in src/db/client.ts. Cannot CREATE TABLE,
#                           cannot CREATE EXTENSION, cannot run DDL.
#   $GLOBAL_DB_MIGRATE_USER — DDL (CREATE/ALTER/DROP TABLE). Used by db:migrate
#                             and drizzle-kit. Owns the schema + has CREATE on public.
#
# All role names and passwords come from docker-compose environment (see
# docker-compose.yml app.environment). The init script runs as the superuser
# ($POSTGRES_USER) and creates the other two roles.
#
# Every psql call passes --dbname "$POSTGRES_DB" (see §12 Docker gotchas).
set -euo pipefail

# Env vars are set by docker-compose.yml. All are required — no defaults.
# set -u (enabled below) will catch missing variables.
GLOBAL_APP_USER="${GLOBAL_DB_USER}"
GLOBAL_APP_PASSWORD="${GLOBAL_DB_PASSWORD}"
GLOBAL_MIGRATE_USER="${GLOBAL_DB_MIGRATE_USER}"
GLOBAL_MIGRATE_PASSWORD="${GLOBAL_DB_MIGRATE_PASSWORD}"

# Escape single quotes for safe SQL string interpolation. Passwords and role
# names may contain characters that break out of single-quoted SQL literals.
escape_sql() { printf '%s' "$1" | sed "s/'/''/g"; }

GLOBAL_APP_USER_ESC="$(escape_sql "$GLOBAL_APP_USER")"
GLOBAL_APP_PASSWORD_ESC="$(escape_sql "$GLOBAL_APP_PASSWORD")"
GLOBAL_MIGRATE_USER_ESC="$(escape_sql "$GLOBAL_MIGRATE_USER")"
GLOBAL_MIGRATE_PASSWORD_ESC="$(escape_sql "$GLOBAL_MIGRATE_PASSWORD")"

# ── Roles ────────────────────────────────────────────────────────────────
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  -- Application role (DML only). Created idempotently (create-or-alter-password).
  DO \$\$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${GLOBAL_APP_USER_ESC}') THEN
      CREATE ROLE "${GLOBAL_APP_USER}" LOGIN PASSWORD '${GLOBAL_APP_PASSWORD_ESC}';
    ELSE
      ALTER ROLE "${GLOBAL_APP_USER}" LOGIN PASSWORD '${GLOBAL_APP_PASSWORD_ESC}';
    END IF;
  END \$\$;

  -- Migration role (DDL). Owns the public schema so it can CREATE TABLE.
  DO \$\$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${GLOBAL_MIGRATE_USER_ESC}') THEN
      CREATE ROLE "${GLOBAL_MIGRATE_USER}" LOGIN PASSWORD '${GLOBAL_MIGRATE_PASSWORD_ESC}';
    ELSE
      ALTER ROLE "${GLOBAL_MIGRATE_USER}" LOGIN PASSWORD '${GLOBAL_MIGRATE_PASSWORD_ESC}';
    END IF;
  END \$\$;

  -- ── Schema grants ───────────────────────────────────────────────────
  -- Both roles can use the schema.
  GRANT USAGE ON SCHEMA public TO "${GLOBAL_APP_USER}", "${GLOBAL_MIGRATE_USER}";

  -- Migrate role owns the schema and can CREATE objects (tables, indexes).
  -- Also needs CREATE on the database to create the "drizzle" schema that
  -- drizzle-orm's migrate() runner uses for its migration tracking table.
  GRANT CREATE ON DATABASE "${POSTGRES_DB}" TO "${GLOBAL_MIGRATE_USER}";
  GRANT CREATE ON SCHEMA public TO "${GLOBAL_MIGRATE_USER}";
  ALTER SCHEMA public OWNER TO "${GLOBAL_MIGRATE_USER}";

  -- ── Hardening: REVOKE CREATE on public ─────────────────────────────
  -- Prevents the app role (and any future roles) from installing
  -- dblink / postgres_fdw / any extension — closes the lateral-move attack
  -- vector where SQL injection in one DB could connect to another DB on the
  -- same cluster. The migrate role still has explicit CREATE ON SCHEMA, so
  -- this does NOT affect migrations.
  REVOKE CREATE ON SCHEMA public FROM PUBLIC;

  -- ── Default privileges ──────────────────────────────────────────────
  -- Any table/sequence the migrate role creates from now on → app role
  -- automatically gets DML. This is idempotent and covers future tables
  -- added by new migrations without re-running this script.
  ALTER DEFAULT PRIVILEGES FOR ROLE "${GLOBAL_MIGRATE_USER}" IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "${GLOBAL_APP_USER}";
  ALTER DEFAULT PRIVILEGES FOR ROLE "${GLOBAL_MIGRATE_USER}" IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO "${GLOBAL_APP_USER}";

  -- ── Back-fill: grant on any tables that already exist ───────────────
  -- (idempotent GRANT — safe on re-init)
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${GLOBAL_APP_USER}";
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "${GLOBAL_APP_USER}";
EOSQL

# ── Extensions ──────────────────────────────────────────────────────────
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  CREATE EXTENSION IF NOT EXISTS "pgcrypto";
  CREATE EXTENSION IF NOT EXISTS "citext";
  CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
EOSQL

echo "Initialized global cluster roles, grants, and extensions."
