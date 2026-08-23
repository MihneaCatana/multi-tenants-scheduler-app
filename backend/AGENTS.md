# Backend Rules for AI Agents

This file binds any AI agent (or human contributor) working in `backend/`.
Follow it strictly. When in doubt, ask before acting.

> Companion docs: `CODEBASE.md` (architecture), `docs/commands.md` (cheat sheet),
> `docs/multi-tenancy.md` (tenant isolation).

---

## 1. Database Migrations — THE MOST IMPORTANT SECTION

The migration system was broken once by hand-authoring SQL and editing the
journal. The fallout (orphaned `__drizzle_migrations`, fabricated timestamps,
skipped migrations) took a full DB wipe to fix. Don't repeat it.

### ✅ ALWAYS

- **Generate migrations with `pnpm db:generate`** (runs `drizzle-kit generate`).
  It diffs the current schema against the latest snapshot, writes a new
  `<idx>_<name>.sql`, a matching `<idx>_snapshot.json`, and appends a correctly
  timestamped entry to `meta/_journal.json`.
- **Review the generated SQL before committing.** drizzle-kit is usually right
  but can produce surprising DDL (e.g. a column rename modeled as drop+add).
  Read it.
- **Apply migrations with `pnpm db:migrate`** (`src/db/migrate.ts`). It runs as
  the DDL-capable **migrate role** (global) and each tenant's **owner role**
  (per-tenant), never the app role.
- **Workflow after a schema change:**
  1. Edit files under `src/db/schema/` (global or tenant).
  2. `pnpm db:generate:global` and/or `pnpm db:generate:tenant`.
  3. Read the new SQL file.
  4. `pnpm db:migrate` to apply.
  5. Verify with the tracker query in §3.

### ❌ NEVER

- **NEVER hand-author migration SQL files.** If a migration needs hand-written
  SQL (e.g. a data backfill), discuss the approach first. The migration lineage
  must stay consistent with the snapshots.
- **NEVER edit `meta/_journal.json` or `*_snapshot.json` manually.** These are
  drizzle-kit's bookkeeping. Manual edits desync the tracker from the journal
  and silently break `db:migrate`.
- **NEVER fabricate `when` timestamps.** They MUST be monotonically increasing.
  Drizzle orders migrations by this value; a backdated entry is treated as
  already-applied and silently skipped.
- **NEVER run `drizzle-kit push`** (no `db:push` script exists — for a reason).
  `push` applies DDL directly to the DB, bypassing the migration journal and the
  `__drizzle_migrations` tracker. The schema ends up "correct" but the tracker
  lies, so the next `db:migrate` either re-runs DDL (errors) or skips it (lies).
- **NEVER hack the `__drizzle_migrations` table** to "mark something as applied."
  If the tracker is wrong, the migration lineage is wrong — regenerate from
  scratch (see below).

### If migrations get corrupted

Do NOT patch the tracker. Do NOT add `IF NOT EXISTS` everywhere as a band-aid.
The correct recovery (dev only) is:

1. `docker compose down -v` — wipe the DB volumes.
2. Delete everything under `src/db/migrations/<cluster>/` (SQL + `meta/`).
3. Recreate empty `meta/_journal.json` files:
   ```json
   { "version": "7", "dialect": "postgresql", "entries": [] }
   ```
4. `pnpm db:generate:global && pnpm db:generate:tenant` — one fresh migration
   per cluster, from the current schema, with correct snapshots + journal.
5. `docker compose up -d postgres-global postgres-tenant app`
6. `docker compose exec app pnpm db:migrate && pnpm seed && pnpm provision:tenant ...`

In **production**, never wipe — restore from backup and fix forward with a
correctly generated migration. See `docs/backups.md`.

### Why `db:generate` must run on the host, not in the container

The dev `app` container runs as non-root user `app` (UID 1001) and can't write
to the bind-mounted source tree where migration files live. Run
`pnpm db:generate:*` on the **host** (where you have write access), then commit
the new files. `pnpm db:migrate` runs fine inside the container because it only
reads the migration folder.

---

## 2. Database Access Model

Two physically separate PostgreSQL clusters (blast-radius containment):

| Cluster | Purpose | DBs |
|---------|---------|-----|
| `postgres-global` | control plane | `simi_global` (single) |
| `postgres-tenant` | tenant data | `tenant_<sub>` per tenant, from `tenant_template` |

### 3-tier role model (per cluster)

- **admin** — superuser. Used ONLY for `CREATE DATABASE`/`CREATE ROLE` at
  provisioning and break-glass. Never for app queries or migrations.
- **migrate** — owns `public` schema, has `CREATE`. Used ONLY by `db:migrate` and
  `drizzle-kit` introspection. Never for app queries.
- **app** — DML only (`SELECT/INSERT/UPDATE/DELETE`). The runtime role.

Per-tenant, the model is: `tenant_<sub>_owner` (DDL on that one DB) +
`tenant_<sub>_app` (DML on that one DB). Passwords are HMAC-derived from the
tenant id (see `src/lib/tenant-creds.ts`) — never stored.

**Rule:** never run migrations as the app role, never run app queries as the
migrate/admin role. The migrator enforces this; don't work around it.

### The cluster superuser — a high-value secret, by design

The `*_ADMIN_*` roles (`simi_global_admin`, `simi_tenant_admin`) are Postgres
**superusers** (`Bypass RLS`, `CREATEDB`, `CREATEROLE`). They exist because two
operations genuinely need elevated privileges:

- **Provisioning** — `CREATE DATABASE tenant_<sub> TEMPLATE tenant_template`,
  `CREATE ROLE`, `ALTER ... OWNER TO`. These can't be parameterized and require
  a privileged role.
- **The backup sidecar** — runs `pg_dumpall` across all tenant DBs in one pass,
  which requires reading databases the runner doesn't own.

**Consequence:** if `TENANT_DB_ADMIN_PASSWORD` leaks, all tenant data in that
cluster is exposed. This is the accepted tradeoff of the
"database-per-tenant in a shared cluster" model. What you get in return:

- Per-tenant `tenant_<sub>_app` (DML) and `tenant_<sub>_owner` (DDL) roles are
  correctly scoped — a compromised app credential reaches exactly one tenant
  DB and nothing else. There is **no query path** in the app that crosses
  tenants.
- The tenant cluster and global cluster are physically separate containers
  with separate volumes — a tenant-cluster breach does not reach auth,
  sessions, or the tenant registry.
- Backup encryption (`BACKUP_ENCRYPT_PASSPHRASE`) protects data at rest.

**Treat the admin credentials accordingly:**
- Store in a secrets manager / vault, not in plaintext beyond `.env` (which
  is `.gitignore`d and `.dockerignore`d).
- Rotate on a schedule and on staff turnover.
- Never hand them to tenant code, demo seeds, or the app container's runtime
  (the app only gets the `*_APP_*` and `*_MIGRATE_*` credentials).
- In production, prefer a managed Postgres with IAM/SCIM auth if available.

If a tenant tier ever needs physical isolation (regulated data, enterprise
contracts), the path is a dedicated cluster per tenant — not a role change.

### `__drizzle_migrations` is the source of truth

Drizzle creates a `drizzle.__drizzle_migrations` table in every target DB and
records which journal entries have run (keyed by content hash). If "what the DB
has" and "what the tracker says" disagree, trust the DB schema and regenerate
the migration lineage — don't edit the tracker.

---

## 3. Verifying migration state

To check what's actually applied, connect with the DDL-capable role (the app
role has no access to the `drizzle` schema):

```bash
# Global DB
docker compose exec postgres-global \
  psql -U simi_global_migrate -d simi_global \
  -c "SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id;"

# Tenant DB (replace acme with the subdomain)
docker compose exec postgres-tenant \
  psql -U tenant_acme_owner -d tenant_acme \
  -c "SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id;"
```

The number of rows should equal the number of journal entries in
`meta/_journal.json` for that cluster.

---

## 4. Dev vs Prod — Same Workflow, Different `.env`

Dev and prod use the **same** `docker-compose.yml` (production-shaped base).
A `docker-compose.override.yml` is auto-merged in dev to enable hot-reload.

| | Dev | Prod |
|---|---|---|
| Bring up | `docker compose up` (auto-loads override) | `docker compose -f docker-compose.yml up -d` |
| App image | `dev` target (tsx watch, source mounted) | `runner` target (compiled, prod deps) |
| `.env` | `NODE_ENV=development`, `JWT_ALGORITHM=HS256`, `COOKIE_SECURE=false`, `DB_SSL=false`, placeholder secrets OK | `NODE_ENV=production`, `JWT_ALGORITHM=EdDSA` (required), real keys, `COOKIE_SECURE=true`, `DB_SSL=true`, `TRUST_PROXY` set |

**Rule:** the only thing that differs between dev and prod is `.env`. Same
compose base, same Dockerfile, same image. Do not add environment-specific
files (`docker-compose.dev.yml`, `Dockerfile.dev`) — the override pattern is
the convention.

---

## 5. Seeding

- `pnpm seed` — idempotent platform-admin bootstrap (global DB, direct write).
  Safe to re-run; rotates the password to match `SEED_ADMIN_*`.
- `pnpm provision:tenant -- --name ... --subdomain ... --email ... --password ...`
  — creates a tenant DB + owner. Idempotent (409 on duplicate subdomain).
- `pnpm seed:demo:<scenario>` — demo data via the **HTTP API** against a running
  backend. Requires an existing tenant + owner. Idempotent.

Demo seeds talk to the running server, not the DB directly. Keep it that way —
it validates the full request path.

---

## 6. Code Conventions

- **ESM throughout** (`type: module`). Use `import`/`export`, not `require`.
  Schema imports use explicit `.js` extensions (TS-node/tsx ESM resolution).
- **Zod** validates every external boundary (env at boot, every request body).
  Never `JSON.parse(req.body)` without a schema.
- **Feature-module layout** under `src/modules/<domain>/` (`schema.ts`,
  `service.ts`, controller glue in `src/controllers/`). Don't scatter domain
  logic across controllers.
- **Soft deletes** via `deletedAt` timestamp on tenant tables. Filter with
  `isNull(...deletedAt)` in every list query.
- **Tenant isolation:** `req.tenantDb` comes from authenticated tenant lookup.
  Never accept a `dbName` or `tenantId` from user input.

---

## 7. When you're unsure

- Migration question → re-read §1. The rules are strict for a reason.
- "Can I just edit the SQL/journal/tracker?" → No. §1.
- Architecture question → `CODEBASE.md`.
- "How do I run X?" → `docs/commands.md`.
- Still unsure → ask the human before acting. Destructive DB operations are
  never auto-approve-able.
