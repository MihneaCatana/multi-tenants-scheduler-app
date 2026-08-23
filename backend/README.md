# Simi Backend

Multi-tenant SaaS backend for managing a small/medium business. Each tenant gets
its **own PostgreSQL database** on a dedicated **tenant cluster** and owns its
**entire world** there (people, sessions, business data). A separate **global
cluster** is a pure **control plane**: the tenant registry (subdomain → DB), the
feature-flag whitelist, and platform-admin login identities. Two physical
Postgres clusters ensure that a compromise of one cannot reach the other.

- **Stack:** Node.js 20+ (TypeScript) · Fastify 5 · Drizzle ORM · PostgreSQL 16 · pnpm · Zod · JWT
- **Tenancy:** one DB per tenant, resolved by subdomain
- **Isolation model:** a tenant's data lives **only** in its own DB. The only
  global→tenant data flow is the feature-flag whitelist (`req.tenantFlags`,
  resolved once per request). Tenant users authenticate against their own DB's
  `people` table — not against a shared global user store.
- **Auth:** JWT access tokens (`iss`/`aud`-bound) + rotated refresh tokens (Argon2id
  passwords, race-proof compare-and-set rotation). Tenant sessions live in the
  tenant DB; platform-admin sessions live in the global DB.
- **Isolation:** two Postgres clusters · 3-tier roles per cluster · per-tenant
  owner roles · `REVOKE CREATE` on public · daily backups
- **Guarantee:** platform staff (`platform_admin`) have **no tenant** and are
  structurally forbidden from accessing any tenant data. Even the tenant cluster
  superuser cannot reach the global cluster.

---

## Architecture in one paragraph

Requests arrive at `*.BASE_DOMAIN` (a tenant) or at `BASE_DOMAIN` (the admin
host). The `tenant` plugin maps the subdomain to a row in the global `tenants`
table (the single control-plane lookup) and attaches a **tenant-scoped Drizzle
instance** (`req.tenantDb`) that points only at that tenant's database. The same
hook resolves the tenant's **feature flags** (the whitelist) from the global
catalog and attaches them as `req.tenantFlags` — this is the only global→tenant
data flow. The `auth` plugin verifies the JWT (checking signature, expiry,
`iss`, `aud`, and `type` claims) and enforces that the token's `tenantId`
matches the subdomain's tenant. Tenant-scoped handlers use `req.tenantDb`
exclusively — they physically cannot reach another tenant's data or the global
cluster.

`TRUST_PROXY` defaults to `false` — `req.ip` and `req.hostname` are taken from
the TCP connection, not from client-supplied `X-Forwarded-*` headers. Behind a
reverse proxy, set `TRUST_PROXY` to the proxy's CIDR (or a hop count).

---

## Quick start (Docker)

### One-command setup

From a clean checkout, with Docker running:

```bash
pnpm setup
```

That's it. `pnpm setup` (`scripts/dev-setup.mjs`, cross-platform) does the whole
first-time dance for you:

1. Copies `.env.example` → `.env` if none exists.
2. Brings up the full Docker stack detached (both Postgres clusters, backup
   sidecars, and the app on `tsx watch` hot reload).
3. Waits for both Postgres clusters to be healthy **and** connectable.
4. Applies migrations (global DB + every tenant DB) inside the app container.
5. Seeds the platform admin (`pnpm seed` — idempotent; rotates the password to
   match `SEED_ADMIN_*`).
6. Provisions a sample **Acme** tenant so the env is testable end to end
   (skipped if it already exists).

Re-running `pnpm setup` is safe — every step is idempotent. At the end it
prints the exact `curl` commands to log in and hit the API.

### Manual setup

If you'd rather drive each step yourself:

```bash
cp .env.example .env
docker compose up --build          # 2× postgres + 2× backup + app (hot reload)
# in another terminal:
docker compose exec app pnpm db:migrate   # apply global + tenant migrations
docker compose exec app pnpm seed         # create the platform admin
```

Then:

- Admin host → `http://simisolutions.localhost:3000/health`
- Log in as the platform admin (`POST /auth/login`) and provision a tenant:

```bash
curl -X POST http://simisolutions.localhost:3000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@simisolutions.localhost","password":"change-me-please"}'
# copy the accessToken, then:
curl -X POST http://simisolutions.localhost:3000/admin/tenants \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Acme Inc","subdomain":"acme","email":"owner@acme.com","password":"supersecret"}'
```

- Use the tenant on its subdomain:

```bash
curl -X POST http://acme.simisolutions.localhost:3000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"owner@acme.com","password":"supersecret"}'
```

### Local DNS

Most OSes resolve `*.localhost` automatically. If yours doesn't, add entries to
your `hosts` file (`127.0.0.1 acme.simisolutions.localhost simisolutions.localhost`),
or use a tool like `dnsmasq`.

---

## Local development (without Docker)

```bash
pnpm install
cp .env.example .env            # point the *_DB_* vars at your Postgres instances
pnpm db:generate                # generate migration SQL from the schemas (global + tenant)
pnpm db:migrate                 # apply global + per-tenant migrations
pnpm seed                       # bootstrap the platform admin
pnpm dev                        # tsx watch on src/index.ts
```

Other useful commands:

```bash
pnpm build                      # tsc + tsc-alias → dist/
pnpm start                      # node dist/index.js (production)
pnpm typecheck                  # tsc --noEmit
pnpm lint                       # eslint
pnpm format                     # prettier
pnpm provision:tenant           # CLI tenant provisioning (without HTTP server)
```

---

## Project layout

```
src/
├── index.ts                     # bootstrap: buildApp → listen → graceful shutdown
├── app.ts                       # builds Fastify instance, registers plugins + routes
├── config/
│   └── env.ts                   # zod-validated env (fails fast on boot)
├── db/
│   ├── client.ts                # global pool + Drizzle instance (DML role)
│   ├── tenant-pool.ts           # LRU cache of per-tenant Drizzle instances (max 50 cached)
│   ├── migrate.ts               # global=migrate role; tenants=per-tenant owner role
│   ├── schema/global/           # tenants, users (platform admins), sessions, features
│   ├── schema/tenant/           # people + tenant_sessions (per-tenant)
│   └── migrations/{global,tenant}/  # Drizzle Kit output (committed)
├── plugins/
│   ├── security.ts              # helmet, cors, rate-limit, cookie
│   ├── error-handler.ts         # centralized JSON errors
│   ├── tenant.ts                # subdomain → tenant + tenantDb + feature flags (whitelist)
│   └── auth.ts                  # JWT verify + role/tenant guards
├── routes/                      # HTTP wiring only (method, path, guard → controller method)
│   ├── index.ts                 # registerApiRoutes(app): single registration call used by app.ts
│   ├── auth.routes.ts           # /auth/login, /refresh, /logout, /me, /change-password
│   ├── admin.routes.ts          # /admin/tenants + /admin/features (apex only)
│   ├── accounts.routes.ts       # /accounts CRUD (contacts view over `people`)
│   ├── users.routes.ts          # /users CRUD (login-identity view over `people`)
│   └── flags.routes.ts          # /features (tenant's resolved flags)
├── controllers/                 # request-handler logic (parse → service → response)
│   ├── auth.controller.ts       # auth handlers (context-split: tenant DB vs global)
│   ├── admin.controller.ts      # list/provision/status + its request schemas
│   ├── accounts.controller.ts   # contacts CRUD over `people`
│   ├── users.controller.ts      # login-identity CRUD over `people`
│   └── flags.controller.ts      # tenant flag reads
├── modules/                     # service/business layer (no HTTP wiring)
│   ├── auth/                    # service.ts (global), tenant-service.ts (tenant DB), tokens.ts
│   ├── tenants/provision.ts     # admin→CREATE DATABASE, owner→grants, owner→migrate + seed owner
│   ├── users/service.ts         # login-identity mgmt on `people` + `tenant_sessions`
│   └── flags/service.ts         # feature-flag catalog + per-tenant resolution (whitelist)
├── lib/
│   ├── crypto.ts                # Argon2id, token hashing, timing-safe compare
│   ├── errors.ts                # HttpError class + factories
│   ├── logger.ts                # pino (redacts secrets)
│   ├── roles.ts                 # Role enum + guard helpers
│   ├── subdomain.ts             # subdomain parsing + db name + owner role name
│   ├── tenant-creds.ts          # HMAC-SHA256 per-tenant owner password derivation
│   └── is-main.ts               # cross-platform "am I the entry module?" check
└── scripts/
    ├── seed.ts                  # bootstrap/rotate platform admin
    └── provision-tenant.ts      # CLI tenant provisioning without HTTP server
```

### Root config files

| File | Purpose |
|------|---------|
| `package.json` | Scripts, dependencies |
| `tsconfig.json` | Base TS config; path aliases (`@/*`, `@config/*`, `@db/*`, etc.); `verbatimModuleSyntax` |
| `tsconfig.build.json` | Build config; excludes `src/scripts/**` and `drizzle.config.*.ts` |
| `drizzle.config.global.ts` | Drizzle Kit: global schema → `src/db/migrations/global` |
| `drizzle.config.tenant.ts` | Drizzle Kit: tenant schema → `src/db/migrations/tenant` |
| `eslint.config.js` | ESLint v9 flat config + typescript-eslint |
| `prettierrc.json` | Prettier config |
| `Dockerfile` | Multi-stage: deps → build → prod-deps → runner (non-root, ships migrations) |
| `docker-compose.yml` | 2× postgres 16 + 2× backup sidecars + app |
| `.env.example` | All env vars documented inline |

---

## API routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | None | Health check |
| POST | `/auth/login` | None | Login — tenant subdomain authenticates against `people`; apex against global `users` |
| POST | `/auth/refresh` | None | Rotate refresh token (tenant `tenant_sessions` / global `sessions`) |
| POST | `/auth/logout` | None | Revoke refresh token |
| GET | `/auth/me` | Any authenticated | Current user info |
| POST | `/auth/change-password` | Any authenticated | Self-service password change |
| GET | `/admin/tenants` | Platform admin | List tenants (paginated, filterable by status) |
| POST | `/admin/tenants` | Platform admin | Provision a new tenant (seeds owner into tenant `people`) |
| PATCH | `/admin/tenants/:id/status` | Platform admin | Suspend/activate a tenant (revokes tenant sessions + closes pool on suspend) |
| GET | `/admin/features` | Platform admin | Feature-flag catalog (the whitelist) |
| GET | `/admin/tenants/:id/flags` | Platform admin | A tenant's flag overrides |
| PUT | `/admin/tenants/:id/flags` | Platform admin | Set a tenant's flag overrides |
| GET | `/features` | Any tenant user | This tenant's resolved feature flags (the whitelist, applied) |
| GET | `/users` | Tenant admin | List login identities (from `people`) |
| POST | `/users` | Tenant admin | Create a staff user (login identity in `people`) |
| PATCH | `/users/:id` | Tenant admin | Update a user's name/role |
| POST | `/users/:id/reset-password` | Tenant admin | Admin password reset → temp password |
| PATCH | `/users/:id/status` | Tenant admin | Activate/deactivate a user |
| GET | `/accounts` | Any tenant user | List contacts (contact view of `people`) |
| GET | `/accounts/:id` | Any tenant user | Get single contact |
| POST | `/accounts` | Tenant admin | Create a contact |
| PATCH | `/accounts/:id` | Tenant admin | Update a contact |
| DELETE | `/accounts/:id` | Tenant admin | Delete a contact |

Rate limits: login 10/min, refresh 20/min, change-password 10/min, provision
10/min, status update 20/min, user create 20/min, global default 200/min.

---

## Security architecture

### Two physical clusters

| Cluster | Host | Port | Databases | Docker service |
|---------|------|------|----------|---------------|
| **Global** | `postgres-global` | 5432 | `simi_global` (tenants registry, platform-admin users/sessions, flag catalog) | `postgres-global` |
| **Tenant** | `postgres-tenant` | 5433 | `tenant_template` + `tenant_<sub>` (people, tenant_sessions, business data) | `postgres-tenant` |

A SQL injection on one cluster physically cannot reach the other.

### 3-tier roles per cluster

| Tier | Privileges | Used by |
|------|-----------|---------|
| **app** (DML) | SELECT, INSERT, UPDATE, DELETE on tables. No DDL, no extensions. | Runtime pools (`client.ts`, `tenant-pool.ts`) |
| **migrate** (DDL) | Owns schema, CREATE TABLE, ALTER, DROP. | `db:migrate`, `drizzle-kit` |
| **admin** (superuser) | CREATE DATABASE, CREATE ROLE, break-glass. Never at runtime. | Backups, provisioning, deprovisioning |

### Per-tenant owner roles

Each tenant DB has a dedicated owner role (`tenant_<sub>_owner`) with full DDL
inside that DB only. Password is HMAC-SHA256-derived from a master key + the
tenant ID. A leaked owner credential compromises exactly **one** tenant.

### Blast radius

| Leaked credential | Impact |
|-------------------|--------|
| `GLOBAL_DB_USER/PASSWORD` | DML in `simi_global` (platform-admin users/sessions, tenants registry, flag catalog). Cannot reach any tenant DB. |
| `GLOBAL_DB_ADMIN_USER/PASSWORD` | Full superuser on global cluster only. Cannot reach any tenant DB. |
| `tenant_<sub>_app` password | DML inside ONE tenant DB only. Cannot reach any other tenant DB or global. |
| `TENANT_DB_ADMIN_USER/PASSWORD` | Full superuser on tenant cluster only. Cannot reach global. |
| `tenant_<sub>_owner` password | Full power inside ONE tenant DB only. |

### Backups

- **Global cluster:** `pg_dump simi_global` daily → `backups-global` volume.
- **Tenant cluster:** `pg_dumpall` daily → `backups-tenant` volume.
- Retention: 30 days / 90 files. Automated via `prodrigestivill/postgres-backup:16`.

See `CODEBASE.md §15` for the full security architecture, HMAC derivation details,
PITR guidance, and the negative-test matrix.

---

## Data model

**Global DB (`simi_global`) — the control plane**

| Table     | Purpose                                                            |
|-----------|-------------------------------------------------------------------|
| `tenants` | one row per tenant (subdomain → `db_name`, status)                |
| `users`   | **platform admins only** (`role = platform_admin`)               |
| `sessions`| platform-admin refresh tokens (hashed; rotated, revocable)        |
| `features` | feature-flag catalog — the **whitelist** of capabilities         |
| `tenant_features` | per-tenant flag overrides (which flags each tenant may use) |

The global DB holds **no tenant user data**. Tenant users and their sessions
live entirely in each tenant's own DB.

**Tenant DB (per tenant, identical schema) — the tenant's entire world**

| Table      | Purpose                                  |
|------------|------------------------------------------|
| `people` | unified table: everyone a tenant knows about. A row is a **contact** (CRM record) OR a **login identity** (tenant admin/staff). A row can log in iff `password_hash IS NOT NULL AND role IS NOT NULL`. |
| `tenant_sessions` | this tenant's refresh tokens (hashed; rotated, revocable) |

`/accounts` is a **contact view** over `people` (the CRM fields); `/users` is a
**login-identity view** over `people` (rows with a password hash). Both are the
same table, filtered differently.

Tenant tables do **not** exist in the global DB and vice versa.

---

## Migrations

Drizzle Kit diffs the TypeScript schema into SQL under `src/db/migrations/`.

```bash
pnpm db:generate:global       # after editing src/db/schema/global/**
pnpm db:generate:tenant       # after editing src/db/schema/tenant/**
pnpm db:generate              # both at once
pnpm db:migrate               # applies global (migrate role) + every tenant DB (owner role)
```

`db:migrate` is idempotent (Drizzle tracks applied migrations per DB) and is
run automatically inside provisioning for new tenants, so new tenants always
receive the latest schema.

---

## Auth & security model

- **Access token** (JWT, 15 min): carries `sub`, `role`, `tenantId`, `type:
  'access'`, `iss` (`simi-backend`), `aud` (`simi-api`). All claims enforced
  on verify — a token from another service or with the wrong type is rejected.
  `tenantId` is `null` for platform admins; for tenant users it is the resolved
  tenant id (bound to the subdomain they authenticated against).
- **Two session stores**: tenant users → `tenant_sessions` in their own tenant
  DB; platform admins → `sessions` in the global DB. Each endpoint branches on
  request context (tenant subdomain vs apex) to use the right store.
- **Refresh token** (opaque, 30d): stored **hashed** (SHA-256);
  **rotated** on every refresh via an atomic compare-and-set (`UPDATE … WHERE
  revoked_at IS NULL`). A second concurrent request presenting the same token
  loses the race and triggers revocation of all that user's sessions (theft
  detection). A partial unique index on `refresh_hash WHERE revoked_at IS NULL`
  backs this up at the DB level. Delivered via HttpOnly, SameSite=Strict cookie.
- **Passwords**: Argon2id (`@node-rs/argon2`).
- **JWT algorithm**: asymmetric (`EdDSA`/`RS256`) in production. HS256 is
  allowed only in `NODE_ENV != production` for local convenience and the app
  refuses to start in production without asymmetric keys.
- **Proxy trust** (`TRUST_PROXY`): defaults to `false`. `req.ip` and
  `req.hostname` are taken from the TCP connection, not client-supplied
  forwarded headers. Set to a proxy CIDR or hop count in production. The proxy
  **must** overwrite (not append to) `X-Forwarded-Host` and `X-Forwarded-For`.
- **Tenant isolation guards** (in `plugins/auth.ts`):
  - `platform_admin` → apex-only, blocked from any tenant route.
  - tenant users → token `tenantId` must equal the subdomain's tenant, else `403`.

---

## Docker

### Multi-stage build

The Dockerfile produces a minimal production image:

1. **deps** — install all dependencies (cached layer).
2. **build** — typecheck + compile TypeScript + rewrite path aliases (`tsc-alias`).
3. **prod-deps** — install production dependencies only.
4. **runner** — non-root user (`app:1001`), copies `dist/` + migrations, healthcheck
   on `/health`, runs `node dist/index.js`.

### Services

| Service | Image | Purpose |
|---------|-------|---------|
| `postgres-global` | `postgres:16-bookworm` | Global cluster (`simi_global`, port 5432). |
| `postgres-tenant` | `postgres:16-bookworm` | Tenant cluster (`tenant_template` + `tenant_*`, port 5433). |
| `backup-global` | `prodrigestivill/postgres-backup:16` | `pg_dump simi_global` daily, 30 day retention. |
| `backup-tenant` | `prodrigestivill/postgres-backup:16` | `pg_dumpall` daily, 30 day retention. |
| `app` | Build from Dockerfile (dev: `deps` stage) | API with hot reload; depends on both postgres services. |

Volumes: `pgdata-global`, `pgdata-tenant`, `backups-global`, `backups-tenant`.

---

## Adding a new tenant-scoped entity

1. Add a table in `src/db/schema/tenant/<entity>.ts` and re-export it from
   `src/db/schema/tenant/index.ts` (add it to `tenantSchema`).
2. `pnpm db:generate:tenant` → new SQL files appear under
   `src/db/migrations/tenant`.
3. `pnpm db:migrate` → applied to every tenant DB.
4. Add a controller at `src/controllers/<entity>.controller.ts` (handlers using
   `req.tenantDb`) and a route file at `src/routes/<entity>.routes.ts` (thin
   HTTP wiring + guards), then register the routes file in
   `src/routes/index.ts`.

That's the whole pattern — the isolation plumbing handles itself.

---

## Environment variables

See `.env.example` for the full list with comments. All validated by zod at
boot — the app refuses to start with missing or invalid config. Key groups:

- **Runtime:** `NODE_ENV`, `HOST`, `PORT`, `BASE_DOMAIN`, `TRUST_PROXY`,
  `JWT_ALGORITHM`, `JWT_ISSUER`, `JWT_AUDIENCE`, `JWT_PRIVATE_KEY`,
  `JWT_PUBLIC_KEY`, `ACCESS_TOKEN_TTL`, `REFRESH_TOKEN_TTL`
- **Global cluster:** `GLOBAL_DB_HOST`, `GLOBAL_DB_USER/PASSWORD` (app),
  `GLOBAL_DB_MIGRATE_USER/PASSWORD`, `GLOBAL_DB_ADMIN_USER/PASSWORD`
- **Tenant cluster:** `TENANT_DB_HOST`, `TENANT_DB_MIGRATE_USER/PASSWORD`,
  `TENANT_DB_ADMIN_USER/PASSWORD`
- **Per-tenant credential derivation:** `TENANT_OWNER_MASTER_KEY` (min 32 chars),
  `TENANT_APP_MASTER_KEY` (min 32 chars)
- **Bootstrap:** `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`

---

## Contributing

See [`CODEBASE.md`](./CODEBASE.md) for the full contributor orientation guide,
including request lifecycle, directory map, conventions, gotchas, troubleshooting,
and the deep-dive security architecture.
