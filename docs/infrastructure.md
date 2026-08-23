# Infrastructure

An overview of the Simi platform's infrastructure — Docker services, networking, and
how the pieces fit together.

> **Related docs:** [Multi-Tenancy](./multi-tenancy.md) ·
> [Backups](./backups.md) ·
> [Database Access](./database-access.md) ·
> [Modules](./modules.md)

---

## Tech Stack at a Glance

| Layer | Technology | Version |
|-------|-----------|---------|
| Runtime | Node.js | 20+ |
| Language | TypeScript (strict) | 5.8.x |
| API Framework | Fastify | 5.x |
| ORM | Drizzle ORM | 0.45.x |
| Database | PostgreSQL | 16 |
| Validation | Zod | 3.24.x |
| Auth | JWT (EdDSA/HS256) + Argon2id | — |
| Frontend | React 18 + Vite + Tailwind CSS | — |
| UI | shadcn/ui (Radix UI) + Adobe Spectrum | — |
| Package Manager | pnpm (backend) / npm (frontend) | — |

---

## Docker Compose Stack

The backend defines **5 services** in [`docker-compose.yml`](../backend/docker-compose.yml):

```
┌──────────────────────────────────────────────────────────────────┐
│  Docker Network: "simi" (bridge)                                  │
│                                                                    │
│  ┌──────────────────┐    ┌──────────────────┐                     │
│  │ postgres-global  │    │ postgres-tenant  │                     │
│  │ simi_global       │    │ tenant_*         │                     │
│  │ Port 5432 → 5432 │    │ Port 5433 → 5432 │                     │
│  └────────┬─────────┘    └────────┬─────────┘                     │
│           │                       │                               │
│  ┌────────▼─────────┐    ┌────────▼─────────┐                     │
│  │ backup-global     │    │ backup-tenant     │                     │
│  │ pg_dump @daily    │    │ pg_dumpall @daily │                     │
│  └──────────────────┘    └──────────────────┘                     │
│                                                                    │
│  ┌──────────────────┐                                             │
│  │ app               │                                             │
│  │ Fastify API       │                                             │
│  │ Port 3000         │                                             │
│  └──────────────────┘                                             │
└──────────────────────────────────────────────────────────────────┘
```

### Service Details

| Service | Image | Purpose | Resources |
|---------|-------|---------|-----------|
| `postgres-global` | `postgres:16-bookworm` | Global control-plane DB (auth, tenant registry, feature flags) | 1 GB RAM, 2 CPUs |
| `postgres-tenant` | `postgres:16-bookworm` | Hosts all per-tenant databases (`tenant_<subdomain>`) | 1 GB RAM, 2 CPUs |
| `backup-global` | `prodrigestivill/postgres-backup-local:16` | Daily `pg_dump` of global DB, GPG-encrypted, 30-day retention | 256 MB RAM, 0.5 CPUs |
| `backup-tenant` | `prodrigestivill/postgres-backup-local:16` | Daily `pg_dumpall` of tenant cluster, GPG-encrypted, 30-day retention | 256 MB RAM, 0.5 CPUs |
| `app` | Multi-stage Dockerfile | Fastify API with hot-reload (dev mode) | 512 MB RAM, 1.0 CPUs |

### Port Mapping

All ports are bound to `127.0.0.1` only (localhost access).

| Port | Host → Container | Service |
|------|-----------------|---------|
| **5432** | `5432 → 5432` | Global PostgreSQL (`simi_global`) |
| **5433** | `5433 → 5432` | Tenant PostgreSQL cluster (template + all tenant DBs) |
| **3000** | `${PORT} → ${PORT}` | Fastify API (default 3000) |

### Docker Volumes

| Volume | Mounted On | Contains |
|--------|-----------|----------|
| `pgdata-global` | `postgres-global` | Global database data files |
| `pgdata-tenant` | `postgres-tenant` | Tenant cluster data files |
| `backups-global` | `backup-global` | Global DB backup archives |
| `backups-tenant` | `backup-tenant` | Tenant cluster backup archives |

---

## Two-Cluster Architecture

Simi uses **two separate PostgreSQL clusters** for blast-radius containment:

```
  Global Cluster                    Tenant Cluster
  ┌──────────────┐                  ┌──────────────────────────┐
  │ simi_global   │                  │ tenant_template           │
  │               │                  │ tenant_acme               │
  │ Tables:       │                  │ tenant_big_corp           │
  │ - tenants     │                  │ tenant_...                │
  │ - users       │                  │                           │
  │ - sessions    │                  │ Per-tenant tables:        │
  │ - features    │                  │ - staff, clients,         │
  │ - tenant_     │                  │   appointments, services, │
  │   features    │                  │   resources, etc.          │
  └──────────────┘                  └──────────────────────────┘
```

- **Global cluster** — Control plane: tenant registry, platform admin users, sessions,
  and the feature flag catalog. A tenant's application code **never** connects to this
  cluster at runtime (only during tenant provisioning and feature flag resolution).
- **Tenant cluster** — Business data. Each tenant gets its own database created from
  `tenant_template`. The app connects per-tenant using dedicated credentials.

**Why two clusters?** A SQL injection or credential leak on one cluster cannot reach
the other. Compromise of a tenant DB cannot read the tenant registry or other tenants.

---

## 3-Tier Role Model

Each PostgreSQL cluster has a **3-tier role model** that limits what each code path can
do:

| Tier | Role Pattern | Privileges | Used By |
|------|-------------|------------|---------|
| **admin** | `*_admin` | Superuser: `CREATE DATABASE`, `CREATE ROLE`, break-glass | Provisioning, cleanup only |
| **owner** | `tenant_<sub>_owner` | DDL on one tenant DB only | Migrations, provisioning |
| **migrate** | `*_migrate` | DDL on template DB only | Drizzle Kit introspection |
| **app** | `*_app` | DML (SELECT/INSERT/UPDATE/DELETE) | Runtime application code |

On the **global cluster**, the roles are:
- `simi_global_admin` — superuser
- `simi_global_migrate` — DDL on `simi_global`
- `simi_global_app` — DML on `simi_global`

On the **tenant cluster**, in addition to the shared `simi_tenant_migrate` and
`simi_tenant_admin`, **each tenant** gets its own:
- `tenant_<subdomain>_owner` — DDL inside this tenant's DB only
- `tenant_<subdomain>_app` — DML inside this tenant's DB only

See [Multi-Tenancy](./multi-tenancy.md) and [Database Access](./database-access.md) for
details on how per-tenant credentials are derived.

---

## Quick Start

### One-Command Setup (Recommended)

From the `backend/` directory:

```bash
pnpm setup
```

This runs the full pipeline:
1. Creates `.env` from `.env.example` if missing
2. Generates JWT keys and HMAC master keys
3. Starts Docker Compose
4. Waits for both databases to become healthy
5. Runs global migrations
6. Runs tenant template migrations
7. Seeds the platform admin user
8. Provisions a sample tenant (`demo` subdomain)

After setup, the API is available at `http://localhost:3000` and the health endpoint
responds at `GET /health`.

### Manual Setup

```bash
# 1. Copy and fill in the environment file
cp .env.example .env
# Edit .env — every *_PASSWORD, *_MASTER_KEY, and COOKIE_SECRET must be set.

# 2. Start databases only (no backups or app)
docker compose up postgres-global postgres-tenant

# 3. Run migrations
docker compose exec app pnpm db:migrate:global
docker compose exec app pnpm db:migrate:tenant

# 4. Seed the platform admin
docker compose exec app pnpm seed

# 5. Start everything
docker compose up
```

### Useful Commands

```bash
# Start the full stack
docker compose up

# Start only databases
docker compose up postgres-global postgres-tenant

# View logs for a specific service
docker compose logs app --since 5m
docker compose logs backup-tenant --since 5m

# Run global migrations
docker compose exec app pnpm db:migrate:global

# Run tenant template migrations (also migrates all registered tenants)
docker compose exec app pnpm db:migrate:tenant

# Seed the platform admin user
docker compose exec app pnpm seed

# Stop everything
docker compose down

# Stop and remove volumes (destroys all data)
docker compose down -v
```

---

## Environment Variables

Environment configuration is centralized in [`backend/src/config/env.ts`](../backend/src/config/env.ts)
and validated at startup with Zod. All variables are documented in
[`.env.example`](../backend/.env.example).

### Key Variable Groups

| Group | Key Variables | Notes |
|-------|-------------|-------|
| **Runtime** | `NODE_ENV`, `HOST`, `PORT` | Default: development, `0.0.0.0`, `3000` |
| **Domain** | `BASE_DOMAIN`, `APEX_IS_ADMIN_HOST` | Tenant subdomain resolution |
| **Trust Proxy** | `TRUST_PROXY` | Security-critical; default `false` |
| **JWT / Auth** | `JWT_ALGORITHM`, `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY`, `ACCESS_TOKEN_TTL`, `REFRESH_TOKEN_TTL`, `COOKIE_SECRET` | EdDSA recommended for production |
| **Global DB** | `GLOBAL_DB_HOST`, `GLOBAL_DB_PORT`, `GLOBAL_DB_NAME`, `GLOBAL_DB_USER`, `GLOBAL_DB_PASSWORD`, `GLOBAL_DB_MIGRATE_*`, `GLOBAL_DB_ADMIN_*` | All passwords ≥ 16 chars |
| **Tenant DB** | `TENANT_DB_HOST`, `TENANT_DB_PORT`, `TENANT_DB_TEMPLATE`, `TENANT_DB_MIGRATE_*`, `TENANT_DB_ADMIN_*` | Per-tenant roles derived at provisioning |
| **HMAC Keys** | `TENANT_OWNER_MASTER_KEY`, `TENANT_APP_MASTER_KEY` | ≥ 32 chars; different per environment |
| **Backup** | `BACKUP_ENCRYPT_PASSPHRASE` | GPG passphrase for encrypted backups |
| **Observability** | `LOG_DIR`, `LOG_RETENTION_DAYS`, `LOG_LEVEL` | File-based logging |
| **Feature Flags** | `FLAG_CACHE_TTL_MS` | Per-tenant resolved-flag cache (default 15s) |
| **Seed** | `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | Used by `pnpm seed` |

### Generating Secrets

The backend includes a helper script:

```bash
pnpm generate-secrets
```

This generates secure random values for JWT keys, HMAC master keys, and the cookie
secret.

---

## Frontend Development

The frontend uses Vite with a multi-tenant proxy that rewrites the `Host` header based
on the subdomain:

- Dev server: `http://localhost:5173`
- API proxy: forwards to `http://localhost:3000`
- Access a tenant at: `http://<subdomain>.simisolutions.localhost:5173`
- Access admin at: `http://simisolutions.localhost:5173`

See [`frontend/README.md`](../frontend/README.md) for frontend-specific setup.
