# CODEBASE.md

> Index + orientation guide for the **Simi backend**. Use this at the start of a
> new conversation to orient quickly before reading specific files.
> It is a companion to `README.md` (which is user-facing); this file is
> oriented toward contributors / agents working in the code.

---

## 1. What this project is

A **multi-tenant SaaS backend** for managing a small/medium business. The
defining architectural choice is **one PostgreSQL database per tenant** for hard
data isolation: a tenant's **entire world** (people, sessions, business data)
lives in its own DB. A single **global database** is a pure **control plane** —
the tenant registry (subdomain → DB), the feature-flag whitelist, and
platform-admin login identities.

- **Stack:** Node.js 20+ · TypeScript (strict) · Fastify 5 · Drizzle ORM ·
  PostgreSQL 16 · pnpm · Zod · JWT.
- **Tenancy model:** tenant resolved from request **subdomain**; each tenant has
  its own physical DB. A platform staff user (`platform_admin`) has **no tenant**
  and is structurally forbidden from accessing any tenant data.
- **The bridge:** the only global→tenant data flow is the **feature-flag
  whitelist** (`req.tenantFlags`, resolved once per request in the tenant hook).
  Apart from the subdomain→tenant lookup and flags, a tenant request never
  reaches into the global DB.

### The one-paragraph mental model

A request to `*.BASE_DOMAIN` hits a tenant; a request to `BASE_DOMAIN` (apex) is
the admin host. The `tenant` plugin maps the subdomain → a row in the global
`tenants` table (the single control-plane lookup), attaches a **tenant-scoped
Drizzle instance** to `req.tenantDb`, and resolves the tenant's **feature flags**
(the whitelist) into `req.tenantFlags`. The `auth` plugin verifies the JWT and
enforces that the token's `tenantId` matches the subdomain's tenant.
Tenant-scoped handlers use `req.tenantDb` exclusively — they physically cannot
reach another tenant's data or the global cluster.

---

## 2. Request lifecycle (read this first)

```
HTTP request
  → securityPlugins   (helmet, cors, rate-limit, cookie)        plugins/security.ts
  → errorHandler      (sets the error handler)                  plugins/error-handler.ts
  → authPlugin        (registers @fastify/jwt, decorates        plugins/auth.ts
                       verifyAccessToken — NOT enforced yet)
  → tenantPlugin      (onRequest hook):                          plugins/tenant.ts
                       subdomain → global tenants row →
                       req.tenant + req.tenantDb
                       (bypassed for /health and /admin prefixes)
  → route preHandler  (guard functions: requireAuth /          plugins/auth.ts
                       requirePlatformAdmin / requireTenantUser)
  → route handler     (uses req.tenantDb for tenant data,       routes/*.routes.ts →
                       globalDb for global data)                controllers/*.controller.ts
```

**Key invariant:** tenant data is only ever accessed via `req.tenantDb`, which
is only ever set by the `tenant` plugin after subdomain resolution. Global data
(users, sessions, tenants registry) is accessed via the `globalDb` singleton from
`src/db/client.ts`.

---

## 3. Directory map (file → purpose)

```
src/
├── index.ts                         # bootstrap: buildApp → listen → graceful shutdown
├── app.ts                           # builds Fastify instance, registers plugins + routes
│
├── config/
│   └── env.ts                       # zod-validated env (fails fast on boot);
│                                     # resolveJwtSecret(), ttlToSeconds(), hasProductionJwtKeys
│
├── db/
│   ├── client.ts                    # global pool + Drizzle instance (globalDb);
│   │                                 # withGlobalConnection(), closeGlobalDb()
│   ├── tenant-pool.ts               # LRU cache of per-tenant pg.Pool + Drizzle;
│   │                                 # tenantDbFor(id, dbName) is THE way to get a tenant DB
│   ├── migrate.ts                   # migrates global DB + every active tenant DB;
│   │                                 # export migrateTenantDb() used by provisioning
│   ├── schema/
│   │   ├── global/
│   │   │   ├── index.ts             # barrel: tenants, users (platform admins), sessions, features
│   │   │   ├── tenants.ts           # id, name, subdomain, db_name, status, timestamps
│   │   │   ├── users.ts             # platform-admin login identities ONLY (no tenant_id)
│   │   │   ├── sessions.ts          # platform-admin refresh-token rows (hashed)
│   │   │   └── features.ts          # features catalog + tenant_features (the whitelist)
│   │   └── tenant/
│   │       ├── index.ts             # barrel + `tenantSchema` aggregate export
│   │       ├── people.ts            # unified contacts + login identities (see §4)
│   │       └── tenant-sessions.ts   # tenant refresh-token rows (hashed); FK → people
│   └── migrations/{global,tenant}/  # Drizzle Kit SQL output (committed; may be empty until generated)
│
├── plugins/                         # Fastify plugins (cross-cutting)
│   ├── security.ts                  # helmet, cors, rate-limit, @fastify/cookie
│   ├── error-handler.ts             # HttpError → status/code; ZodError → 422; else 500
│   ├── tenant.ts                    # onRequest: subdomain → tenant → req.tenantDb
│   │                                 # + resolves feature-flag whitelist → req.tenantFlags
│   └── auth.ts                      # @fastify/jwt + guard functions (see §6)
│
├── routes/                         # HTTP wiring only (method, path, guard → controller)
│   ├── index.ts                     # registerApiRoutes(app): single call site used by app.ts
│   ├── auth.routes.ts               # /auth/login, /refresh, /logout, /me, /change-password
│   ├── admin.routes.ts              # /admin/tenants + /admin/features (apex only)
│   ├── accounts.routes.ts           # /accounts CRUD — contact view over `people`
│   ├── users.routes.ts              # /users CRUD — login-identity view over `people`
│   └── flags.routes.ts              # /features (tenant's resolved flags)
│
├── controllers/                    # Request-handler logic (parse → service → response)
│   ├── auth.controller.ts           # context-split auth: tenant DB vs global
│   ├── admin.controller.ts          # list/provision/update-status + its request zod schemas
│   ├── accounts.controller.ts       # contacts CRUD over `people`
│   ├── users.controller.ts          # login-identity CRUD over `people`
│   └── flags.controller.ts          # tenant flag reads
│
├── modules/                        # Feature service/business layer (no HTTP wiring)
│   ├── auth/
│   │   ├── service.ts               # GLOBAL auth: platform-admin authenticate/sessions
│   │   ├── tenant-service.ts        # TENANT auth: people-based authenticate/sessions
│   │   ├── tokens.ts                # signAccessToken(app, {sub, role, tenantId})
│   │   └── schema.ts                # zod bodies: loginBody, refreshBody, changePasswordBody,
│   │                                 # provisionOwnerBody (shared with admin controller)
│   ├── tenants/
│   │   └── provision.ts             # provisionTenant(): CREATE DB + migrate + seed owner in `people`
│   ├── users/service.ts            # login-identity mgmt on `people` + `tenant_sessions`
│   └── flags/service.ts            # feature-flag catalog + per-tenant resolution (whitelist)
│
├── lib/                             # Pure helpers (no Fastify deps)
│   ├── crypto.ts                    # Argon2id password hash/verify; token hash; timingSafeEq
│   ├── errors.ts                    # HttpError class + factories (badRequest…internal)
│   ├── logger.ts                    # pino logger (redacts secrets; pino-pretty in dev)
│   ├── roles.ts                     # Role enum; isTenantRole/isPlatformRole; TENANT_ROLES
│   ├── subdomain.ts                 # getSubdomain, isApexHost, subdomainToDbName,
│   │                                 # subdomainToOwnerRole, validation
│   ├── tenant-creds.ts              # deriveTenantOwnerPassword (HMAC-SHA256), isValidTenantOwnerPassword
│   └── is-main.ts                   # cross-platform "am I the entry module?" check
│
└── scripts/                         # CLI entry points (excluded from build)
    ├── seed.ts                      # pnpm seed → bootstrap platform admin
    └── provision-tenant.ts          # pnpm provision:tenant → provision without HTTP
```

### Root config files

| File | Purpose |
|------|---------|
| `package.json` | Scripts: `dev`, `build`, `db:generate:{global,tenant}`, `db:migrate`, `seed`, `provision:tenant` |
| `tsconfig.json` | Base TS config; **path aliases** `@/*`, `@config/*`, `@db/*`, `@modules/*`, `@plugins/*`, `@lib/*` (→ `./src/...`); `verbatimModuleSyntax` + NodeNext |
| `tsconfig.build.json` | Build config; excludes `src/scripts/**` and `drizzle.config.*.ts` |
| `tsconfig.drizzle.json` | Typecheck-only config for drizzle configs |
| `drizzle.config.global.ts` | Drizzle Kit: schema=`src/db/schema/global`, out=`src/db/migrations/global`; uses migrate role |
| `drizzle.config.tenant.ts` | Drizzle Kit: schema=`src/db/schema/tenant`, out=`src/db/migrations/tenant`; uses migrate role |
| `eslint.config.js` | ESLint v9 flat config + typescript-eslint |
| `Dockerfile` | Multi-stage: deps → build → prod-deps → runner (non-root, ships migrations) |
| `docker-compose.yml` | 2× postgres 16 (global + tenant clusters) + 2× backup sidecars + app |
| `docker/postgres-init-global.sh` | Global cluster first-init: roles, grants, REVOKE CREATE, extensions |
| `docker/postgres-init-tenant.sh` | Tenant cluster first-init: roles, grants baked into tenant_template |
| `.env.example` | All env vars documented inline (3-tier per cluster + TENANT_OWNER_MASTER_KEY) |

---

## 4. Data model

### Global DB (`simi_global`) — the control plane

| Table | Key columns | Notes |
|-------|-------------|-------|
| `tenants` | `id`, `name`, `subdomain` (unique), `db_name`, `status` | One row per tenant; `db_name` is the physical PG DB. `status ∈ {active, suspended}`. |
| `users` | `id`, `email` (unique), `password_hash`, `role` | **Platform admins only** (`role = platform_admin`). No `tenant_id` column — tenant users live in `people`. Email lowercased app-side. |
| `sessions` | `id`, `user_id` (FK→users, cascade), `refresh_hash`, `user_agent`, `ip`, `expires_at`, `revoked_at` | Platform-admin refresh tokens. Only the **SHA-256 hash** is stored. |
| `features` | `id`, `key` (unique), `label`, `description`, `default_enabled` | The flag catalog — the **whitelist** of capabilities that may flow to tenants. |
| `tenant_features` | `tenant_id`, `feature_id` (composite PK), `enabled` | Per-tenant overrides: which flags a tenant may use. |

The global DB holds **no tenant user data**. All tenant users and their sessions
live in each tenant's own DB.

### Tenant DB (one per tenant, identical schema) — the tenant's entire world

| Table | Key columns | Notes |
|-------|-------------|-------|
| `people` | `id`, `email` (unique), `first_name`, `last_name`, `phone`, `notes`, `password_hash` (nullable), `role` (nullable), `active`, `must_change_password` | **Unified table** for everyone a tenant knows about. A row is a CONTACT (`password_hash`/`role` NULL — the former `accounts` use case) or a LOGIN IDENTITY (both set — tenant admin/staff). Can log in iff `password_hash IS NOT NULL AND role IS NOT NULL`. |
| `tenant_sessions` | `id`, `person_id` (FK→people, cascade), `refresh_hash`, `user_agent`, `ip`, `expires_at`, `revoked_at` | Tenant refresh tokens. Only the **SHA-256 hash** is stored. |

`/accounts` is a **contact view** over `people` (CRM fields); `/users` is a
**login-identity view** (rows with `password_hash IS NOT NULL`). Both hit the
same table, filtered differently — so a contact can be promoted to a login
identity later without moving rows.

> Tenant tables do **not** exist in the global DB and vice versa. This is enforced
> by the separate schema barrels (`schema/global/index.ts` vs
> `schema/tenant/index.ts`) and the two drizzle configs.

---

## 5. Auth & security model

- **Two auth contexts** — every auth endpoint branches on request context:
  - **Tenant subdomain** (`req.tenant` set): authenticate against `people` +
    `tenant_sessions` in `req.tenantDb` (`modules/auth/tenant-service.ts`).
  - **Apex** (no tenant): authenticate against global `users` + `sessions`
    (`modules/auth/service.ts`) — platform admins only.
- **Access token** — JWT, default **15 min** (`ACCESS_TOKEN_TTL`). Claims:
  `sub` (user/person id), `role`, `tenantId` (`null` for platform admins; the
  resolved tenant id for tenant users), `type: 'access'`.
- **Refresh token** — opaque random string, default **30 d** (`REFRESH_TOKEN_TTL`).
  Only its **SHA-256 hash** is stored (`sessions` for global, `tenant_sessions`
  for tenants). **Rotated on every refresh.** Presented via `rt` HttpOnly cookie
  (path `/auth`), body fallback on `/auth/refresh`.
- **Reuse detection** — presenting an already-revoked token revokes **all** of
  that user's/person's sessions (assumed theft).
- **Passwords** — Argon2id via `@node-rs/argon2` (`lib/crypto.ts`).
- **JWT algorithm** — asymmetric (`EdDSA`/`RS256`) required in production;
  HS256 only in non-production (ephemeral key). `index.ts` refuses to start in
  production without asymmetric keys.
- **Login timing** — `authenticate`/`authenticateTenant` pay the hash cost even
  for unknown users to avoid user-enumeration timing.
- **Logger redaction** — auth headers, cookies, passwords, token fields are
  redacted (`lib/logger.ts`).

### Guards (`plugins/auth.ts`) — the heart of authorization

| Function | Enforces |
|----------|----------|
| `requireAuth(req)` | Any valid access token; sets `req.userClaims`. |
| `requirePlatformAdmin(req)` | `platform_admin` **and** `tenantId === null`; blocks tenant roles. |
| `requireTenantUser(req, {roles})` | Tenant role, role in allow-list, `tenantId !== null`, **and** `claims.tenantId === req.tenant.id` (the core isolation check). Blocks platform staff. |

Routes use the inline `preHandler: async (req) => requireTenantUser(req, {roles})`
form. (The old `tenantRoleGuard`/`tenantAnyRoleGuard` factories were removed —
they caused a request hang; the inline form is functionally identical and works.)

---

## 6. Tenant isolation — how it's actually enforced

Three layers, all required:

1. **Resolution** (`plugins/tenant.ts`) — subdomain → `tenants` row (must be
   `active`) → `req.tenant` + `req.tenantDb`. Unknown/suspended ⇒ 404.
2. **Authorization** (`plugins/auth.ts`) — `requireTenantUser` checks the JWT's
   `tenantId` equals the resolved tenant's id. A tenant-A token cannot reach
   tenant-B's subdomain.
3. **Physical** (`db/tenant-pool.ts`) — `tenantDbFor()` only accepts a `dbName`
   that came from the authenticated tenant lookup; there is no API to open an
   arbitrary tenant DB. Each tenant DB is a separate PostgreSQL database.

`platform_admin` users have `tenantId = NULL` and are rejected by
`requireTenantUser` ("Platform staff cannot access tenant data.").

---

## 7. Tenant provisioning flow (`modules/tenants/provision.ts`)

`provisionTenant({ name, subdomain, ownerEmail, ownerPassword, ... })`:

1. Validate subdomain (`isValidSubdomain`) + reserve (unique check on `tenants.subdomain`).
2. Generate `tenantId = randomUUID()` client-side (needed for HMAC password derivation).
3. **Admin creates DB + owner + app role** (`createTenantDatabaseAndOwner`): connects as
   `TENANT_DB_ADMIN_USER` (cluster superuser), runs `CREATE DATABASE ...
   TEMPLATE tenant_template`, `CREATE ROLE tenant_<sub>_owner PASSWORD <HMAC>`,
   `CREATE ROLE tenant_<sub>_app PASSWORD <HMAC>`,
   `ALTER DATABASE ... OWNER TO`.
4. **Owner sets default privileges** (`configureTenantGrants`): connects AS the
   owner role, bakes `ALTER DEFAULT PRIVILEGES ... GRANT DML TO tenant_<sub>_app`
   so the per-tenant app role gets DML on every table migrations create.
5. **Migrate** (`migrateTenantDb`) — runs all tenant migrations as the owner role.
   On failure → `DROP DATABASE + DROP ROLE` (no orphans).
6. Insert the `tenants` row in the global registry (control plane), then insert
   the `tenant_admin` **owner into the tenant's own `people` table** (connecting
   AS the per-tenant owner role). The owner is a login identity
   (`password_hash` + `role` set) and can immediately authenticate against the
   tenant subdomain.

Cleanup is best-effort: if either insert fails after the DB was created, the
DB + owner role are dropped. Triggered by `POST /admin/tenants` (platform admin)
or `pnpm provision:tenant` (CLI).

`subdomainToDbName()`: `"acme"` → `"tenant_acme"`; `"big-corp"` → `"tenant_big_corp"`.
`subdomainToOwnerRole()`: `"acme"` → `"tenant_acme_owner"`.
`CREATE/DROP DATABASE` are string-interpolated after strict regex guards:
`/^tenant_[a-z0-9_]+$/` (DB names), `/^tenant_[a-z0-9_]+_owner$/` (roles).

---

## 8. Commands

```bash
pnpm install
pnpm dev                     # tsx watch --env-file=.env src/index.ts
pnpm build                   # tsc + tsc-alias → dist/
pnpm start                   # node dist/index.js
pnpm typecheck               # tsc --noEmit
pnpm lint                    # eslint src/**/*.ts
pnpm format                  # prettier

pnpm db:generate:global      # diff src/db/schema/global → migrations/global
pnpm db:generate:tenant      # diff src/db/schema/tenant → migrations/tenant
pnpm db:generate             # both
pnpm db:migrate              # apply global + all active tenant DBs (idempotent)
pnpm seed                    # bootstrap/rotate platform admin from SEED_ADMIN_*
pnpm provision:tenant -- --name "Acme" --subdomain acme --email o@acme.com --password pw
```

Docker: `docker compose up --build`, then `docker compose exec app pnpm db:migrate`
and `pnpm seed`.

---

## 9. Environment variables (see `.env.example` for full list)

**Runtime:**

- `BASE_DOMAIN` — subdomain root (e.g. `simisolutions.localhost`).
- `APEX_IS_ADMIN_HOST` — when true, `BASE_DOMAIN` itself hosts `/admin`.
- `JWT_ALGORITHM` + `JWT_PRIVATE_KEY` + `JWT_PUBLIC_KEY` — asymmetric keys
  required in production; HS256 only for local dev.
- `ACCESS_TOKEN_TTL` / `REFRESH_TOKEN_TTL` — durations like `15m` / `30d`.
- `COOKIE_SECURE` — set true in production (refresh cookie over HTTPS only).

**Global cluster (3-tier role model — see §15):**

| Tier | Vars | Used by |
|------|------|---------|
| App (DML) | `GLOBAL_DB_USER`, `GLOBAL_DB_PASSWORD`, `GLOBAL_DB_HOST`, `GLOBAL_DB_PORT`, `GLOBAL_DB_NAME`, `GLOBAL_DB_POOL_MAX` | Runtime pool `src/db/client.ts` |
| Migrate (DDL) | `GLOBAL_DB_MIGRATE_USER`, `GLOBAL_DB_MIGRATE_PASSWORD` | `db:migrate:global`, `drizzle-kit` |
| Admin (superuser) | `GLOBAL_DB_ADMIN_USER`, `GLOBAL_DB_ADMIN_PASSWORD` | Backups, break-glass |

**Tenant cluster (per-tenant owner + app roles — see §15):**

| Tier | Vars | Used by |
|------|------|---------|
| App (DML, per-tenant) | `TENANT_DB_HOST`, `TENANT_DB_PORT`, `TENANT_DB_TEMPLATE`, `TENANT_DB_NAME`, `TENANT_DB_POOL_MAX`, `TENANT_APP_MASTER_KEY` | Runtime pool `src/db/tenant-pool.ts` |
| Migrate (DDL) | `TENANT_DB_MIGRATE_USER`, `TENANT_DB_MIGRATE_PASSWORD` | `drizzle-kit` introspection on template |
| Admin (superuser) | `TENANT_DB_ADMIN_USER`, `TENANT_DB_ADMIN_PASSWORD` | `CREATE DATABASE` at provisioning |

**Per-tenant credential derivation:**

- `TENANT_OWNER_MASTER_KEY` — HMAC-SHA256 master key (min 32 chars). Used by
  `src/lib/tenant-creds.ts` to derive per-tenant owner passwords from the
  tenant id. See §15 for the security rationale and rotation procedure.
- `TENANT_APP_MASTER_KEY` — Separate HMAC-SHA256 master key (min 32 chars). Used
  to derive per-tenant app role passwords. Separate from the owner key so
  compromise of one tier does not expose the other.

**Other:** `DB_SSL`, `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`.

All validated by zod at boot in `src/config/env.ts`; invalid config exits with a
readable list of issues.

---

## 10. Conventions to follow when editing

- **Imports** use the `.js` extension (ESM + `verbatimModuleSyntax`) and may use
  the `@*` path aliases. Example: `import { globalDb } from '@db/client.js';`
- **Validation** is Zod at the controller boundary; throw the result via
  `.parse()` so the error handler returns 422. Shared auth bodies live in
  `modules/auth/schema.ts`; single-use request schemas are co-located in the
  controller file that uses them (`controllers/*.controller.ts`).
- **Errors** are thrown as `HttpError` instances from `lib/errors.ts` (e.g.
  `notFound(...)`, `unauthorized(...)`); never construct raw HTTP responses for
  error cases.
- **Tenant data** ⇒ `req.tenantDb!` (never `globalDb`).
- **Global data** (auth, users, tenants registry, sessions) ⇒ `globalDb`.
- **Sensitive fields** are redacted in the logger — add new ones to
  `lib/logger.ts` `redact.paths` if you introduce any.
- **Routes vs controllers split:** `src/routes/*.routes.ts` files hold ONLY HTTP
  wiring (method, path, `preHandler` guard, `config.rateLimit`, and a reference
  to a controller method). All parsing/service-calls/response-shaping logic lives
  in `src/controllers/*.controller.ts`, exported as a plain object of `async
  (req, reply) => ...` methods (no `this`). `routes/index.ts` registers every
  group via `registerApiRoutes(app)`, which `app.ts` calls once.
- **New tenant entity** (recipe, also in README):
  1. Add table in `src/db/schema/tenant/<entity>.ts`, re-export from
     `schema/tenant/index.ts` and add to `tenantSchema`.
  2. `pnpm db:generate:tenant` then `pnpm db:migrate`.
  3. Add `src/controllers/<entity>.controller.ts` (handlers using `req.tenantDb`)
     and `src/routes/<entity>.routes.ts` (thin wiring + guards), then register
     the routes file in `src/routes/index.ts`.
- **Fastify plugin** encapsulation: plugins in `src/plugins/` use `fastify-plugin`
  (`fp`) so they aren't scoped; route modules in `src/routes/` are registered
  with `app.register(...)` (via `registerApiRoutes`) and may be encapsulated.

---

## 11. "Where do I look for…?" quick index

| I want to… | Look at |
|-----------|---------|
| Understand the request pipeline / plugin order | `src/app.ts`, then `src/plugins/{tenant,auth}.ts` |
| Understand the routes/controllers split | `src/routes/index.ts` → `src/routes/*.routes.ts` → `src/controllers/*.controller.ts` |
| Add a protected route | `src/routes/accounts.routes.ts` + `src/controllers/accounts.controller.ts` (template) + guards in `src/plugins/auth.ts` |
| Change auth/token logic | `src/modules/auth/{service,tokens}.ts`, `src/lib/crypto.ts` |
| Add/modify a DB table (global) | `src/db/schema/global/*`, then `pnpm db:generate:global` |
| Add/modify a DB table (tenant) | `src/db/schema/tenant/*`, then `pnpm db:generate:tenant` |
| Understand tenant DB pooling | `src/db/tenant-pool.ts` |
| Understand provisioning a new tenant | `src/modules/tenants/provision.ts` |
| Add an env var | `src/config/env.ts` (zod schema) + `.env.example` + `docker-compose.yml` |
| Change error responses | `src/lib/errors.ts` + `src/plugins/error-handler.ts` |
| Tune security headers/CORS/rate-limit | `src/plugins/security.ts` |
| Change logging / redaction | `src/lib/logger.ts` |
| Roles / authorization constants | `src/lib/roles.ts` |
| Subdomain parsing rules | `src/lib/subdomain.ts` |
| Boot / shutdown behavior | `src/index.ts` |
| Docker / DB bootstrap | `Dockerfile`, `docker-compose.yml`, `docker/postgres-init-global.sh`, `docker/postgres-init-tenant.sh` |
| Security architecture (roles, isolation, backups) | §15 (this file) |

---

## 12. Gotchas

- **`noUncheckedIndexedAccess` is on** — array/record lookups are `T | undefined`;
  use non-null assertions (`x!`) or guards where the value is logically present.
- **`verbatimModuleSyntax` is on** — type-only imports must use `import type`.
- **Migrations folder may be empty** until `pnpm db:generate` is run after schema
  edits; `db:migrate` is a no-op-safe no-op if there's nothing to apply.
- **`drizzle.config.tenant.ts` `dbCredentials`** point at the **template** DB for
  drizzle-kit introspection; the programmatic migrator uses per-tenant
  connections at runtime — don't conflate them.
- **HS256 in production** → the app refuses to start (`src/index.ts`). Generate
  Ed25519 keys with the openssl commands in `.env.example`.
- **Provisioning** connects to `TENANT_DB_TEMPLATE` as the maintenance DB to run
  `CREATE/DROP DATABASE` — these can't run in a transaction and aren't
  parameterizable, hence the strict `dbName` regex guard.
- **`scripts/` are excluded from the build** (`tsconfig.build.json`) — they're
  run directly via `tsx --env-file=.env`.

### ESM module gotchas

- **Re-export ≠ local binding.** `export { x } from './x.js'` re-exports `x`
  but does **not** create a local `x` identifier. Referencing `x` afterward
  throws `ReferenceError: x is not defined`. If you need both the re-export and
  a local use (e.g. building an aggregate schema object), add an explicit
  `import { x } from './x.js'` first. This bit `src/db/schema/tenant/index.ts`
  (`tenantSchema = { people, tenantSessions }`).

### Fastify v5 gotchas

- **Pre-built logger instances go in `loggerInstance`, not `logger`.** In v5 the
  `logger` key expects a *config object*; passing an actual pino instance there
  throws `FST_ERR_LOG_INVALID_LOGGER_CONFIG`. See `src/app.ts`
  (`Fastify({ loggerInstance: logger })`).

### Docker / Postgres gotchas

- **Two separate Postgres clusters = two separate named volumes.**
  `pgdata-global` persists the global cluster data; `pgdata-tenant` persists the
  tenant cluster data. Both follow the same rule: Postgres bakes the superuser
  and runs `docker-entrypoint-initdb.d/*` **only on first init of an empty data
  dir**. Changing `POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB` (or the init
  script) after first init has zero effect. Fix: `docker compose down` then
  `docker volume rm backend_pgdata-global backend_pgdata-tenant`, then `up`.
- **The "container Up but nothing serving" trap.** In dev, `tsx watch`'s child
  process exits on `process.exit(1)` (a fatal boot error) and does not always
  revive — the container shows "Up" but port 3000 is dead. Recover with
  `docker compose restart app`. The file changes are bind-mounted, so a restart
  picks them up without a rebuild.
- **Every `psql` call in `docker/postgres-init-*.sh` must pass `--dbname
  "$POSTGRES_DB"`.** Without it, psql connects to a database named after the
  *user*, which doesn't exist when `POSTGRES_DB` is something else. Under
  `set -e` the script aborts with `FATAL: database "<user>" does not exist`,
  leaving extensions uncreated — and because init only runs once, the broken
  state persists until the volume is wiped.
- **Always re-init from a clean volume when iterating on init scripts.**
  Init scripts run only on a fresh data directory, so editing the script and
  `docker compose restart`-ing will **not** re-run it.
- **`migrateTenantDb()` signature changed.** It now takes `{tenantId, subdomain,
  dbName}` (not just `dbName`) because it connects as the per-tenant owner role
  and needs the tenantId to derive the HMAC password. Any caller must supply all
  three fields.

---

## 13. Troubleshooting: common boot errors

| Symptom | Cause | Fix |
|---------|-------|-----|
| `ReferenceError: X is not defined` at a schema barrel line like `export const foo = { X }` | Re-export (`export {X} from`) used without a local binding | Add `import { X } from './X.js'` before the aggregate |
| `FST_ERR_LOG_INVALID_LOGGER_CONFIG` at `src/app.ts` | pino instance passed via `logger` instead of `loggerInstance` | Use `Fastify({ loggerInstance: logger })` |
| `role "simi_global_admin" does not exist` (app ↔ postgres) | Stale volume initialized with a different user | `down` → `docker volume rm backend_pgdata-global backend_pgdata-tenant` → `up` |
| postgres container exits mid-init then comes up "healthy", but extensions missing | `psql` in init script omitted `--dbname`, hit `FATAL: database "<user>" does not exist` under `set -e` | Ensure every `psql` passes `--dbname "$POSTGRES_DB"`; wipe volume and re-init |
| Container "Up" but `curl :3000` → connection refused | `tsx watch` child died after a fatal `process.exit(1)` and didn't revive | `docker compose restart app` |
| `TypeError: Cannot read properties of undefined (reading 'sub')` at `/auth/me` | `requireAuth()` returns void but code tried to use its return value | Use `req.userClaims!` after calling `requireAuth(req)` |
| `TypeError: revokeSession is not defined` at refresh | Pre-existing bug: `revokeSession(row.id)` was called but only `revokeSessionByToken` existed | Inline the update query (fixed) |

---

## 14. Infrastructure deep-dive: how the Postgres setup fits together

The multi-tenant model rests on **physical isolation**: one database per tenant,
never a shared table with a `tenant_id` column, and now **two separate Postgres
clusters** so a compromise of one cannot reach the other. This section explains
every moving part.

### 14.1 Two separate clusters

```
┌─── Global Cluster ──────────────────────┐    ┌─── Tenant Cluster ──────────────────────────┐
│  postgres-global :5432                  │    │  postgres-tenant :5433                      │
│                                          │    │                                             │
│   ┌──────────────┐                       │    │   ┌──────────────────┐                      │
│   │  simi_global │  (1 DB)              │    │   │ tenant_template   │ (template, copy)    │
│   │  users,      │                      │    │   │ extensions baked  │                      │
│   │  sessions,   │                      │    │   └──────────────────┘                      │
│   │  tenants     │                      │    │                                             │
│   └──────────────┘                       │    │   ┌────────────┐ ┌────────────┐  ...       │
│                                          │    │   │tenant_acme │ │tenant_foo │  (one per   │
│   Roles:                                 │    │   │owned by     │ │owned by    │   tenant,   │
│   simi_global_admin  (superuser)        │    │   │tenant_acme_  │ │tenant_foo_ │   each with │
│   simi_global_migrate (DDL)             │    │   │owner        │ │owner      │   its own   │
│   simi_global_app     (DML)             │    │   └────────────┘ └────────────┘   owner role)│
└──────────────────────────────────────────┘    │                                             │
                                               │   Roles (template + per-tenant):              │
                                               │   simi_tenant_admin    (cluster superuser)   │
                                               │   simi_tenant_migrate  (DDL on template)    │
│   + backup-global sidecar (pg_dump @daily)   │   tenant_<sub>_app     (DML, per-tenant)   │
│                                              │   tenant_<sub>_owner   (DDL, per-tenant)   │
│                                              └─────────────────────────────────────────────┘
│   + backup-tenant sidecar (pg_dumpall @daily)                                          │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

**Blast-radius containment:** a leaked superuser credential on the global cluster
cannot reach any tenant DB (they're on a different cluster). A leaked superuser
on the tenant cluster cannot reach the global DB. A leaked per-tenant owner
credential can destroy exactly **one** tenant DB.

### 14.2 Role model

**Global cluster** — three fixed privilege tiers:

| Tier | What it can do | Who uses it |
|------|---------------|-------------|
| **app** | `SELECT, INSERT, UPDATE, DELETE` on tables. Cannot `CREATE TABLE`, cannot install extensions, cannot `CREATE ROLE`. | Runtime pool `client.ts`. The default-privilege grants from the migrate role auto-provide DML. |
| **migrate** | Owns the `public` schema; `GRANT CREATE ON SCHEMA public`. Can `CREATE/ALTER/DROP TABLE` and run DDL. | `db:migrate`, `drizzle-kit` (generate + introspect). |
| **admin** | Cluster superuser. Break-glass only. **Never used by the app at runtime.** | Backups. |

**Tenant cluster** — three fixed tiers + two dynamic per-tenant tiers (created at
provisioning time):

| Tier | What it can do | Who uses it |
|------|---------------|-------------|
| **app** (per-tenant `tenant_<sub>_app`) | `SELECT, INSERT, UPDATE, DELETE` on tables in **one** tenant DB only. Cannot DDL, cannot install extensions, cannot access any other tenant DB. | Runtime pool `tenant-pool.ts`. Password = HMAC-SHA256(`TENANT_APP_MASTER_KEY`, tenantId). |
| **migrate** | Owns the `public` schema on the template; DDL for drizzle-kit introspection. | `drizzle-kit` (generate + introspect on `tenant_template`). |
| **admin** | Cluster superuser. `CREATE DATABASE`, `CREATE ROLE`, `pg_terminate_backend`, break-glass. **Never used by the app at runtime.** | `provision.ts` (`CREATE DATABASE`, `CREATE ROLE`), `dropTenantDatabaseAndOwner` (`DROP DATABASE`, `DROP ROLE`). |
| **owner** (per-tenant `tenant_<sub>_owner`) | Owns one specific tenant DB. Has full DDL inside that DB only. Cannot access any other tenant DB or the global cluster. | `migrateTenantDb`, `configureTenantGrants`. Password = HMAC-SHA256(`TENANT_OWNER_MASTER_KEY`, tenantId). |

### 14.3 REVOKE CREATE ON SCHEMA public FROM PUBLIC

Both init scripts run this hardening command. Without it, any role with `USAGE`
on `public` (including the app role) could install `dblink` or `postgres_fdw`
and use them to connect to other databases on the **same** cluster — a lateral-
move attack vector if SQL injection occurred. The `REVOKE` closes this:

```
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
```

The migrate role (and the per-tenant owner role) still have explicit
`GRANT CREATE ON SCHEMA public`, so this does not affect migrations.

### 14.4 Per-tenant grants at provisioning time

The tenant template (`tenant_template`) no longer bakes app-role grants — per-tenant
app roles don't exist at template-build time. Instead, `configureTenantGrants()` in
`provision.ts` sets all per-tenant grants at provisioning time (after the owner and
app roles are created):

```
GRANT USAGE ON SCHEMA public TO tenant_<sub>_app;
ALTER DEFAULT PRIVILEGES FOR ROLE tenant_<sub>_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO tenant_<sub>_app;
ALTER DEFAULT PRIVILEGES FOR ROLE tenant_<sub>_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO tenant_<sub>_app;
-- Back-fill for re-provision safety:
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO tenant_<sub>_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO tenant_<sub>_app;
```

The result: every table the owner creates via migrations auto-grants DML to that
tenant's app role — scoped to exactly one tenant DB.

### 14.5 Docker services (`docker-compose.yml`)

| Service | Image | Purpose |
|---------|-------|---------|
| `postgres-global` | `postgres:16-bookworm` | Global cluster. `POSTGRES_DB=simi_global`. Init script creates app + migrate roles. |
| `postgres-tenant` | `postgres:16-bookworm` | Tenant cluster. `POSTGRES_DB=tenant_template`. Init script bakes roles + grants into template. |
| `backup-global` | `prodrigestivill/postgres-backup:16` | `pg_dump simi_global` daily. Keeps 90 backups, prunes after 30 days. |
| `backup-tenant` | `prodrigestivill/postgres-backup:16` | `pg_dumpall` daily (all tenant DBs). Keeps 90, prunes after 30 days. |
| `app` | Build from `Dockerfile` | API. Depends on both postgres services `service_healthy`. |

Volumes: `pgdata-global`, `pgdata-tenant`, `backups-global`, `backups-tenant`.

### 14.6 Connection plumbing (app layer)

```
GLOBAL_DB_HOST=postgres-global         ─┐
GLOBAL_DB_PORT=5432                     ├──→ pg.Pool (max 10) ──→ Drizzle ──→ simi_global
GLOBAL_DB_USER=simi_global_app           │     (one shared instance: globalDb)
GLOBAL_DB_NAME=simi_global              ┘

TENANT_DB_HOST=postgres-tenant         ─┐
TENANT_DB_PORT=5432                     ├──→ one pg.Pool PER tenant DB (LRU, max 50 cached)
TENANT_APP_MASTER_KEY                   │     tenantDbFor(tenantId, dbName, subdomain)
  + tenantId + subdomain                 │     user/password = HMAC-derived per-tenant
TENANT_DB_POOL_MAX=10                   ┘
```

The two clusters are on **different hosts** (`postgres-global` vs
`postgres-tenant`), providing physical network-level separation even in dev.

### 14.7 How a request flows through all this

```
1. curl http://acme.simisolutions.localhost:3000/accounts
        │
2. tenant plugin (onRequest) — the ONLY global-DB access in a tenant request:
   - getSubdomain("acme.simisolutions.localhost") → "acme"
   - SELECT * FROM tenants WHERE subdomain='acme' AND status='active'
        (via globalDb → simi_global on postgres-global)  ← control-plane lookup
   - resolve feature flags: getTenantFlags(tenant.id)     ← the whitelist bridge
        (via globalDb → features + tenant_features)
   - tenantDbFor(tenant.id, "tenant_acme") → req.tenantDb
        │
3. auth guard (requireTenantUser):
   - verify JWT → claims.tenantId must === tenant.id
        │
4. handler: SELECT * FROM people
        (via req.tenantDb → tenant_acme DB on postgres-tenant)
```

The tenant hook touches the global cluster (control-plane lookup + flag
whitelist), but the handler only ever touches the tenant cluster. A SQL
injection in one cluster physically cannot reach the other.

### 14.8 Provisioning a new tenant

1. Validate subdomain, generate `tenantId` client-side.
2. Admin (superuser on tenant cluster): `CREATE DATABASE ... TEMPLATE tenant_template`.
3. Admin: `CREATE ROLE tenant_<sub>_owner PASSWORD <HMAC-derived from TENANT_OWNER_MASTER_KEY>`.
4. Admin: `CREATE ROLE tenant_<sub>_app PASSWORD <HMAC-derived from TENANT_APP_MASTER_KEY>`.
5. Admin: `ALTER DATABASE ... OWNER TO tenant_<sub>_owner`.
6. Admin: `ALTER SCHEMA public OWNER TO tenant_<sub>_owner` (inside the new DB).
7. Owner: `ALTER DEFAULT PRIVILEGES ... GRANT DML TO tenant_<sub>_app`.
8. Owner: `migrateTenantDb({tenantId, subdomain, dbName})` — applies all tenant
   migrations as the owner role. On failure → superuser drops DB + roles.
9. Insert `tenants` row in the global registry, then insert the `tenant_admin`
   owner into the tenant's own `staff` table (connecting AS the owner role).

### 14.9 Migrations

```
Phase 1: migrations/global/*.sql   → simi_global         (connects as GLOBAL_DB_MIGRATE_USER)
Phase 2: for each active tenant:
             migrations/tenant/*.sql → tenant_<subdomain> (connects as tenant_<sub>_owner)
```

`drizzle.config.tenant.ts` points at `tenant_template` for introspection only.
The runtime migrator builds its own per-tenant connections using owner-role
credentials.

### 14.10 Full dependency map

```
docker-compose.yml
  │
  ├── service: postgres-global
  │     ├── POSTGRES_USER = GLOBAL_DB_ADMIN_USER (superuser)
  │     ├── POSTGRES_DB = simi_global
  │     ├── volume pgdata-global
  │     ├── mount postgres-init-global.sh (runs once → creates app/migrate roles)
  │     └── healthcheck → gates app startup
  │
  ├── service: postgres-tenant
  │     ├── POSTGRES_USER = TENANT_DB_ADMIN_USER (superuser)
  │     ├── POSTGRES_DB = tenant_template
  │     ├── volume pgdata-tenant
  │     ├── mount postgres-init-tenant.sh (runs once → bakes roles into template)
  │     └── healthcheck → gates app startup
  │
  ├── service: backup-global
  │     ├── POSTGRES_HOST=postgres-global, POSTGRES_USER=GLOBAL_DB_ADMIN_USER
  │     ├── SCHEDULE=@daily, BACKUP_KEEP_DAYS=30
  │     └── volume backups-global
  │
  ├── service: backup-tenant
  │     ├── POSTGRES_HOST=postgres-tenant, POSTGRES_CLUSTER=true
  │     ├── SCHEDULE=@daily, BACKUP_KEEP_DAYS=30
  │     └── volume backups-tenant
  │
  ├── service: app
  │     ├── depends_on: postgres-global + postgres-tenant (service_healthy)
  │     ├── env GLOBAL_DB_*  ──→ src/db/client.ts     ──→ globalDb (simi_global)
  │     ├── env TENANT_DB_*  ──→ src/db/tenant-pool.ts──→ per-tenant pools
  │     ├── env TENANT_DB_ADMIN_* ──→ provision.ts  ──→ CREATE DATABASE
  │     └── mount ./src  ──→ tsx watch hot reload
  │
  └── env file .env

src/config/env.ts               validates ALL env vars (zod) → typed `env`
src/lib/tenant-creds.ts          deriveTenantOwnerPassword(tenantId) → HMAC-SHA256 hex
                                 deriveTenantAppPassword(tenantId) → HMAC-SHA256 hex
src/lib/subdomain.ts             subdomainToOwnerRole(subdomain) → "tenant_<sub>_owner"
                                 subdomainToAppRole(subdomain) → "tenant_<sub>_app"
src/db/client.ts                globalDb = drizzle(globalPool, user=GLOBAL_DB_USER)
src/db/tenant-pool.ts           tenantDbFor(id, dbName, subdomain) = drizzle(tenantPool, user=HMAC-derived)
src/db/migrate.ts               migrateGlobal → GLOBAL_DB_MIGRATE_USER; migrateOneTenant → owner role
src/db/schema/global/           tables that live ONLY in simi_global
src/db/schema/tenant/           tables that live ONLY in each tenant_<sub>
src/modules/tenants/provision.ts   admin→CREATE DATABASE + CREATE ROLE (owner + app); owner→default privs; owner→migrate
docker/postgres-init-global.sh   creates app/migrate roles + REVOKE CREATE + extensions
docker/postgres-init-tenant.sh   creates migrate role + REVOKE CREATE into tenant_template
src/scripts/migrate-to-per-tenant-app-roles.ts  one-time migration from shared simi_tenant_app to per-tenant app roles
```

---

## 15. Security architecture & disaster recovery

This section documents the defense-in-depth strategy for medical-grade data
protection. See also §6 (application-layer isolation) and §14 (infrastructure).

### 15.1 Blast-radius containment

| Leaked credential | Impact | Scope |
|-------------------|--------|-------|
| `GLOBAL_DB_USER/PASSWORD` (app role) | Read/write DML in `simi_global` (platform-admin users/sessions, tenants registry, flag catalog). Cannot create tables, cannot reach any tenant DB. | One cluster, DML only |
| `GLOBAL_DB_MIGRATE_USER/PASSWORD` | DDL on `simi_global` — can drop tables, alter schema. Cannot reach any tenant DB. | One cluster, DDL |
| `GLOBAL_DB_ADMIN_USER/PASSWORD` | Full superuser on global cluster. Can destroy `simi_global`. Cannot reach any tenant DB. | One cluster, all |
| `tenant_<sub>_app` password | Read/write DML inside **one** tenant DB. Cannot create tables, cannot access any other tenant DB or global data. | **One tenant only, DML** |
| `TENANT_DB_ADMIN_USER/PASSWORD` | Full superuser on tenant cluster. Can destroy ALL tenant DBs. Cannot reach global. | One cluster, all |
| `tenant_<sub>_owner` password | Full power (DDL + data) inside ONE tenant DB. Cannot reach any other tenant DB or any global data. | **One tenant only, DDL+DML** |
| `TENANT_APP_MASTER_KEY` | Can derive app-role passwords for **all** tenants if tenant IDs are also known (from global DB). | All tenant DBs (DML) |
| `TENANT_OWNER_MASTER_KEY` | Can derive owner-role passwords for **all** tenants if tenant IDs are also known (from global DB). | All tenant DBs (DDL+DML) |

**Key insight:** both per-tenant roles (owner and app) limit the blast radius of
the most common credential leak scenarios. A leaked per-tenant app or owner
credential compromises exactly **one** tenant. Even the tenant cluster superuser
cannot reach the global cluster. The two master keys are defense-in-depth: each
alone is useless without tenant IDs (stored on a separate cluster).

### 15.2 HMAC-derived per-tenant passwords

Each tenant DB gets two dedicated roles whose passwords are derived
deterministically via HMAC-SHA256:

| Role | Naming | Password derivation |
|------|--------|---------------------|
| **Owner** (DDL) | `tenant_<subdomain>_owner` | `HMAC-SHA256(TENANT_OWNER_MASTER_KEY, tenantId)` |
| **App** (DML) | `tenant_<subdomain>_app` | `HMAC-SHA256(TENANT_APP_MASTER_KEY, tenantId)` |

Implementation: `src/lib/tenant-creds.ts`.

**Why HMAC instead of random-and-stored:**
- No password table to leak and no secrets manager required.
- Any code path can recompute the password for a tenant on the fly.
- **Defense in depth:** a master key alone is useless without tenant ids
  (which live in `simi_global`); tenant ids alone (from a global dump) are
  useless without the master key. Two secrets, two physical locations (two
  clusters). The two master keys are independent: compromise of one tier does
  not expose the other.

**Rotation procedure (for either key):**
1. Change the master key (`TENANT_OWNER_MASTER_KEY` or `TENANT_APP_MASTER_KEY`) in `.env`.
2. Run an `ALTER ROLE` loop over every tenant:
   ```
   SELECT id, subdomain FROM tenants WHERE status = 'active';
   -- for each (owner key):
   --   ALTER ROLE tenant_<sub>_owner PASSWORD '<new-HMAC>';
   -- for each (app key):
   --   ALTER ROLE tenant_<sub>_app PASSWORD '<new-HMAC>';
   ```
3. Restart the app.

### 15.3 Backup strategy

| Target | Method | Schedule | Retention | Location |
|--------|--------|----------|-----------|----------|
| `simi_global` | `pg_dump` | `@daily` | 30 days / 90 files | `backups-global` volume |
| All tenant DBs | `pg_dumpall` | `@daily` | 30 days / 90 files | `backups-tenant` volume |

Backup sidecars: `prodrigestivill/postgres-backup:16`, configured in
`docker-compose.yml`. They connect as the admin (superuser) role. Backup files
are gzip-compressed (`-Z6`).

**PITR (Point-in-Time Recovery):** the backup sidecars do NOT enable WAL
archiving or continuous WAL shipping. For true PITR capability:
1. Add `wal_level=replica` and `archive_mode=on` to both Postgres configs.
2. Mount a WAL archive volume and set `archive_command` to copy WAL files there.
3. Use `pg_restore` on a specific backup + replay WAL to the target timestamp.
4. For the tenant cluster, consider `pgBackRest` or `barman` for managing PITR
   across many databases.

### 15.4 The full isolation stack (defense in depth)

```
Layer 1 — Network:   Two physical clusters. Global ↔ tenant traffic is impossible.
Layer 2 — Role:      3-tier roles per cluster. REVOKE CREATE FROM PUBLIC.
                     Per-tenant owner roles. Least privilege everywhere.
Layer 3 — App:       Subdomain → tenant lookup (plugins/tenant.ts).
                     JWT tenantId check (plugins/auth.ts).
                     No API to open an arbitrary tenant DB (tenant-pool.ts).
Layer 4 — Schema:    Separate schema barrels (global vs tenant).
                     No cross-schema foreign keys possible (different DBs).
Layer 5 — Backup:    Separate backup volumes. Leaked global backup has no tenant data.
```

### 15.5 Negative test matrix (verify after any infra change)

Run these as the app role (`simi_global_app` / `tenant_<sub>_app`) to confirm
isolation. Every one should FAIL:

| # | Test | Expected result |
|---|------|----------------|
| 1 | `CREATE TABLE test(id int)` on any DB as app role | `ERROR: permission denied for schema public` |
| 2 | `CREATE EXTENSION dblink` as app role | `ERROR: permission denied to create extension` (or `CREATE` denied) |
| 3 | Connect to `simi_global` as `tenant_acme_app` | `FATAL: password authentication failed` (different cluster, different role) |
| 4 | Connect to `tenant_acme` as `simi_global_app` | `FATAL: password authentication failed` |
| 5 | Connect to `tenant_foo` as `tenant_acme_app` | `FATAL: password authentication failed` (app role is per-tenant) |
| 6 | Connect to `tenant_foo` as `tenant_acme_owner` | `FATAL: password authentication failed` (owner is per-tenant) |
| 7 | `DROP DATABASE tenant_acme` as `tenant_acme_owner` | `FATAL: must be owner of the database` (or needs `pg_terminate_backend` on other sessions) |
| 7 | `SELECT * FROM pg_authid` as app role | Returns only `pg_authid` entries visible to the role (not superuser passwords) |

