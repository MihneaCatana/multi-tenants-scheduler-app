# Simi

Multi-tenant SaaS platform for SMB management — appointments, CRM, and scheduling.

## Architecture

Two isolated services sharing a single domain via subdomain-based multi-tenancy:

```
                  ┌─────────────────────┐
                  │  Reverse Proxy      │
                  │  (Caddy / nginx)    │
                  └─────────┬───────────┘
                   TLS + Host routing
              ┌─────────────┼─────────────┐
              ▼             ▼              ▼
     *.domain.com     *.domain.com   *.domain.com
     (static SPA)    (/v1/* API)    (/v1/* API)
     ┌──────────┐   ┌────────────┐
     │ Frontend │   │  Backend   │
     │ React 18 │──▶│  Fastify 5 │
     │ + Vite   │   │  + EdDSA   │
     └──────────┘   └─────┬──────┘
                          │
                   ┌──────┴──────┐
                   ▼             ▼
            ┌───────────┐ ┌───────────────┐
            │  global   │ │    tenant_*   │
            │  Postgres │ │    Postgres   │
            └───────────┘ └───────────────┘
            (users,       (one DB per
             tenants)      tenant —
                          physical isolation)
```

- **Backend** ([backend/](backend/)) — Fastify 5, TypeScript, two PostgreSQL clusters (global + per-tenant), HMAC-derived per-tenant credentials, EdDSA JWT.
- **Frontend** ([frontend/](frontend/)) — React 18, PrimeReact, TanStack Query, Vite.

## Quick start

### Prerequisites

- **Node.js ≥ 20** (`.nvmrc` pins v22) and **pnpm 9.12**
- **Docker** (for the databases)

### 1. Backend

```bash
cd backend
pnpm install
cp .env.example .env     # edit as needed
docker compose up -d      # starts both Postgres clusters
pnpm setup                # seeds platform admin + demo tenant
pnpm dev                  # http://localhost:3000
```

### 2. Frontend

```bash
cd frontend
pnpm install
cp .env.example .env      # edit as needed
pnpm dev                  # http://simisolutions.localhost:5173
```

See the [backend README](backend/README.md) and [frontend README](frontend/README.md) for full details.

## Key design decisions

| Concern | Decision |
| --- | --- |
| Multi-tenancy | Subdomain-based, one PostgreSQL database per tenant (physical isolation) |
| Auth | EdDSA JWT in production, access token in memory only, refresh via HttpOnly cookie |
| Tenant DB credentials | HMAC-derived from a master key (no stored passwords) |
| Anti-enumeration | 404 on unknown subdomains, no tenant listing endpoint |
| Backups | GPG-encrypted `pg_dump` per cluster, rotating daily files |
| Deployment | Docker Compose on a single VPS, nginx serves the SPA |

## Documentation

| Doc | Description |
| --- | --- |
| [Deployment guide](docs/deployment.md) | Step-by-step production setup |
| [Backups & restore](docs/backups.md) | Backup config, restore procedures, PITR |
| [Database access](docs/database-access.md) | Connection models, role hierarchy |
| [Infrastructure](docs/infrastructure.md) | Docker services, resource limits |
| [Multi-tenancy](docs/multi-tenancy.md) | Tenant isolation model, provisioning flow |
| [Modules](docs/modules.md) | Scheduling, state machine, data model |

## Scripts at a glance

| | Backend | Frontend |
| --- | --- | --- |
| Dev | `pnpm dev` | `pnpm dev` |
| Build | `pnpm build` | `pnpm build` |
| Typecheck | `pnpm typecheck` | `pnpm typecheck` |
| Lint | `pnpm lint` | `pnpm lint` |
| Format | `pnpm format` | `pnpm format` |
| Test | `pnpm test` | `pnpm test` |

## License

Proprietary — see [LICENSE](LICENSE).
