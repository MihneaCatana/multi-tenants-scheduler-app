# Application Modules

How the Simi platform's code is organized — backend layers, modules, frontend features,
and how they communicate.

> **Related docs:** [Infrastructure](./infrastructure.md) ·
> [Multi-Tenancy](./multi-tenancy.md) ·
> [Backups](./backups.md) ·
> [Database Access](./database-access.md)

---

## Backend Architecture

The backend follows a **layered architecture** with clear separation of concerns:

```
Request
  │
  ▼
┌─────────────────────────────────────────┐
│ Plugins (src/plugins/)                   │  ─ Infrastructure hooks
│  security · auth · tenant · error       │     (run on every request)
├─────────────────────────────────────────┤
│ Routes (src/routes/)                     │  ─ HTTP wiring
│  URL mapping + preHandler guards         │     (thin, declarative)
├─────────────────────────────────────────┤
│ Controllers (src/controllers/)           │  ─ Request handlers
│  Parse input, call services, respond     │     (HTTP ↔ domain bridge)
├─────────────────────────────────────────┤
│ Modules (src/modules/)                   │  ─ Business logic
│  Domain services + validation            │     (framework-agnostic)
├─────────────────────────────────────────┤
│ DB Layer (src/db/)                       │  ─ Data access
│  Drizzle ORM + pg.Pool                  │     (typed queries)
└─────────────────────────────────────────┘
```

### Directory Structure

```
backend/src/
├── app.ts                  # App bootstrap — registers plugins in order
├── config/                 # Zod-validated environment configuration
├── plugins/                # Fastify plugins (auth, tenant, security, errors)
├── routes/                 # Thin HTTP route wiring with auth guards
├── controllers/            # Request handlers (input parsing, response shaping)
├── modules/                # Domain business logic per feature
│   ├── admin/              # Tenant provisioning (calls tenants module)
│   ├── auth/               # Authentication (global + tenant)
│   ├── tenants/            # DB provisioning logic
│   ├── staff/              # Tenant staff CRUD
│   ├── availability/       # Working hours + time-off
│   ├── flags/              # Feature flag resolution
│   ├── resources/           # Bookable resource management
│   ├── services-catalog/   # Service definitions
│   └── scheduling/         # Appointment engine + state machine
├── db/
│   ├── client.ts           # Global DB pool + Drizzle instance
│   ├── tenant-pool.ts      # Per-tenant DB pool manager (LRU cache)
│   ├── migrate.ts          # Migration runner
│   └── schema/             # Drizzle table definitions
│       ├── global/         # Global DB tables (tenants, users, sessions, features)
│       └── tenant/         # Per-tenant DB tables (staff, clients, appointments, etc.)
├── lib/                    # Shared utilities (crypto, errors, logger, roles, flags)
└── scripts/                # Seed + provisioning CLI scripts
```

---

## Plugin System (App Bootstrap)

The application is composed using Fastify's plugin system. The registration order in
[`app.ts`](../backend/src/app.ts) matters — plugins that others depend on must be
registered first:

```
1. securityPlugins       → Helmet, CORS, rate-limit, cookies
2. syncFlagCatalog        → Mirror code-defined flags into DB (on boot)
3. startLogRetentionJob   → Periodic log file cleanup
4. errorHandler           → Centralized ZodError + HttpError handling
5. authPlugin             → JWT registration, verifyAccessToken, route guards
6. tenantPlugin           → Subdomain → tenant resolution, req.tenantDb
7. registerApiRoutes      → All feature route groups under /v1
```

### Cross-Cutting State via Fastify Decorators

Plugins extend `FastifyRequest` via TypeScript declaration merging:

| Decorator | Set By | Type | Purpose |
|-----------|--------|------|---------|
| `req.userClaims` | Auth plugin | JWT payload | Authenticated user's ID, role, tenantId |
| `req.tenant` | Tenant plugin | `Tenant` row | Resolved tenant identity |
| `req.tenantDb` | Tenant plugin | `TenantDb` (Drizzle) | Tenant-scoped database handle |
| `req.tenantFlags` | Tenant plugin | `{ [key]: boolean }` | Resolved feature flags for this tenant |
| `app.verifyAccessToken` | Auth plugin | Function | JWT verification method |

---

## Backend Modules

### Auth Module (`src/modules/auth/`)

Handles authentication for **both** platform admins (global DB) and tenant users (tenant DB).

| File | Purpose |
|------|---------|
| `service.ts` | Global auth: login, refresh, logout for platform admins |
| `tenant-service.ts` | Tenant auth: login, refresh, logout for tenant users |
| `tokens.ts` | JWT signing/verification logic |
| `schema.ts` | Zod validation for auth input/output |

**Key behaviors:**
- JWT access tokens (15 min lifetime, signed with EdDSA or HS256).
- Opaque refresh tokens (30 day lifetime) stored as SHA-256 hashes in the database.
- Refresh token rotation with **reuse detection** — presenting a revoked token
  revokes all sessions for that user (theft detection).
- Passwords hashed with Argon2id.
- Refresh tokens sent as HttpOnly, SameSite=Strict cookies.

### Tenants Module (`src/modules/tenants/`)

Handles tenant database provisioning. See [Multi-Tenancy](./multi-tenancy.md) for the
full provisioning flow.

| File | Purpose |
|------|---------|
| `provision.ts` | End-to-end tenant provisioning (validate → create DB → roles → migrate → seed) |

### Staff Module (`src/modules/staff/`)

Tenant employee management. CRUD on the `staff` table.

| Capability | Description |
|-----------|-------------|
| Create staff | Insert new staff member with email, password, role |
| Update staff | Change name, role |
| Reset password | Generate temp password, revoke all sessions for that staff member |
| Activate/deactivate | Toggle `active` flag; inactive staff cannot authenticate |
| Soft delete | Mark as deleted (never hard-delete staff) |

Only `tenant_admin` role can manage staff.

### Flags Module (`src/modules/flags/`)

Feature flag resolution. Reads from the global `features` + `tenant_features` tables.

- **Catalog** is defined in code ([`src/lib/flag-catalog.ts`](../backend/src/lib/flag-catalog.ts))
  and synced to the DB at boot.
- **Resolution:** If a tenant has an override in `tenant_features`, use it; otherwise
  use the catalog default.
- **Caching:** Resolved flags are cached per tenant with a configurable TTL (default
  15 seconds).
- **Graceful degradation:** If the global DB is temporarily unreachable, flags
  default to off rather than blocking requests.

### Resources Module (`src/modules/resources/`)

Bookable resource management (rooms, equipment, staff-as-provider).

| Capability | Description |
|-----------|-------------|
| Create resource | Define a new bookable resource with a type (`provider`, `room`, `equipment`, etc.) |
| Update resource | Change name, description, metadata |
| Soft delete | Blocked if the resource has active appointments |

Provider-type resources can be linked to a staff member.

### Services Catalog Module (`src/modules/services-catalog/`)

Service definitions with duration, buffers, and resource requirements.

| Capability | Description |
|-----------|-------------|
| Create service | Define a service (e.g., "Haircut", 30 min) |
| Set requirements | Specify which resource types and quantities a service needs |
| Delete service | Blocked if referenced by any appointment |

### Availability Module (`src/modules/availability/`)

Manages working hours and time-off per resource, plus tenant timezone settings.

| Capability | Description |
|-----------|-------------|
| Working hours | Set recurring weekly schedules per resource |
| Time-off | Create one-off or recurring time-off entries |
| Timezone | Set tenant timezone (used for scheduling calculations) |

### Scheduling Module (`src/modules/scheduling/`)

The core appointments engine. Creates and manages appointments with conflict detection.

| Capability | Description |
|-----------|-------------|
| Create appointment | Book with conflict detection (GiST `tstzrange` overlap index) |
| Reschedule | Change date/time with re-validation |
| Status transitions | State machine-driven status changes |
| History | Full audit trail of status transitions |

Uses a **single `PATCH` endpoint** with discriminated union actions.

---

## Appointment State Machine

Defined in [`src/modules/scheduling/state-machine.ts`](../backend/src/modules/scheduling/state-machine.ts):

```
  requested ──────▶ confirmed ──────▶ checked_in ──────▶ in_progress ──────▶ completed
       │               │  │               │  │
       │               │  │               │  │
       ▼               ▼  ▼               ▼  ▼
    cancelled      cancelled         cancelled
                    no_show            no_show
```

### Transition Table

| From | Action | To |
|------|--------|----|
| `requested` | `confirm` | `confirmed` |
| `requested` | `cancel` | `cancelled` |
| `confirmed` | `check_in` | `checked_in` |
| `confirmed` | `start` | `in_progress` |
| `confirmed` | `cancel` | `cancelled` |
| `confirmed` | `no_show` | `no_show` |
| `confirmed` | `reschedule` | `confirmed` (updates time) |
| `checked_in` | `start` | `in_progress` |
| `checked_in` | `cancel` | `cancelled` |
| `checked_in` | `no_show` | `no_show` |
| `in_progress` | `complete` | `completed` |

Terminal statuses (`completed`, `cancelled`, `no_show`) have **no outgoing transitions**.

---

## Feature Flags

The platform uses a code-defined feature flag catalog that controls which capabilities
each tenant has access to.

### Available Flags

| Flag Key | Label | Default | Gated Routes |
|----------|-------|---------|-------------|
| `reservations` | Table Reservations | OFF | (future) |
| `inventory` | Inventory | OFF | (future) |
| `pos` | Point of Sale | OFF | (future) |
| `appointments` | Appointments | OFF | `/v1/resources`, `/v1/services`, `/v1/appointments`, availability routes |

### How Gating Works

1. The `requireAppointments()` guard (a composable preHandler) checks both
   tenant authentication **and** the `appointments` feature flag.
2. When the flag is **off** for a tenant, gated routes return **404** — the feature
   appears not to exist, rather than returning 403.
3. Platform admins can override flags per-tenant via `PUT /v1/admin/tenants/:id/flags`.

### Catalog Sync

At boot, [`syncFlagCatalog()`](../backend/src/lib/flag-catalog.ts) mirrors the
code-defined catalog into the `features` table:
- **Insert** new flags added to the code.
- **Update** drifted label/description/default values.
- **Delete** flags removed from code (cascades to remove tenant overrides).

---

## API Route Map

All routes are registered under `/v1` in
[`src/routes/index.ts`](../backend/src/routes/index.ts).

### Auth Routes (`/v1/auth`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/v1/auth/login` | None | Login (branches: global vs tenant based on host) |
| POST | `/v1/auth/refresh` | None | Refresh access token (dual-path) |
| POST | `/v1/auth/logout` | Auth required | Revoke refresh token |
| GET | `/v1/auth/me` | Auth required | Get current user profile |
| POST | `/v1/auth/change-password` | Auth required | Change own password |

### Admin Routes (`/v1/admin`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/v1/admin/tenants` | Platform Admin | List all tenants |
| POST | `/v1/admin/tenants` | Platform Admin | Provision new tenant |
| PATCH | `/v1/admin/tenants/:id/status` | Platform Admin | Suspend/reactivate tenant |
| GET | `/v1/admin/features` | Platform Admin | List feature flag catalog |
| GET | `/v1/admin/tenants/:id/flags` | Platform Admin | Get tenant's flag overrides |
| PUT | `/v1/admin/tenants/:id/flags` | Platform Admin | Set tenant's flag overrides |

### Client Routes (`/v1/clients`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/v1/clients` | Tenant User | List clients (paginated) |
| GET | `/v1/clients/:id` | Tenant User | Get client detail |
| POST | `/v1/clients` | Tenant Admin | Create client |
| PATCH | `/v1/clients/:id` | Tenant Admin | Update client |
| DELETE | `/v1/clients/:id` | Tenant Admin | Soft-delete client |

### Staff Routes (`/v1/staff`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/v1/staff` | Tenant Admin | List staff |
| POST | `/v1/staff` | Tenant Admin | Create staff member |
| PATCH | `/v1/staff/:id` | Tenant Admin | Update staff |
| POST | `/v1/staff/:id/reset-password` | Tenant Admin | Reset staff password |
| PATCH | `/v1/staff/:id/status` | Tenant Admin | Activate/deactivate |
| DELETE | `/v1/staff/:id` | Tenant Admin | Soft-delete |

### Features Routes (`/v1/features`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/v1/features` | Tenant User | Get this tenant's resolved flags |

### Resource Routes (`/v1/resources`) — *Gated by APPOINTMENTS flag*

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/v1/resources` | + Appointments | List resources |
| GET | `/v1/resources/:id` | + Appointments | Get resource detail |
| POST | `/v1/resources` | + Appointments, Admin | Create resource |
| PATCH | `/v1/resources/:id` | + Appointments, Admin | Update resource |
| DELETE | `/v1/resources/:id` | + Appointments, Admin | Soft-delete |

### Service Routes (`/v1/services`) — *Gated by APPOINTMENTS flag*

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/v1/services` | + Appointments | List services |
| GET | `/v1/services/:id` | + Appointments | Get service detail |
| POST | `/v1/services` | + Appointments, Admin | Create service |
| PATCH | `/v1/services/:id` | + Appointments, Admin | Update service |
| DELETE | `/v1/services/:id` | + Appointments, Admin | Delete service |
| GET | `/v1/services/:id/requirements` | + Appointments | Get resource requirements |
| PUT | `/v1/services/:id/requirements` | + Appointments, Admin | Set resource requirements |

### Availability Routes (`/v1`) — *Gated by APPOINTMENTS flag*

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/v1/resources/:id/working-hours` | + Appointments | Get working hours |
| POST | `/v1/resources/:id/working-hours` | + Appointments, Admin | Set working hours |
| PATCH | `/v1/working-hours/:id` | + Appointments, Admin | Update working hours entry |
| DELETE | `/v1/working-hours/:id` | + Appointments, Admin | Delete working hours entry |
| GET | `/v1/resources/:id/time-off` | + Appointments | List time-off |
| POST | `/v1/resources/:id/time-off` | + Appointments, Admin | Create time-off entry |
| DELETE | `/v1/time-off/:id` | + Appointments, Admin | Delete time-off entry |
| GET | `/v1/settings/timezone` | + Appointments | Get tenant timezone |
| PUT | `/v1/settings/timezone` | + Appointments, Admin | Set tenant timezone |

### Appointment Routes (`/v1/appointments`) — *Gated by APPOINTMENTS flag*

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/v1/appointments` | + Appointments | List appointments (paginated) |
| GET | `/v1/appointments/:id` | + Appointments | Get appointment detail |
| POST | `/v1/appointments` | + Appointments | Create appointment |
| PATCH | `/v1/appointments/:id` | + Appointments | Transition status / reschedule (discriminated action) |
| GET | `/v1/appointments/:id/history` | + Appointments | Get status change history |

### Health Check

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | None | Health check (returns `{ status: "ok" }`) |

---

## Roles and Authorization

Three roles defined in [`src/lib/roles.ts`](../backend/src/lib/roles.ts):

| Role | Scope | Capabilities |
|------|-------|-------------|
| `platform_admin` | Global (no tenantId) | Manage tenants, set feature flags. Cannot access tenant data. |
| `tenant_admin` | Single tenant | Full CRUD: staff, clients, resources, services, availability, appointments. |
| `tenant_user` | Single tenant | Read clients, create/view appointments. Limited write access. |

Auth guards are implemented as Fastify `preHandler` hooks in the auth plugin:
- `requireAuth` — verifies JWT and sets `req.userClaims`
- `requirePlatformAdmin` — requires `platform_admin` role
- `requireTenantUser` — requires `tenant_admin` or `tenant_user` role with matching tenantId
- `requireAppointments` — composable: `requireTenantUser` + APPOINTMENTS feature flag check

---

## Frontend Modules

The frontend is organized into feature modules under `frontend/src/features/`:

| Feature | Directory | Description |
|---------|-----------|-------------|
| **Auth** | `features/auth/` | Login page, forced password change |
| **Admin** | `features/admin/` | Platform admin console, feature flag panel |
| **Staff** | `features/staff/` | Tenant staff management UI |
| **Clients** | `features/clients/` | Client CRM workspace and detail view |
| **Scheduling** | `features/scheduling/` | Unified scheduling page with tabbed navigation |
| **Calendar** | `features/calendar/` | Appointment detail view, create appointment form |
| **Flags** | `features/flags/` | React context providing feature flags to the UI |
| **Profile** | `features/profile/` | User profile management |
| **Resources** | `features/resources/` | Resource management (stub) |

### Frontend Architecture

- **Routing:** React Router v6 with a `RequireAuth` guard component
- **Server state:** TanStack Query for data fetching and caching
- **Forms:** React Hook Form + Zod validation
- **UI:** shadcn/ui (Radix UI primitives) styled with Adobe Spectrum CSS variables
- **i18n:** Translation system with a 40KB translations file in `lib/i18n/`

### Tenancy in the Frontend

The frontend resolves the tenant from the browser's current hostname (subdomain). API
requests include the full subdomain host, which the Vite dev proxy forwards to the
backend with the correct `Host` header.

---

## Inter-Module Communication

Modules communicate through the layered architecture — no direct coupling:

1. **Route → Controller → Module:** Controllers receive `req.tenantDb` from the tenant
   plugin and pass it to module service functions.
2. **Module → Module:** Some modules call into others (e.g., scheduling reads resources
   and services tables; staff deactivation revokes auth sessions).
3. **Global ↔ Tenant:** The **only** bridge is the tenant plugin's two global reads:
   tenant identity lookup and feature flag resolution. Tenant modules never connect
   to the global DB directly.
4. **Auth Dual Path:** The auth controller branches on `req.tenant` to authenticate
   against either the global DB (platform admins) or the tenant DB (tenant users).
