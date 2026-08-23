# Database Access

How to connect to the Simi platform's databases — connection parameters, role
tiers, and common administrative queries.

> **Related docs:** [Infrastructure](./infrastructure.md) ·
> [Multi-Tenancy](./multi-tenancy.md) ·
> [Backups](./backups.md) ·
> [Modules](./modules.md)

---

## Database Clusters

Simi runs two separate PostgreSQL 16 clusters:

| Cluster | Host | Port | Database(s) | Purpose |
|---------|------|------|-------------|---------|
| **Global** | `localhost` | **5432** | `simi_global` | Tenant registry, platform admins, sessions, feature flags |
| **Tenant** | `localhost` | **5433** | `tenant_template`, `tenant_<subdomain>` | Per-tenant business data |

Both ports are bound to `127.0.0.1` only — accessible only from the host machine.

---

## Global Database

The global database contains the **control plane** data.

### Connection Parameters

| Parameter | Value |
|-----------|-------|
| Host | `localhost` (or `postgres-global` inside Docker) |
| Port | `5432` |
| Database | `simi_global` |

### Tables

| Table | Purpose |
|-------|---------|
| `tenants` | Tenant registry (id, name, subdomain, dbName, status) |
| `users` | Platform admin login identities (email, passwordHash, role) |
| `sessions` | Platform admin refresh token sessions (hash, expiry, revoked) |
| `features` | Feature flag catalog (key, label, description, default enabled) |
| `tenant_features` | Per-tenant feature flag overrides (tenantId, featureId, enabled) |

### Connecting with psql

```bash
# App role (DML — SELECT, INSERT, UPDATE, DELETE)
psql -h localhost -p 5432 -U simi_global_app -d simi_global

# Migrate role (DDL — CREATE TABLE, ALTER TABLE, etc.)
psql -h localhost -p 5432 -U simi_global_migrate -d simi_global

# Admin role (superuser — CREATE DATABASE, CREATE ROLE, break-glass)
psql -h localhost -p 5432 -U simi_global_admin -d simi_global
```

Passwords are set in your `.env` file (`GLOBAL_DB_PASSWORD`, `GLOBAL_DB_MIGRATE_PASSWORD`,
`GLOBAL_DB_ADMIN_PASSWORD`).

---

## Tenant Database

The tenant cluster hosts **all per-tenant databases** plus a template database used for
provisioning.

### Connection Parameters

| Parameter | Value |
|-----------|-------|
| Host | `localhost` (or `postgres-tenant` inside Docker) |
| Port | **5433** |
| Template DB | `tenant_template` |
| Tenant DBs | `tenant_<subdomain>` (e.g., `tenant_acme`, `tenant_demo`) |

### Tenant Database Tables

Each tenant database contains:

| Table | Purpose |
|-------|---------|
| `staff` | Tenant login identities (email, passwordHash, role) |
| `clients` | Customer/CRM records |
| `tenant_sessions` | Refresh token sessions for tenant users |
| `tenant_settings` | Tenant-wide settings (timezone, etc.) |
| `resources` | Bookable resources (rooms, equipment, staff-as-provider) |
| `services` | Service definitions (name, duration, category) |
| `service_resource_requirements` | Which resource types a service needs |
| `working_hours` | Staff/resource working hours |
| `time_off` | Staff/resource time-off entries |
| `appointments` | Scheduled appointments (with GiST range overlap index) |
| `appointment_resources` | Which resources are assigned to an appointment |
| `appointment_status_history` | Status transition log for each appointment |

### Listing Tenant Databases

```bash
# Connect to the tenant cluster and list all databases
psql -h localhost -p 5433 -U simi_tenant_admin -d postgres -c "\l"
```

---

## Role Tiers Explained

Each PostgreSQL cluster uses a **3-tier role model**. Understanding which role to use
for each task is critical.

### Global Cluster Roles

| Role | Password Variable | Privileges | When to Use |
|------|------------------|------------|-------------|
| `simi_global_admin` | `GLOBAL_DB_ADMIN_PASSWORD` | Superuser on global cluster | Break-glass, `CREATE DATABASE` (rare) |
| `simi_global_migrate` | `GLOBAL_DB_MIGRATE_PASSWORD` | DDL on `simi_global` | Running Drizzle Kit migrations |
| `simi_global_app` | `GLOBAL_DB_PASSWORD` | DML on `simi_global` | Runtime application queries |

### Tenant Cluster Shared Roles

| Role | Password Variable | Privileges | When to Use |
|------|------------------|------------|-------------|
| `simi_tenant_admin` | `TENANT_DB_ADMIN_PASSWORD` | Superuser on tenant cluster | `CREATE DATABASE`, provisioning, cleanup |
| `simi_tenant_migrate` | `TENANT_DB_MIGRATE_PASSWORD` | DDL on `tenant_template` only | Drizzle Kit introspection |

### Per-Tenant Roles

Each tenant gets its own **owner** and **app** roles with HMAC-derived passwords (see
[Multi-Tenancy](./multi-tenancy.md)):

| Role | Privileges | When to Use |
|------|------------|-------------|
| `tenant_<sub>_owner` | DDL on one tenant DB only | Running migrations for this tenant |
| `tenant_<sub>_app` | DML on one tenant DB only | Runtime application queries for this tenant |

### Connecting with psql to a Tenant DB

```bash
# As the cluster admin (can see all tenant DBs, superuser)
psql -h localhost -p 5433 -U simi_tenant_admin -d tenant_acme

# As the tenant's owner role (DDL — migrations)
# Password is HMAC-derived, you need to compute it or use the app
psql -h localhost -p 5433 -U tenant_acme_owner -d tenant_acme

# As the tenant's app role (DML — runtime)
psql -h localhost -p 5433 -U tenant_acme_app -d tenant_acme
```

For per-tenant roles, the passwords are derived using HMAC-SHA256 from master keys
(`TENANT_OWNER_MASTER_KEY` / `TENANT_APP_MASTER_KEY`) + the tenant's UUID. You cannot
look these up — they are computed, not stored. See
[`src/lib/tenant-creds.ts`](../backend/src/lib/tenant-creds.ts) for the derivation logic.

---

## Connecting via Docker Compose

When running inside Docker, use the container names as hosts:

```bash
# Global DB (from inside the app container or via docker compose exec)
docker compose exec app psql -h postgres-global -U simi_global_app -d simi_global

# Tenant DB (from inside the app container)
docker compose exec app psql -h postgres-tenant -U simi_tenant_admin -d tenant_acme

# From the postgres-tenant container directly
docker compose exec postgres-tenant psql -U simi_tenant_admin -d tenant_acme
```

---

## Drizzle ORM Configuration

The application uses Drizzle ORM to interact with both databases.

### Global DB Client

Defined in [`src/db/client.ts`](../backend/src/db/client.ts):

```typescript
// Single shared pool + Drizzle instance for the global database
import { drizzle } from 'drizzle-orm/node-postgres';
import * as globalSchema from './schema/global/index.js';

const globalDb = drizzle(globalPool, { schema: globalSchema });
```

Configuration file: [`drizzle.config.global.ts`](../backend/drizzle.config.global.ts)

### Tenant DB Pool

Defined in [`src/db/tenant-pool.ts`](../backend/src/db/tenant-pool.ts):

```typescript
// LRU cache of per-tenant Drizzle instances
import { tenantDbFor } from './db/tenant-pool.js';

// Get (or create) a tenant's Drizzle instance
const db = tenantDbFor(tenantId, dbName, subdomain);
```

The pool caches up to **50 tenant connections** with LRU eviction. Idle pools are
closed after 10 seconds.

Configuration file: [`drizzle.config.tenant.ts`](../backend/drizzle.config.tenant.ts)

---

## Running Migrations

```bash
# Migrate the global database
pnpm db:migrate:global
# or via Docker:
docker compose exec app pnpm db:migrate:global

# Migrate the tenant template (and all registered tenant DBs)
pnpm db:migrate:tenant
# or via Docker:
docker compose exec app pnpm db:migrate:tenant
```

Migrations are applied as the **owner role** for each tenant (not the app role), which
has DDL privileges on that specific tenant database.

---

## Common Administrative Queries

### List All Tenants

```sql
-- Connect to global DB
\c simi_global

SELECT id, name, subdomain, db_name, status, created_at
FROM tenants
ORDER BY created_at;
```

### Check Active Sessions

```sql
-- Platform admin sessions (global DB)
SELECT u.email, s.expires_at, s.revoked_at, s.ip, s.user_agent
FROM sessions s
JOIN users u ON u.id = s.user_id
WHERE s.revoked_at IS NULL
ORDER BY s.created_at DESC;

-- Tenant user sessions (per-tenant DB)
SELECT staff.email, ts.expires_at, ts.revoked_at, ts.ip
FROM tenant_sessions ts
JOIN staff ON staff.id = ts.staff_id
WHERE ts.revoked_at IS NULL
ORDER BY ts.created_at DESC;
```

### Check Feature Flag Overrides

```sql
-- Connect to global DB
-- See which tenants have non-default flag settings
SELECT t.subdomain, f.key, tf.enabled AS override, f.enabled AS default
FROM tenant_features tf
JOIN tenants t ON t.id = tf.tenant_id
JOIN features f ON f.id = tf.feature_id
ORDER BY t.subdomain, f.key;
```

### View Appointment Status History

```sql
-- Connect to a specific tenant DB
SELECT a.id, h.from_status, h.to_status, h.acted_by, h.created_at
FROM appointment_status_history h
JOIN appointments a ON a.id = h.appointment_id
ORDER BY h.created_at DESC
LIMIT 50;
```

### Check Database Sizes

```sql
-- On the tenant cluster
SELECT datname, pg_size_pretty(pg_database_size(datname)) AS size
FROM pg_database
WHERE datistemplate = false
ORDER BY pg_database_size(datname) DESC;
```

### List All PostgreSQL Roles on Tenant Cluster

```sql
-- Connect to tenant cluster
SELECT rolname, rolinherit, rolcreaterole, rolcreatedb, rolsuper
FROM pg_roles
WHERE rolname NOT LIKE 'pg_%'
ORDER BY rolname;
```

---

## Connection String Format

If you need the full connection string for tools like pgAdmin, DBeaver, or Prisma:

### Global DB

```
postgresql://simi_global_app:<PASSWORD>@localhost:5432/simi_global
```

### Tenant DB

```
postgresql://simi_tenant_admin:<PASSWORD>@localhost:5433/tenant_acme
```

Replace `<PASSWORD>` with the appropriate password from your `.env` file.
