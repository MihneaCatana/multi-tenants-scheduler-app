# User Management + Observability — Design

**Date:** 2026-06-26
**Status:** Approved
**Scope:** Backend + frontend for two features on the Project Simi multi-tenant platform.

## Overview

Two features added to the existing Fastify + React multi-tenant SaaS:

1. **User Management (manual invite model)** — a tenant administrator manages the
   users inside their own tenant: list, update profile (firstName/lastName), change
   roles, reset passwords (temporary password that must be changed on next login),
   and activate/deactivate users.
2. **Observability** — every significant app action is logged as a structured event
   to file-based logs with daily rotation and per-tenant folder splitting, plus a
   retention cleanup so disk usage stays bounded.

Both features extend the established architecture: controllers → services → Drizzle
(global DB) on the backend; feature components calling typed `api.*` wrappers on the
frontend.

## Background / Constraints

- **Tenant isolation is the core invariant.** Users live in the GLOBAL database but
  carry a `tenantId`. A tenant admin may only act on users whose `tenantId` matches
  the tenant resolved from the request subdomain. The existing `requireTenantUser`
  guard + JWT `tenantId` ↔ resolved-tenant check (in `plugins/auth.ts`) already
  enforces this; the new routes reuse it.
- **No self-signup.** The platform already uses a manual invite model: a tenant
  admin creates users via `POST /auth/register`. This spec keeps that model and
  layers management on top.
- **Scope of management = tenant admin → tenant users.** Platform-admin management
  of cross-tenant users and self-profile editing are explicitly out of scope for
  this iteration.
- **No external services.** Observability is file-based only (no Datadog/Loki/ELK)
  and there is no DB audit table — logs live only on disk, split per tenant.

---

## Feature 1: User Management

### 1.1 Data Model Changes (global DB)

The existing `users` table gains two columns:

| Column | Type | Default | Notes |
|---|---|---|---|
| `active` | `boolean` | `true` | Inactive users cannot authenticate. |
| `must_change_password` | `boolean` | `false` | Set during admin password reset; cleared on self-change. |

A new Drizzle migration (`src/db/migrations/global/0002_*.sql`) adds both columns
with `NOT NULL DEFAULT` so existing rows are backfilled as active and not requiring
a change. The Drizzle schema in `src/db/schema/global/users.ts` is updated to match.

The `registerTenantUser` service now defaults `active = true` and
`must_change_password = false` (the tenant admin hands the password over directly).

### 1.2 Authentication Behavior Changes

**Inactive users cannot log in.** In `authenticate()`, after locating the user and
before password verification, if `active = false` the request is rejected with
`unauthorized('Invalid email or password.')` (same message as a bad password, to
avoid leaking which).

**Must-change-password is surfaced.** On successful login (and on refresh), the
returned `user` object includes `mustChangePassword: boolean`. When true, the
frontend forces the user onto a password-change screen before any other route.
The user can still call `POST /auth/change-password` (their only usable endpoint
while in this state); other endpoints remain technically callable, but the
frontend blocks navigation until the flag clears. (See 1.5 for the reason this is
a UX gate, not a hard backend gate.)

**Status check on refresh.** `rotateRefreshToken` reloads the user after accepting
the token; if the user is now inactive, the rotation is revoked and the request
fails. This ensures a freshly-deactivated user cannot keep refreshing access tokens
even if they hold a valid refresh cookie.

### 1.3 API Endpoints — Tenant Admin (subdomain, `tenant_admin` only)

All guarded by `tenantRoleGuard('tenant_admin')`, so the resolved tenant and the
JWT's `tenantId` must match. Every handler operates only on users whose
`tenantId = req.tenant.id`.

| Endpoint | Method | Body / Query | Returns |
|---|---|---|---|
| `/users` | GET | `?status=active\|inactive&limit=&offset=` | `{ users: PublicUser[] }` |
| `/users/:id` | PATCH | `{ firstName?, lastName?, role? }` | `{ user: PublicUser }` |
| `/users/:id/reset-password` | POST | _(empty)_ | `{ temporaryPassword: string }` |
| `/users/:id/status` | PATCH | `{ active: boolean }` | `{ user: PublicUser }` |

**PublicUser shape** (reused by auth endpoints):
`{ id, email, role, tenantId, firstName, lastName, active, mustChangePassword }`.

#### 1.3.1 `PATCH /users/:id`

Updates `firstName`, `lastName`, and/or `role`. All fields optional (partial). Rules:

- The target user must belong to this tenant (404 otherwise — never leak existence
  in another tenant).
- `role`, if provided, must be in `TENANT_ROLES` (`tenant_admin` / `tenant_user`).
  A tenant admin may never set `platform_admin`.
- A tenant admin **cannot change their own role** (403) — prevents both accidental
  self-demotion and self-promotion edge cases.
- Bumps `updated_at`.

#### 1.3.2 `POST /users/:id/reset-password`

1. Target user must belong to this tenant.
2. Generate a cryptographically random temporary password (16 base64url chars via
   the existing `generateToken`, trimmed to length).
3. `hashPassword(temp)`, store as the user's `password_hash`.
4. Set `must_change_password = true`.
5. **Revoke all of the user's sessions** (reuse `revokeAllSessions(userId)`), so
   any current access token still expires on its own but no new ones can be minted.
6. Return `{ temporaryPassword }` **once** in the response. The admin communicates
   it to the user out-of-band. It is never retrievable again.

Audit log entry: `action = user.password_reset`, target = the user.

#### 1.3.3 `PATCH /users/:id/status`

Sets `active = true|false`. Rules:

- Target user must belong to this tenant.
- A tenant admin **cannot deactivate themselves** (403) — prevents lockout.
- On deactivation, **revoke all of the user's sessions** immediately (their current
  access token still expires on its own TTL; this stops refresh). On reactivation,
  nothing is restored — the user simply logs in again.
- Bumps `updated_at`.

### 1.4 Self-Service Password Change

New endpoint available to **any** authenticated user (no role restriction):

| Endpoint | Method | Body | Returns |
|---|---|---|---|
| `/auth/change-password` | POST | `{ currentPassword, newPassword }` | `204 No Content` |

1. Verify `currentPassword` against the stored hash. On mismatch, `unauthorized`
   with a generic message.
2. `hashPassword(newPassword)`, store it.
3. Set `must_change_password = false`.
4. **Revoke all of the user's other sessions** (every session except the one
   making this request) so old sessions on other devices can't keep using the
   old password via refresh.
5. Return 204.

Audit log entry: `action = user.password_change`.

`newPassword` validation reuses the existing Zod `password` schema (min 8, max 128).

### 1.5 Why `mustChangePassword` is a UX gate, not a hard backend gate

Hard-gating every endpoint would require a preHandler that inspects
`must_change_password` and 403s. That's correct for a high-security product, but
it complicates the refresh flow (refresh must still work so the user can stay
authenticated while changing the password). For this iteration we treat it as a
strong UX gate: the frontend refuses to navigate anywhere except the change-
password screen while the flag is set, and the change-password endpoint clears it.
The data model + audit trail are in place; a hard backend gate can be layered on
later without schema changes.

### 1.6 Frontend Changes

- **`TenantWorkspace.tsx`**: gains a top-nav tab/section "Users" alongside the
  existing "Accounts" content (or a separate route). Lists this tenant's users in
  a table with columns: Name, Email, Role, Status, Created, Actions (Edit,
  Reset password, Activate/Deactivate).
- **Edit user modal**: firstName, lastName, role select. Role select limited to
  tenant roles.
- **Reset password modal**: confirmation step, then shows the one-time temporary
  password with a copy button + a warning that it must be changed on next login.
- **Activate/Deactivate**: inline button with a confirm; disabled on self.
- **`RequireAuth` / auth provider**: if the current user has `mustChangePassword`,
  redirect to a forced `ChangePasswordPage` (new) regardless of the requested
  route. On success, clear the flag in auth state and proceed to the originally
  requested route.
- **`lib/api.ts` / `lib/types.ts`**: add typed wrappers (`listUsers`, `updateUser`,
  `resetUserPassword`, `updateUserStatus`, `changePassword`) and update `AuthUser`
  / `PublicUser` to include `active` and `mustChangePassword`.
- All new UI reuses the existing primitives (`AppLayout`, `Modal`, `Badge`,
  `Spinner`, `Field`, `btn-*` classes, Tailwind).

---

## Feature 2: Observability

### 2.1 Log File Layout

```
<LOG_DIR>/                          (default: ./logs)
├── global/
│   ├── 2026-06-26.json
│   ├── 2026-06-25.json
│   └── …
├── acme/                           (one folder per tenant, named by subdomain)
│   ├── 2026-06-26.json
│   └── …
├── globex/
│   ├── 2026-06-26.json
│   └── …
└── …
```

- **`global/`** holds everything that is not tenant-scoped: platform-admin actions
  on the apex host, auth events for platform staff, health checks, startup/shutdown,
  unhandled errors with no tenant context, and every log entry whose `tenantId`
  is null.
- **`{subdomain}/`** holds tenant-scoped events: anything that happened while a
  tenant was resolved on the request (user management, account CRUD, tenant-user
  auth, etc.).
- Each file is **newline-delimited JSON** (one pino event per line), one file per
  UTC day, named `YYYY-MM-DD.json`.
- Folders are created lazily on first write for a given tenant/day.

### 2.2 Pino Transport Setup

- Add a **multi-stream transport** to the pino logger. Dev keeps the existing
  `pino-pretty` console transport; all environments additionally get the file
  transport(s).
- Use **`pino-roll`** as the destination for file writes. `pino-roll` is given a
  `filePath` + a daily-frequency `mkdir: true` config so it creates the per-tenant
  folder and rotates the file each day.
- **Per-tenant routing:** the logger module maintains a small cache of pino child
  loggers keyed by subdomain (or `'global'`). The Fastify `onRequest` tenant hook
  resolves the tenant; a request-scoped logger is attached to `req` pointing at
  the right child. `req.log` thus already targets the correct file.
  - Concretely: the root logger writes to `global/`; a `getTenantLogger(subdomain)`
    helper returns (creating if needed) a child transport whose destination is
    `{subdomain}/`. Both share the same redaction config and base fields.
  - Fastify's own request logging and `req.log` must point at the routed child, so
    the tenant plugin sets `req.log = getTenantLogger(subdomain)` after resolving
    the tenant. Requests with no resolved tenant (apex/global, bypass prefixes,
    unauthenticated) keep the root logger → `global/`. Audit calls go through
    `req.log`, so pre-auth events like a failed login (where no `userClaims` exist
    yet but a tenant *was* resolved from the subdomain) still land in the right
    tenant file, while apex failed logins land in `global/`.

### 2.3 Structured Audit Fields

Every meaningful log entry (audit events and operational events alike) carries:

```json
{
  "level": 30,
  "time": 1700000000000,
  "service": "simi-backend",
  "tenantId": "uuid-or-null",
  "tenantSubdomain": "acme-or-null",
  "actor": { "userId": "uuid", "role": "tenant_admin", "email": "a@b.com" },
  "action": "user.password_reset",
  "target": { "resource": "user", "id": "uuid" },
  "req": { "id": "request-uuid", "method": "POST", "url": "/users/…/reset-password", "ip": "1.2.3.4", "userAgent": "…" },
  "msg": "Admin reset password for user"
}
```

Redaction (existing) continues to strip `authorization`, `cookie`, `password`,
`passwordHash`, `refreshToken`, `refreshHash` from any nested field.

### 2.4 Audit Logging Utility (`src/lib/audit.ts`)

A typed helper that standardizes audit entries:

```ts
auditLog(req, {
  action: 'user.password_reset',
  target: { resource: 'user', id: targetUserId },
  msg: 'Admin reset password for user',
  level?: 'info' | 'warn',   // default info
});
```

- Pulls `actor` from `req.userClaims` (userId, role; email is looked up from the
  auth context where available, else omitted).
- Pulls `tenantId` / `tenantSubdomain` from `req.tenant` (null if apex/global).
- Writes via `req.log` (which is already routed to the correct tenant file) so the
  entry lands in the right folder automatically.
- Every controller that performs a state-changing action calls `auditLog` exactly
  once after the DB write succeeds.

### 2.5 What Gets Logged

Audit events (state-changing or security-relevant):

- **Auth:** login success, login failure, logout, refresh (best-effort, sampled at
  info), password change, must-change-password gate triggers.
- **User management:** user created (existing register), user updated, role change,
  password reset, user activated, user deactivated.
- **Platform admin (global stream):** tenant provisioned, tenant suspended,
  tenant activated (these already log today — they move onto the audit schema).
- **Tenant account CRUD:** account created/updated/deleted (sampled/info).

Operational events continue to be logged via the normal pino `req.log.info/.error`
and the Fastify request logging; these also land in the correct tenant file thanks
to the per-tenant routing.

### 2.6 Rotation & Retention

- **Rotation:** `pino-roll` rolls over to a new `{subdomain}/YYYY-MM-DD.json` (and
  `global/YYYY-MM-DD.json`) at the UTC date boundary. No manual midnight logic.
- **Retention:** a daily job (`setInterval` started at app boot, plus an immediate
  run on boot) walks `LOG_DIR` and deletes any file older than
  `LOG_RETENTION_DAYS` (default 30). It uses file mtime. The interval is
  configurable and the job logs its own purged-count summary to the global stream.
- **Failure handling:** if a per-tenant file/folder cannot be created (permissions,
  full disk), pino's transport emits an error to the global stream; the request
  still completes (logging is best-effort and must never break a request).

### 2.7 New Environment Variables

Added to `src/config/env.ts` (all optional with sensible defaults):

| Var | Default | Notes |
|---|---|---|
| `LOG_DIR` | `./logs` | Root directory for all log files. |
| `LOG_RETENTION_DAYS` | `30` | Files older than this many days are purged by the cleanup job. |
| `LOG_LEVEL` | `info` (`silent` in test) | Minimum pino level. |

### 2.8 New Dependencies

- `pino-roll` (runtime) — daily file rotation with `mkdir`.

---

## Out of Scope

- Platform-admin cross-tenant user management UI/API.
- Self-service profile editing (firstName/lastName) for non-admin users.
- Email-based invite links / email sending infrastructure.
- External log aggregation (Datadog / Loki / ELK).
- A queryable `audit_logs` DB table.
- A hard backend gate enforcing `must_change_password` on every endpoint (UX gate
  only for this iteration — see 1.5).
- Metrics/tracing (logs only).

## Files Touched (summary)

**Backend:**
- `src/db/schema/global/users.ts` — add `active`, `must_change_password`.
- `src/db/migrations/global/0002_*.sql` — new (generated).
- `src/config/env.ts` — `LOG_DIR`, `LOG_RETENTION_DAYS`, `LOG_LEVEL`.
- `src/lib/logger.ts` — multi-transport + per-tenant routing + retention job.
- `src/lib/audit.ts` — new audit helper.
- `src/modules/auth/service.ts` — inactive check, must-change surface, status
  check on refresh, `changeOwnPassword` service fn.
- `src/modules/auth/schema.ts` — `changePasswordBody`.
- `src/modules/users/` (new module) — user service.
- `src/controllers/auth.controller.ts` — add `changePassword`, surface
  `mustChangePassword`.
- `src/controllers/users.controller.ts` — new.
- `src/routes/auth.routes.ts` — add `/auth/change-password`.
- `src/routes/users.routes.ts` — new.
- `src/routes/index.ts` — register users routes.

**Frontend:**
- `src/lib/types.ts` — `PublicUser`, updated `AuthUser`, new result types.
- `src/lib/api.ts` — `listUsers`, `updateUser`, `resetUserPassword`,
  `updateUserStatus`, `changePassword`.
- `src/features/users/` (new) — `UsersPanel` + modals.
- `src/features/auth/ChangePasswordPage.tsx` — new forced change screen.
- `src/features/accounts/TenantWorkspace.tsx` — Users nav entry (or new route).
- `src/lib/auth.tsx` / `src/routes/RequireAuth.tsx` — must-change redirect.
- `src/App.tsx` — route wiring.

## Open Questions

None — all clarified during brainstorming.
