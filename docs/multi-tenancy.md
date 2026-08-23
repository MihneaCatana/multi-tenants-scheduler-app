# Multi-Tenancy

How the Simi platform isolates tenants — from subdomain resolution through database
provisioning to runtime data access.

> **Related docs:** [Infrastructure](./infrastructure.md) ·
> [Backups](./backups.md) ·
> [Database Access](./database-access.md) ·
> [Modules](./modules.md)

---

## Overview

Simi uses a **separate-database-per-tenant** model. Every tenant (business) gets its own
isolated PostgreSQL database on a dedicated tenant cluster. The global cluster holds only
the control plane: tenant registry, platform admins, sessions, and feature flags.

```
Request Flow:

  acme.simisolutions.localhost
         │
         ▼
  ┌──────────────────┐
  │ Fastify Server     │
  │ tenantPlugin       │
  └──────┬───────────┘
         │ 1. Extract subdomain → "acme"
         │ 2. Look up in global DB tenants table
         │ 3. Resolve feature flags
         ▼
  ┌──────────────────┐
  │ req.tenant        │  ← Tenant row (id, subdomain, dbName, status)
  │ req.tenantDb      │  ← Drizzle instance for tenant_acme
  │ req.tenantFlags   │  ← { appointments: true, ... }
  └──────────────────┘
```

---

## Subdomain Resolution

Tenant identity is determined by the **subdomain** of the request `Host` header.

### How It Works

The tenant plugin (registered as a Fastify `onRequest` hook in
[`src/plugins/tenant.ts`](../backend/src/plugins/tenant.ts)) runs on every request:

1. **Extract subdomain** from the `Host` header using
   [`getSubdomain()`](../backend/src/lib/subdomain.ts).
2. **Look up** the subdomain in the global `tenants` table (only `active` tenants).
3. **Attach** `req.tenant`, `req.tenantDb`, and `req.tenantFlags` to the request.

### Examples

With `BASE_DOMAIN = simisolutions.localhost`:

| Host Header | Subdomain | Tenant? |
|-------------|-----------|----------|
| `acme.simisolutions.localhost` | `acme` | Yes — looks up `acme` |
| `acme.simisolutions.localhost:3000` | `acme` | Yes — port is stripped |
| `simisolutions.localhost` | `null` | No — apex host |
| `localhost` | `null` | No — not under base domain |
| `foo.bar.simisolutions.localhost` | `null` | No — multi-label rejected |

### Subdomain Validation Rules

Subdomains must match this pattern (defined in [`src/lib/subdomain.ts`](../backend/src/lib/subdomain.ts)):

- Lowercase letters, digits, and hyphens only
- 1–63 characters
- Must not start or end with a hyphen
- Single-label only (no dots)

### Apex Host = Admin Console

When `APEX_IS_ADMIN_HOST` is `true` (the default), requests to the base domain
(`simisolutions.localhost`) with no subdomain are treated as **platform admin**
requests. These have no tenant context — the `/v1/admin/*` routes handle tenant
provisioning and flag management.

### Anti-Enumeration Protection

Unknown subdomains return **404** (not 403 or 500) to avoid leaking tenant existence.
Additionally, a per-IP rate limiter tracks unknown-subdomain probes — after **5
unknown subdomains per minute**, further requests from that IP receive **429 Too Many
Requests**.

---

## Tenant Provisioning

Provisioning is triggered via `POST /v1/admin/tenants` (platform admin only) and
implemented in [`src/modules/tenants/provision.ts`](../backend/src/modules/tenants/provision.ts).

### Provisioning Flow

```
POST /v1/admin/tenants
{ name, subdomain, ownerEmail, ownerPassword }
         │
         ▼
  ┌─ 1. Validate subdomain (format + uniqueness in global DB)
  │
  ├─ 2. Create tenant DB from template (as cluster admin)
  │     CREATE DATABASE tenant_<sub> TEMPLATE tenant_template
  │
  ├─ 3. Create per-tenant roles (as cluster admin)
  │     CREATE ROLE tenant_<sub>_owner  LOGIN PASSWORD <HMAC-derived>
  │     CREATE ROLE tenant_<sub>_app    LOGIN PASSWORD <HMAC-derived>
  │     ALTER DATABASE ... OWNER TO tenant_<sub>_owner
  │
  ├─ 4. Configure grants (as tenant owner)
  │     ALTER DEFAULT PRIVILEGES ... GRANT SELECT,INSERT,UPDATE,DELETE
  │     GRANT ... ON ALL TABLES IN SCHEMA public TO tenant_<sub>_app
  │
  ├─ 5. Apply tenant migrations (as tenant owner)
  │     drizzle-kit push / migrate on tenant_<sub>
  │
  ├─ 6. Insert tenant row in global DB
  │     INSERT INTO tenants (id, name, subdomain, dbName, status)
  │
  └─ 7. Seed owner in tenant DB
        INSERT INTO staff (email, passwordHash, role='tenant_admin')
```

### Rollback on Failure

If **any step fails** after the database is created, the system drops the database and
both roles to avoid leaving orphans. A retry will start cleanly.

---

## Per-Tenant Credentials

Each tenant gets **two dedicated PostgreSQL roles** with passwords derived using HMAC-SHA256
from master keys defined in [`src/lib/tenant-creds.ts`](../backend/src/lib/tenant-creds.ts):

### Derivation

```
owner_password = HMAC-SHA256(TENANT_OWNER_MASTER_KEY, tenantId).hex()
app_password   = HMAC-SHA256(TENANT_APP_MASTER_KEY,  tenantId).hex()
```

### Why HMAC-Derived Instead of Random-and-Stored?

- **No password table to leak** — any code path can recompute the password on the fly.
- **Defense in depth** — the master key alone is useless without tenant IDs (which live
  in `simi_global`); tenant IDs alone (from a global dump) are useless without the master
  key.
- **Rotation** — change the master key and run an `ALTER ROLE ... PASSWORD` loop over
  every tenant.

### Role Naming

| Subdomain | DB Name | Owner Role | App Role |
|-----------|---------|-----------|---------|
| `acme` | `tenant_acme` | `tenant_acme_owner` | `tenant_acme_app` |
| `big-corp` | `tenant_big_corp` | `tenant_big_corp_owner` | `tenant_big_corp_app` |
| `demo` | `tenant_demo` | `tenant_demo_owner` | `tenant_demo_app` |

Hyphens are replaced with underscores. The naming is deterministic — the same subdomain
always produces the same identifiers.

---

## Blast-Radius Containment

The following table shows what each credential tier can reach if compromised:

| Credential | Can Reach | Cannot Reach |
|-----------|-----------|-------------|
| Global `simi_global_admin` | Entire global cluster (all DBs) | Tenant cluster |
| Global `simi_global_migrate` | DDL on `simi_global` only | Tenant cluster, DML on global |
| Global `simi_global_app` | DML on `simi_global` only | Tenant cluster, DDL on global |
| Tenant `tenant_<sub>_owner` | DDL + DML on **one** tenant DB | Global cluster, other tenant DBs |
| Tenant `tenant_<sub>_app` | DML on **one** tenant DB only | Global cluster, other tenant DBs, DDL |

**Key properties:**

- Compromise of the global cluster's superuser **cannot** reach any tenant database
  (separate PostgreSQL instance).
- Compromise of the tenant cluster's superuser **can** read all tenant databases but
  **cannot** reach the global cluster.
- A leaked tenant `app` credential exposes exactly **one** tenant's data — no more.

---

## Tenant Suspension

Platform admins can suspend a tenant via `PATCH /v1/admin/tenants/:id/status` with
`{ status: "suspended" }`.

What happens on suspension:

1. The tenant's `status` column is set to `suspended` in the global `tenants` table.
2. **All refresh tokens** in the tenant's `tenant_sessions` table are revoked.
3. The cached tenant database pool is closed and evicted.
4. The tenant subdomain immediately starts returning **404** — the tenant plugin only
   looks up `active` tenants.

Suspension does **not** delete the database. The tenant data is preserved and can be
reactivated by setting the status back to `active`.

---

## Runtime Request Lifecycle

For a typical tenant request (e.g., `GET /v1/clients` on `acme.simisolutions.localhost`):

```
1. Fastify receives request
   ↓
2. Security plugins (Helmet, CORS, rate-limit)
   ↓
3. Feature-flag catalog sync (on boot only)
   ↓
4. Error handler registration
   ↓
5. Auth plugin
   └─ Verifies JWT access token → sets req.userClaims
   ↓
6. Tenant plugin (onRequest hook)
   ├─ Extracts subdomain "acme" from Host header
   ├─ Looks up tenant in global DB (active only)
   ├─ Creates/gets tenant DB pool → sets req.tenantDb
   ├─ Resolves feature flags → sets req.tenantFlags
   └─ Routes logs to per-tenant log file
   ↓
7. Route preHandler
   └─ requireTenantUser guard (checks role + tenant match)
   ↓
8. Controller → calls module service with req.tenantDb
   ↓
9. Module service → queries tenant DB via Drizzle ORM
   ↓
10. Response returned
```

**Architectural invariant:** Apart from the two global reads (tenant identity lookup +
feature flags), a tenant request **must never** reach into the global database. All tenant
data lives in the tenant's own database.
