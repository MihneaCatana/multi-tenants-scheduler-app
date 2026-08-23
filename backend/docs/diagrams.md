# Simi Backend — Architecture Diagrams

> Mermaid diagrams describing the backend API and infrastructure.
> Render in VS Code (preview), GitHub, or any Mermaid-compatible viewer.

---

## Table of Contents

1. [System Architecture Overview](#1-system-architecture-overview)
2. [Request Lifecycle](#2-request-lifecycle)
3. [Data Model (ER Diagram)](#3-data-model-er-diagram)
4. [Authentication & Token Flow](#4-authentication--token-flow)
5. [Tenant Isolation Stack](#5-tenant-isolation-stack)
6. [Tenant Provisioning Flow](#6-tenant-provisioning-flow)
7. [Docker / Infrastructure Topology](#7-docker--infrastructure-topology)

---

## 1. System Architecture Overview

High-level view of the two-cluster multi-tenant architecture. Each tenant gets its own
physical PostgreSQL database on a separate cluster from the global database, providing
blast-radius containment.

```mermaid
flowchart TB
    subgraph Client["Client Layer"]
        Browser["Web Browser"]
    end

    subgraph App["Fastify Application :3000"]
        direction TB
        Security["Security Plugins\n(helmet, cors, rate-limit, cookie)"]
        TenantPlugin["Tenant Plugin\n(subdomain → tenant DB)"]
        AuthPlugin["Auth Plugin\n(JWT verification + guards)"]
        Routes["Route Handlers\n(globalDb / req.tenantDb)"]
        Security --> TenantPlugin --> AuthPlugin --> Routes
    end

    subgraph GlobalCluster["Global Cluster — postgres-global :5432"]
        direction TB
        GlobalDB[("simi_global\n─────\nusers\nsessions\ntenants")]
        subgraph GlobalRoles["Roles"]
            GApp["simi_global_app\n(DML)"]
            GMigrate["simi_global_migrate\n(DDL)"]
            GAdmin["simi_global_admin\n(superuser)"]
        end
        GlobalDB --- GlobalRoles
    end

    subgraph TenantCluster["Tenant Cluster — postgres-tenant :5432"]
        direction TB
        subgraph TenantDatabases["Tenant Databases (one per tenant)"]
            AcmeDB[("tenant_acme\n─────\naccounts")]
            FooDB[("tenant_foo\n─────\naccounts")]
            MoreDB[("tenant_*\n─────\n…")]
        end
        subgraph TenantRoles["Roles"]
            TApp["tenant_<sub>_app\n(DML — per-tenant)"]
            TMigrate["simi_tenant_migrate\n(DDL — shared)"]
            TAdmin["simi_tenant_admin\n(superuser — shared)"]
            TOwner["tenant_<sub>_owner\n(per-tenant DDL)"]
        end
        TenantDatabases --- TenantRoles
    end

    subgraph Backups["Backup Sidecars"]
        BackupGlobal["backup-global\npg_dump @daily\n30-day retention"]
        BackupTenant["backup-tenant\npg_dumpall @daily\n30-day retention"]
    end

    Browser -->|HTTP / HTTPS| App

    Routes -->|DML queries| GApp
    Routes -->|DML queries| TApp

    BackupGlobal -.->|pg_dump| GAdmin
    BackupTenant -.->|pg_dumpall| TAdmin

    style GlobalCluster fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    style TenantCluster fill:#e3f2fd,stroke:#1565c0,stroke-width:2px
    style App fill:#fff3e0,stroke:#ef6c00,stroke-width:2px
    style Backups fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px
```

---

## 2. Request Lifecycle

Every HTTP request flows through the same middleware pipeline. The tenant plugin
determines which database the request operates against, and the auth guards enforce
authorization before the handler executes.

```mermaid
flowchart TD
    Req["Incoming HTTP Request"]

    subgraph Middleware["Middleware Pipeline"]
        direction TB
        Step1["Security Plugins\n(helmet, cors, rate-limit, cookie)"]
        Step2["Error Handler\n(sets error handler)"]
        Step3["Auth Plugin\n(registers JWT, decorates verifyAccessToken)"]
        Step4["Tenant Plugin (onRequest)\nsubdomain → tenants row → req.tenantDb"]
        Step5["Route preHandler\n(guard: requireAuth /\nrequirePlatformAdmin /\nrequireTenantUser)"]
        Step6["Route Handler\n(uses globalDb or req.tenantDb)"]
    end

    Res["HTTP Response"]

    Req --> Step1 --> Step2 --> Step3 --> Step4 --> Step5 --> Step6 --> Res

    Step4 --> BypassHealth{"/health or\n/admin prefix?"}
    BypassHealth -->|Yes| SkipTenant["Skip tenant\nresolution"]
    BypassHealth -->|No| ResolveSubdomain["Extract subdomain\nfrom Host header"]
    ResolveSubdomain --> IsApex{"Apex host\n(BASE_DOMAIN)?"}
    IsApex -->|Yes| AdminContext["No tenant attached\n(admin/host context)"]
    IsApex -->|No| LookupTenant["Lookup subdomain in\nglobal tenants table"]
    LookupTenant --> Active{status = 'active'?}
    Active -->|Yes| SetTenantDb["Set req.tenant + req.tenantDb\n(Drizzle instance)"]
    Active -->|No| Err404["404 Not Found"]
    AdminContext --> Step5
    SetTenantDb --> Step5
    SkipTenant --> Step5

    style Middleware fill:#fff3e0,stroke:#ef6c00,stroke-width:2px
    style Err404 fill:#ffebee,stroke:#c62828,stroke-width:2px
```

---

## 3. Data Model (ER Diagram)

The schema is split across two physically separate databases. The **global DB** holds
authentication, users, and the tenant registry. Each **tenant DB** holds the tenant's
business data (currently `accounts` as a sample entity).

```mermaid
erDiagram
    %% ── Global Database: simi_global ──────────────────────────────

    tenants {
        uuid id PK
        varchar120 name "NOT NULL"
        varchar63 subdomain "NOT NULL, UNIQUE"
        varchar128 dbName "NOT NULL"
        varchar20 status "NOT NULL, default 'active'"
        timestamptz createdAt "NOT NULL"
        timestamptz updatedAt "NOT NULL"
    }

    users {
        uuid id PK
        varchar254 email "NOT NULL, UNIQUE"
        text passwordHash "NOT NULL"
        varchar30 role "NOT NULL"
        uuid tenantId "FK → tenants.id, nullable, CASCADE"
        varchar80 firstName "nullable"
        varchar80 lastName "nullable"
        timestamptz createdAt "NOT NULL"
        timestamptz updatedAt "NOT NULL"
    }

    sessions {
        uuid id PK
        uuid userId "FK → users.id, CASCADE"
        text refreshHash "NOT NULL"
        text userAgent "nullable"
        text ip "nullable"
        timestamptz expiresAt "NOT NULL"
        timestamptz revokedAt "nullable"
        timestamptz createdAt "NOT NULL"
    }

    %% ── Tenant Database (one per tenant) ──────────────────────────

    accounts {
        uuid id PK
        varchar160 name "NOT NULL"
        varchar254 email "nullable"
        varchar40 phone "nullable"
        text notes "nullable"
        timestamptz createdAt "NOT NULL"
        timestamptz updatedAt "NOT NULL"
    }

    %% ── Relationships ────────────────────────────────────────────

    tenants ||--o{ users : "has members\n(users.tenantId → tenants.id)"
    users ||--o{ sessions : "has sessions\n(sessions.userId → users.id)"

    %% ── Indexes & Constraints (annotations) ────────────────────────

    tenants {
        Index: tenants_subdomain_idx "UNIQUE ON subdomain"
    }

    users {
        Index: users_email_idx "UNIQUE ON email"
        Index: users_tenant_idx "ON tenantId"
        Index: users_role_idx "ON role"
    }

    sessions {
        Index: sessions_refresh_hash_idx "ON refreshHash"
        Index: sessions_user_idx "ON userId"
        Index: sessions_refresh_hash_active_uniq "UNIQUE partial\nWHERE revoked_at IS NULL"
    }
```

---

## 4. Authentication & Token Flow

The auth system uses **short-lived JWT access tokens** (15 min) and **opaque refresh
tokens** (30 days) stored as HttpOnly cookies. Token rotation on every refresh includes
reuse detection — if an already-revoked token is presented, all sessions for that user
are revoked (theft detection).

```mermaid
sequenceDiagram
    participant C as Client (Browser)
    participant A as Fastify App
    participant G as Global DB (simi_global)

    %% ── Login ────────────────────────────────────────────────────
    rect rgb(227, 242, 253)
        Note over C,G: POST /auth/login
        C->>A: email + password
        A->>G: SELECT * FROM users WHERE email = ?
        G-->>A: user row (incl. passwordHash)
        A->>A: Argon2id.verify(password, passwordHash)
        alt credentials valid
            A->>A: Generate 32-byte refresh token (opaque)
            A->>A: SHA-256 hash of refresh token
            A->>G: INSERT INTO sessions (userId, refreshHash, expiresAt, …)
            A->>A: Sign JWT access token (sub, role, tenantId, type=access)
            A-->>C: { accessToken, user } + Set-Cookie: rt=<refresh_token>; HttpOnly; SameSite=strict
        else credentials invalid
            A-->>C: 401 Unauthorized
        end
    end

    %% ── Token Refresh ────────────────────────────────────────────
    rect rgb(232, 245, 233)
        Note over C,G: POST /auth/refresh
        C->>A: Cookie: rt=<refresh_token> (or body)
        A->>A: SHA-256 hash of refresh token
        A->>G: SELECT * FROM sessions WHERE refreshHash = ? AND revokedAt IS NULL
        G-->>A: session row (or null)
        alt session found and active
            A->>G: UPDATE sessions SET revokedAt = now() WHERE id = ? AND revokedAt IS NULL
            A->>A: Generate NEW refresh token + hash
            A->>G: INSERT INTO sessions (userId, refreshHash, expiresAt, …)
            A->>A: Sign NEW JWT access token
            A-->>C: { accessToken, user } + Set-Cookie: rt=<new_refresh_token>
        else session NOT found (hash miss)
            A-->>C: 401 Unauthorized
        else session found but revoked (reuse detection!)
            Note over A,G: ⚠ Token reuse detected — assumed theft
            A->>G: UPDATE sessions SET revokedAt = now() WHERE userId = ? AND revokedAt IS NULL
            A-->>C: 401 Unauthorized (ALL sessions revoked)
        end
    end

    %% ── Logout ───────────────────────────────────────────────────
    rect rgb(252, 228, 236)
        Note over C,G: POST /auth/logout
        C->>A: Cookie: rt=<refresh_token>
        A->>A: SHA-256 hash of refresh token
        A->>G: UPDATE sessions SET revokedAt = now() WHERE refreshHash = ?
        A-->>C: 204 No Content + Clear Cookie
    end

    %% ── Authenticated Request ────────────────────────────────────
    rect rgb(255, 243, 224)
        Note over C,G: GET /accounts (or any protected route)
        C->>A: Authorization: Bearer <access_token>
        A->>A: Verify JWT signature + claims
        A->>A: Check guard (requireAuth / requireTenantUser / requirePlatformAdmin)
        A->>A: Execute handler using globalDb or req.tenantDb
        A-->>C: 200 OK + data
    end
```

---

## 5. Tenant Isolation Stack

Five layers of defense-in-depth ensure tenant data cannot leak across boundaries.
All five layers are required; no single layer is considered sufficient on its own.

```mermaid
flowchart LR
    subgraph L1["Layer 1 — Network"]
        N1["Two physical PostgreSQL clusters"]
        N2["Global cluster ↔ tenant cluster\ntraffic is impossible"]
    end

    subgraph L2["Layer 2 — Role"]
        R1["3-tier roles per cluster\n(admin / migrate / app)"]
        R2["Per-tenant owner roles\n(tenant_<sub>_owner)"]
        R3["REVOKE CREATE ON SCHEMA public\nFROM PUBLIC"]
    end

    subgraph L3["Layer 3 — Application"]
        A1["Subdomain → tenant lookup\n(plugins/tenant.ts)"]
        A2["JWT tenantId == resolved tenant.id\n(plugins/auth.ts)"]
        A3["No API to open arbitrary tenant DB\n(db/tenant-pool.ts)"]
    end

    subgraph L4["Layer 4 — Schema"]
        S1["Separate schema barrels\n(global vs tenant)"]
        S2["No cross-schema foreign keys\n(different physical DBs)"]
    end

    subgraph L5["Layer 5 — Backup"]
        B1["Separate backup volumes"]
        B2["Global backup has no tenant data\nTenant backup has no global data"]
    end

    L1 --> L2 --> L3 --> L4 --> L5

    style L1 fill:#e3f2fd,stroke:#1565c0,stroke-width:2px
    style L2 fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    style L3 fill:#fff3e0,stroke:#ef6c00,stroke-width:2px
    style L4 fill:#fce4ec,stroke:#c62828,stroke-width:2px
    style L5 fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px
```

### How isolation is enforced at each layer

| Layer | Mechanism | What it prevents |
|-------|-----------|-----------------|
| **1 — Network** | Two separate PostgreSQL clusters | A leaked superuser on one cluster cannot reach the other |
| **2 — Role** | 3-tier roles + per-tenant owners + `REVOKE CREATE` | DML-only app roles cannot install `dblink`/`postgres_fdw` for lateral moves |
| **3 — Application** | Subdomain resolution + JWT tenantId check | A valid token for tenant A cannot be used on tenant B's subdomain |
| **4 — Schema** | Separate schema barrels, no cross-DB foreign keys | Code-level guarantee that global and tenant queries never mix |
| **5 — Backup** | Separate backup volumes per cluster | Leaked global backup exposes no tenant data and vice versa |

---

## 6. Tenant Provisioning Flow

Provisioning a new tenant is a multi-step process that spans both clusters. The
sequence diagram below shows the happy path. On failure at any step after the database
is created, cleanup drops the database and owner role to prevent orphans.

```mermaid
sequenceDiagram
    participant Admin as Platform Admin
    participant App as Fastify App
    participant GDB as Global DB<br/>(simi_global)
    participant TAdmin as Tenant Cluster<br/>(superuser)
    participant TOwner as Tenant Owner<br/>(tenant_<sub>_owner)
    participant TDB as New Tenant DB<br/>(tenant_<sub>)

    rect rgb(232, 245, 233)
        Note over Admin,TDB: Step 1 — Validate & Reserve Subdomain
        Admin->>App: POST /admin/tenants<br/>{ name, subdomain, ownerEmail, ownerPassword }
        App->>App: isValidSubdomain(subdomain)
        App->>GDB: SELECT id FROM tenants WHERE subdomain = ?
        GDB-->>App: null (available)
        App->>App: Generate tenantId = randomUUID()
    end

    rect rgb(227, 242, 253)
        Note over Admin,TDB: Step 2 — Create Database & Owner Role
        App->>App: deriveTenantOwnerPassword(tenantId)<br/>HMAC-SHA256(MASTER_KEY, tenantId)
        App->>TAdmin: CREATE DATABASE tenant_<sub><br/>TEMPLATE tenant_template
        App->>TAdmin: CREATE ROLE tenant_<sub>_owner<br/>PASSWORD <HMAC-derived>
        App->>TAdmin: ALTER DATABASE tenant_<sub><br/>OWNER TO tenant_<sub>_owner
    end

    rect rgb(255, 243, 224)
        Note over Admin,TDB: Step 3 — Configure Default Privileges
        App->>TOwner: ALTER DEFAULT PRIVILEGES<br/>FOR ROLE tenant_<sub>_owner<br/>GRANT SELECT, INSERT, UPDATE, DELETE<br/>ON TABLES TO tenant_<sub>_app
    end

    rect rgb(243, 229, 245)
        Note over Admin,TDB: Step 4 — Run Tenant Migrations
        App->>TOwner: Apply migrations/tenant/*.sql<br/>to tenant_<sub>
        Note right of TDB: On failure → cleanup:<br/>DROP DATABASE + DROP ROLE
    end

    rect rgb(255, 235, 238)
        Note over Admin,TDB: Step 5 — Insert Tenant & Owner User (transactional)
        App->>GDB: BEGIN TRANSACTION
        App->>App: Argon2id.hash(ownerPassword)
        App->>GDB: INSERT INTO tenants<br/>(id, name, subdomain, dbName, status)
        App->>GDB: INSERT INTO users<br/>(id, email, passwordHash, role=tenant_admin, tenantId)
        App->>GDB: COMMIT
        Note right of GDB: On failure → cleanup:<br/>DROP DATABASE + DROP ROLE
    end

    App-->>Admin: 201 Created { tenant, owner }
```

---

## 7. Docker / Infrastructure Topology

The `docker-compose.yml` defines five services across two PostgreSQL clusters. The app
waits for both database clusters to be healthy before starting.

```mermaid
flowchart TB
    subgraph Network["Docker Network"]
        direction TB

        subgraph GlobalServices["Global Cluster"]
            direction TB
            PG["postgres-global\npostgres:16-bookworm\n:5432"]
            BGlobal["backup-global\npostgres-backup:16\npg_dump @daily\n30-day retention"]
        end

        subgraph TenantServices["Tenant Cluster"]
            direction TB
            PT["postgres-tenant\npostgres:16-bookworm\n:5432 → mapped :5433"]
            BTenant["backup-tenant\npostgres-backup:16\npg_dumpall @daily\n30-day retention"]
        end

        subgraph AppServices["Application"]
            direction TB
            Fastify["app\nnode:20-bookworm-slim\n:3000\nmulti-stage build"]
        end
    end

    subgraph Volumes["Docker Volumes"]
        VGlobal["pgdata-global\n(global cluster data)"]
        VTenant["pgdata-tenant\n(tenant cluster data)"]
        VBGlobal["backups-global\n(global pg_dump files)"]
        VBTenant["backups-tenant\n(tenant pg_dumpall files)"]
    end

    subgraph InitScripts["Init Scripts (first run only)"]
        InitGlobal["docker/postgres-init-global.sh\nCreates app + migrate roles\nREVOKE CREATE FROM PUBLIC\nInstalls pgcrypto, citext, uuid-ossp"]
        InitTenant["docker/postgres-init-tenant.sh\nBakes roles into tenant_template\nREVOKE CREATE FROM PUBLIC\nInstalls pgcrypto, citext, uuid-ossp"]
    end

    PG ---|mounts| VGlobal
    PT ---|mounts| VTenant
    BGlobal ---|mounts| VBGlobal
    BTenant ---|mounts| VBTenant

    InitGlobal -.->|mounted into| PG
    InitTenant -.->|mounted into| PT

    Fastify -->|depends_on: healthy| PG
    Fastify -->|depends_on: healthy| PT
    BGlobal -.->|POSTGRES_HOST=| PG
    BTenant -.->|POSTGRES_HOST=| PT

    Fastify -->|bind-mount src/| Src["./src\n(hot reload via tsx watch)"]
    Fastify -->|env-file| Env[".env"]

    style GlobalServices fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    style TenantServices fill:#e3f2fd,stroke:#1565c0,stroke-width:2px
    style AppServices fill:#fff3e0,stroke:#ef6c00,stroke-width:2px
    style Volumes fill:#f5f5f5,stroke:#616161,stroke-width:1px
    style InitScripts fill:#fafafa,stroke:#9e9e9e,stroke-width:1px,stroke-dasharray:5 5
```

### Service details

| Service | Image | Port | Health Check | Volume |
|---------|-------|------|-------------|--------|
| `postgres-global` | `postgres:16-bookworm` | 5432 | `pg_isready` | `pgdata-global` |
| `postgres-tenant` | `postgres:16-bookworm` | 5432 → 5433 | `pg_isready` | `pgdata-tenant` |
| `backup-global` | `postgres-backup:16` | — | `@daily` schedule | `backups-global` |
| `backup-tenant` | `postgres-backup:16` | — | `@daily` schedule | `backups-tenant` |
| `app` | Multi-stage Dockerfile | 3000 | `GET /health` (30s) | — |

### 3-tier role model per cluster

```
┌─────────────────────────────────────────────────────────────┐
│  Tier           │  Can DDL?  │  Can DML?  │  Used by        │
├─────────────────┼────────────┼────────────┼─────────────────┤
│  admin          │  Yes       │  Yes       │  Backups,       │
│  (superuser)    │            │            │  provisioning,  │
│                 │            │            │  break-glass     │
├─────────────────┼────────────┼────────────┼─────────────────┤
│  migrate        │  Yes       │  No        │  db:migrate,    │
│  (DDL only)     │            │            │  drizzle-kit    │
├─────────────────┼────────────┼────────────┼─────────────────┤
│  app            │  No        │  Yes       │  Runtime pools  │
│  (DML only)     │            │            │  (Fastify)      │
├─────────────────┼────────────┼────────────┼─────────────────┤
│  owner*         │  Yes*      │  Yes*      │  Per-tenant     │
│  (per-tenant)   │            │            │  migrations     │
└─────────────────────────────────────────────────────────────┘
* Tenant cluster only. Each tenant gets its own owner role
  with HMAC-SHA256 derived password.
```

---

## API Endpoints Reference

| Method | Path | Auth Guard | Rate Limit | Description |
|--------|------|-----------|------------|-------------|
| `GET` | `/health` | None | None | Health check (public) |
| `POST` | `/auth/register` | `requireTenantAdmin` | 5/min | Register a new user under a tenant |
| `POST` | `/auth/login` | None | 10/min | Authenticate and receive tokens |
| `POST` | `/auth/refresh` | None (cookie) | 20/min | Rotate refresh token, get new access token |
| `POST` | `/auth/logout` | None (cookie) | None | Revoke refresh token session |
| `GET` | `/auth/me` | `requireAuth` | None | Get current authenticated user |
| `GET` | `/admin/tenants` | `requirePlatformAdmin` | None | List all tenants (apex host only) |
| `POST` | `/admin/tenants` | `requirePlatformAdmin` | None | Provision a new tenant |
| `PATCH` | `/admin/tenants/:id/status` | `requirePlatformAdmin` | None | Update tenant status (active/suspended) |
| `GET` | `/accounts` | `requireTenantUser` | None | List accounts (tenant-scoped) |
| `GET` | `/accounts/:id` | `requireTenantUser` | None | Get single account |
| `POST` | `/accounts` | `requireTenantAdmin` | None | Create account |
| `PATCH` | `/accounts/:id` | `requireTenantAdmin` | None | Update account |
| `DELETE` | `/accounts/:id` | `requireTenantAdmin` | None | Delete account |
