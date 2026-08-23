# Commands Cheat Sheet

Quick reference for managing the Simi backend. All `pnpm` commands run from
`backend/`. Commands that touch the DB run inside Docker via `docker compose`.

> See `AGENTS.md` for migration rules and `README.md` for full setup details.

---

## First-time setup / full reset

```bash
pnpm setup
```

One command does everything (idempotent — safe to re-run):
copies `.env.example` → `.env`, starts the Docker stack, waits for healthy DBs,
applies migrations, seeds the platform admin, provisions the Acme sample tenant.

---

## Daily development

```bash
docker compose up          # start everything (hot-reload via tsx watch)
docker compose up -d       # ...detached
docker compose down        # stop containers, keep data
docker compose logs -f app # tail app logs
```

Dev auto-loads `docker-compose.override.yml` (source mounts + tsx watch).
No special flags needed — just `docker compose up`.

---

## Database

### Generate a migration after schema changes

Run on the **host** (not in the container) — the container can't write to the
bind-mounted source:

```bash
pnpm db:generate           # both global + tenant
pnpm db:generate:global    # just the global schema
pnpm db:generate:tenant    # just the tenant schema
```

Then **read the generated SQL**, then apply it.

### Apply migrations

```bash
docker compose exec app pnpm db:migrate
```

Runs as the migrate role (global) + each tenant's owner role. Safe to re-run.

### Seed data

```bash
docker compose exec app pnpm seed                                  # platform admin
docker compose exec app pnpm provision:tenant -- \
  --name "My Tenant" --subdomain mytenant \
  --email owner@mytenant.com --password strongpassword             # new tenant
docker compose exec app pnpm seed:demo:clinic                      # demo data (clinic)
docker compose exec app pnpm seed:demo:salon                       # demo data (salon)
docker compose exec app pnpm seed:demo:logistics                   # demo data (logistics)
```

All idempotent. Demo seeds hit the running server over HTTP.

---

## Inspect the database

### Check applied migrations (the source of truth)

```bash
# Global DB
docker compose exec postgres-global \
  psql -U simi_global_migrate -d simi_global \
  -c "SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id;"

# Tenant DB (replace <subdomain>)
docker compose exec postgres-tenant \
  psql -U tenant_<subdomain>_owner -d tenant_<subdomain> \
  -c "SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id;"
```

Row count must match `meta/_journal.json` entries for that cluster.

### psql into a DB

```bash
docker compose exec postgres-global psql -U simi_global_migrate -d simi_global
docker compose exec postgres-tenant psql -U tenant_acme_owner -d tenant_acme
```

---

## Reset everything (dev only — destructive)

```bash
docker compose down -v   # stops containers AND deletes all DB volumes
```

Then re-run `pnpm setup` (or the manual steps above) to rebuild from scratch.

---

## Production deploy

Production uses the base compose file only (no override):

```bash
docker compose -f docker-compose.yml up -d --build
```

Then apply migrations and seed:

```bash
docker compose -f docker-compose.yml exec app pnpm db:migrate
docker compose -f docker-compose.yml exec app pnpm seed
```

`.env` must be production-shaped: `NODE_ENV=production`, `JWT_ALGORITHM=EdDSA`
with real `JWT_PRIVATE_KEY`/`JWT_PUBLIC_KEY`, `COOKIE_SECURE=true`, `DB_SSL=true`,
`TRUST_PROXY` set to the proxy, real secrets everywhere.

---

## Code quality

```bash
pnpm typecheck   # tsc --noEmit
pnpm lint        # eslint
pnpm test        # vitest (watch)
pnpm test:run    # vitest (single run)
pnpm test:coverage
pnpm audit       # pnpm audit --audit-level=moderate
```

---

## Secrets

```bash
pnpm generate-secrets   # generate JWT keys, HMAC master keys, cookie secret
```

Outputs values to paste into `.env`. Run once per environment.

---

## Quick troubleshooting

| Symptom | Check |
|---------|-------|
| `db:generate` says "No schema changes" | The journal already has the latest snapshot — your schema edit wasn't saved, or you already generated it. |
| `db:migrate` says "up to date" but DB is wrong | The `__drizzle_migrations` tracker is out of sync. See `AGENTS.md` §1 "If migrations get corrupted." |
| App can't connect to DB | `docker compose ps` — are `postgres-*` healthy? Init scripts may still be running. |
| Permission denied writing migration files | You're running `db:generate` inside the container. Run it on the host. |
| New tenant can't log in | Did you run `provision:tenant`? The owner account is created there, not in `seed`. |
