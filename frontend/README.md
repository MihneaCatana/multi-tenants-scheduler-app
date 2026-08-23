# Simi Console (frontend)

React + Vite + TypeScript UI for the [Simi](../backend) multi-tenant SaaS backend.

Provides appointment scheduling, client management, staff management,
resource and service configuration, and a platform admin console for
tenant provisioning.

## Stack

| Concern | Choice |
| --- | --- |
| Framework | React 18 + Vite 5 + TypeScript (strict) |
| UI components | PrimeReact 10 |
| Icons | PrimeIcons |
| Routing | React Router v6 |
| Server state | TanStack Query |
| Forms / validation | React Hook Form + Zod (mirrors backend schemas) |
| Styling | PrimeReact themes + inline styles |
| Linting | ESLint v9 (flat config) + Prettier |

## How tenancy works in the UI

The backend resolves tenants **purely by subdomain** against `BASE_DOMAIN`
(e.g. `acme.simisolutions.localhost`), and refresh tokens ride on an HttpOnly
cookie scoped to path `/auth`. To exercise this faithfully, the Vite dev server
runs on the **same domain family**:

- `http://simisolutions.localhost:5173` → apex / **platform admin**
- `http://acme.simisolutions.localhost:5173` → **Acme** tenant
- `http://<subdomain>.simisolutions.localhost:5173` → any tenant

The dev server proxies the backend's route prefixes (`/v1/auth`, `/v1/admin`,
`/v1/accounts`, `/v1/users`, `/v1/features`, `/v1/staff`, `/v1/health`)
and rewrites the outgoing `Host` header so the backend's tenant resolver sees
the correct subdomain. See `vite.config.ts` for the rationale — the verbatim
paths are what keep the refresh-token cookie in scope.

## Prerequisites

1. **Node.js ≥ 20** and **pnpm** (matches backend toolchain).
2. **Backend running** — start it per the backend README (`pnpm dev`, default
   port 3000) and run `pnpm setup` once so the platform admin and the demo
   `acme` tenant exist.
3. **`*.simisolutions.localhost` resolves to loopback.**
   - On most OSes, multi-label `.localhost` names already resolve to `127.0.0.1`.
   - On **Windows**, add these to `C:\Windows\System32\drivers\etc\hosts`:
     ```
     127.0.0.1  simisolutions.localhost
     127.0.0.1  acme.simisolutions.localhost
     ```
     (Add one line per tenant you provision, e.g. `globex.simisolutions.localhost`.)

## Getting started

```bash
pnpm install
pnpm dev
```

Then open `http://simisolutions.localhost:5173`.

Configuration lives in `.env` (copy from `.env.example`):

| Var | Default | Notes |
| --- | --- | --- |
| `VITE_BASE_DOMAIN` | `simisolutions.localhost` | Must match backend `BASE_DOMAIN`. |
| `VITE_PORT` | `5173` | Dev server port. |
| `VITE_BACKEND_PORT` | `3000` | Backend port to proxy to. |

## Default credentials (from backend `pnpm setup`)

| Identity | Email | Password | Where to sign in |
| --- | --- | --- | --- |
| Platform admin | `admin@simisolutions.localhost` | `change-me-please` | apex host |
| Acme tenant owner | `owner@acme.com` | `supersecret` | `acme.simisolutions.localhost` |

## The multi-tenant test loop

1. **Apex** → sign in as platform admin → **Tenants** console.
2. **Provision** a second tenant (e.g. name `Globex`, subdomain `globex`, an
   owner email + password). A dedicated database is created for it. Add the
   new subdomain to your `hosts` file (Windows).
3. From the tenants table, **Open** `acme` → sign in as its owner → add a
   client. Note the tenant badge in the header reads `acme`.
4. **Open** `globex` → sign in as its owner → confirm the clients list is
   **empty** (Globex's own DB). Add a Globex client.
5. Switch back to `acme` → confirm you see **only** Acme's client. The two
   lists never overlap — that's physical tenant isolation working.
6. Bonus: from the apex console **Suspend** a tenant → its owner's refresh
   sessions are revoked server-side, and its workspace becomes unreachable.

## Scripts

```bash
pnpm dev         # Vite dev server (multi-tenant proxy)
pnpm build       # tsc + vite build → dist/
pnpm preview     # serve the production build
pnpm typecheck   # tsc -b (typecheck only)
pnpm lint        # eslint
pnpm format      # prettier --write
pnpm test        # vitest (watch mode)
pnpm test:run    # vitest --run (CI mode)
```

## Project structure

```
src/
├── lib/
│   ├── api.ts        # fetch client, access-token cache, 401 → refresh + retry
│   ├── auth.tsx      # AuthProvider, useAuth, session restore on boot
│   ├── errors.ts     # API error → user-facing message mapping
│   ├── flags.ts      # FeatureFlag enum (mirrors backend)
│   ├── tenant.ts     # subdomain → tenant context (mirrors backend)
│   └── types.ts      # shared domain types (mirror backend responses)
├── components/       # AppLayout, TenantBadge, Modal, Spinner, ErrorBoundary
├── routes/           # RequireAuth guard, RootRedirect, ForbiddenPage
└── features/
    ├── auth/         # LoginPage, ChangePasswordPage
    ├── admin/        # AdminConsole, FeaturesPanel
    ├── accounts/     # (legacy — replaced by clients)
    ├── clients/      # ClientsWorkspace, ClientView (CRM contacts)
    ├── users/        # UsersPanel (login identities per tenant)
    ├── staff/        # StaffPanel (staff members per tenant)
    ├── scheduling/   # SchedulingPage with tabs (appointments, calendar,
    │                 #             resources, services)
    ├── calendar/     # AppointmentDetail, CreateAppointmentForm
    ├── services/     # Service-specific helpers
    ├── resources/    # Resource-specific helpers
    ├── flags/        # FlagsProvider (this tenant's resolved feature flags)
    └── profile/      # Profile page
```

## Notes & limits

- Access tokens live **in memory only** (never `localStorage`) to limit XSS
  exposure; refresh tokens are HttpOnly cookies the browser manages.
- A 401 triggers **one** refresh (deduped across concurrent requests) then a
  retry. A failed refresh clears the session and routes to `/login`.
- The backend disables CORS in production (`origin: false`); this frontend is
  designed for same-origin deployment behind a reverse proxy (nginx serves the
  SPA and proxies `/v1/*` to the Fastify backend).
- `index.html` includes `<meta name="robots" content="noindex">` to prevent
  search-engine indexing of tenant-facing pages.
