# Per-Tenant Feature Flags — Design

**Date:** 2026-06-27
**Status:** Approved
**Scope:** Backend + frontend for a per-tenant feature-flag system on the Project Simi multi-tenant platform.

## Overview

A feature-flag system so different tenants can have different features enabled.
The platform admin (apex host, `platform_admin` role) manages a flag catalog and
per-tenant on/off state; tenant users (subdomain host) see only a read-only
resolved view of their tenant's flags, which the frontend gates UI on.

This is the foundation for "modules for each type of business": define a flat
catalog of boolean feature flags (reservations, inventory, POS, …), and give each
tenant the subset appropriate to its business type.

## Decisions (from brainstorming)

- **Flag model:** flat boolean flags (no grouped modules, no typed values).
- **Catalog home:** **DB-defined.** Flag *definitions* (key, label, description,
  default) live as rows in a `features` table — the classic entity + junction
  model, not a code-only registry.
- **Catalog authority:** the `features` table is a **pure mirror of a code-defined
  catalog** (`FLAG_CATALOG`). The catalog is undeletable from the UI — the only
  way to add/remove/rename a flag is to edit `FLAG_CATALOG` and redeploy. A
  boot-time sync keeps the table in lock-step with code (insert new, update
  drifted metadata, delete removed + cascade their overrides).
- **Management:** **platform admin only.** Only `platform_admin` staff (apex host)
  can toggle a tenant's flags. Tenant admins can *see* their flags but not change
  them. This matches the existing platform-as-gatekeeper model (tenants are
  provisioned by staff, not self-served).
- **Gating reference:** a typed string enum (`FeatureFlag`) is the *only* way
  backend/frontend code references a flag. The DB owns definitions; the enum owns
  typo-proof, autocomplete-friendly gating. A flag in the DB but not the enum is
  listed by the catalog endpoint but cannot be gated on in code (returns `false`).

## Background / Constraints

- **Tenant isolation invariant preserved.** All tenant-scoped flag reads key off
  the request's resolved tenant (via the existing tenant-resolution hook), and
  the existing `requireTenantUser` guard enforces JWT `tenantId` ↔ resolved-tenant
  match. The platform admin (no `tenantId`) can only reach flags through the
  explicit `/admin/tenants/:id/...` paths.
- **Flags are platform config, not tenant data.** They live in the GLOBAL catalog
  DB (alongside `tenants`/`users`/`sessions`), **not** in each tenant's isolated
  DB. The apex `platform_admin` has no `tenantId` and cannot reach tenant DBs;
  flags must be readable from the apex, so the global DB is the correct home.
- **No external services.** In-process caching only (no Redis). SMB-scale write
  volume makes a short-TTL in-memory cache sufficient.

---

## 1. Data Model

Two new tables in the **GLOBAL** database (new Drizzle schema files + a generated
migration `0003_*.sql`).

### `features` — the catalog (DB-owned, code-mirrored definitions)

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | `defaultRandom()` |
| `key` | `varchar(63)` UNIQUE | stable identifier, e.g. `'reservations'`. Matches a `FeatureFlag` enum member. |
| `label` | `varchar(120)` | human label for UI, e.g. `'Table Reservations'` |
| `description` | `text` | what the feature does; shown in admin UI |
| `enabled` | `boolean` DEFAULT `false` | the **platform-wide default** on/off |
| `createdAt` | `timestamptz` | `defaultNow()` |
| `updatedAt` | `timestamptz` | `defaultNow()` |

- Unique index on `key`.
- This table is **read-only at runtime** — no endpoint creates/updates/deletes
  rows directly. Its only writer is the boot-time catalog sync (Section 2).

### `tenant_features` — the junction (per-tenant overrides)

| Column | Type | Notes |
|---|---|---|
| `tenantId` | `uuid` FK → `tenants.id` ON DELETE CASCADE | |
| `featureId` | `uuid` FK → `features.id` ON DELETE CASCADE | |
| `enabled` | `boolean` | this tenant's explicit value |
| `updatedAt` | `timestamptz` | `defaultNow()` |
| | PK `(tenantId, featureId)` | composite primary key |

- Composite PK `(tenant_id, feature_id)` enforces one override per tenant/feature.
- Both FKs `ON DELETE CASCADE`: dropping a tenant or a feature removes its
  overrides automatically.

### Resolution rule (core contract)

A flag is **ON** for a tenant when:

1. a `tenant_features` row exists → use its `enabled`; otherwise
2. fall back to `features.enabled` (the platform default).

"No override" is meaningful — a tenant with no row inherits the default.
Resolving all flags for a tenant is a single LEFT JOIN.

### Code-side enum (gating key)

```ts
// backend/src/lib/flags.ts (mirrored in frontend/src/lib/flags.ts)
export const FeatureFlag = {
  RESERVATIONS: 'reservations',
  INVENTORY: 'inventory',
  POS: 'pos',
  // … add one entry per catalog flag
} as const;
export type FeatureFlag = (typeof FeatureFlag)[keyof typeof FeatureFlag];
```

This is a **code-side view** of the catalog, not the source of truth. Adding a
flag = add it to `FLAG_CATALOG` (Section 2) **and** to this enum.

---

## 2. Catalog Sync

The `features` table is kept a pure mirror of a code-defined catalog via an
**idempotent boot-time sync**. Code is the sole authority for what flags exist.

### Source: `FLAG_CATALOG`

```ts
// backend/src/lib/flag-catalog.ts
export const FLAG_CATALOG = [
  { key: 'reservations', label: 'Table Reservations', description: '…', enabled: false },
  { key: 'inventory',    label: 'Inventory',           description: '…', enabled: false },
  { key: 'pos',          label: 'Point of Sale',        description: '…', enabled: false },
] as const;
```

`FLAG_CATALOG` and the `FeatureFlag` enum must agree on keys (a unit-style check
is provided; mismatch is a developer error surfaced at boot).

### Sync behavior (`syncFlagCatalog(globalDb)`)

Runs once at app boot (`app.ts`, after the DB is reachable and before routes
serve traffic), in a single transaction:

1. **Insert** catalog flags missing from the DB (with their declared
   `label`/`description`/`enabled`).
2. **Update** drifted `label`/`description`/`enabled` to match code.
3. **Delete** DB flags no longer in the catalog → the `ON DELETE CASCADE` FK on
   `tenant_features` removes their overrides automatically.

Consequences, all predictable:
- **No catalog write endpoints.** There is no `POST`/`PATCH`/`DELETE` on
  `/admin/features`. The only catalog endpoint is `GET /admin/features` (read-only).
- **Removing a flag = remove it from `FLAG_CATALOG`** → next boot wipes it and its
  tenant overrides. This is the intended one-step removal and the *only* way to
  remove a flag.
- **The admin UI never creates or deletes flags** — it only flips per-tenant
  toggles against the code-owned catalog. No drift is possible.

### Sync failure handling

If the sync throws (e.g. DB unreachable), boot fails fast with a clear error
(consistent with the existing `env.ts` fail-fast pattern). Flags are foundational;
serving requests with a stale/missing catalog is worse than not starting.

---

## 3. Evaluation & Caching

### Resolver

```sql
SELECT f.key, COALESCE(tf.enabled, f.enabled) AS enabled
FROM features f
LEFT JOIN tenant_features tf
  ON tf.feature_id = f.id AND tf.tenant_id = $1
```

- `getTenantFlags(tenantId): Promise<Record<string, boolean>>` returns the fully
  resolved map (overrides merged over defaults). One round-trip, no N+1.
- A flag with no override row → `f.enabled` (default); a present override →
  `tf.enabled`.

### Caching

In-process `Map<tenantId, { flags: Record<string, boolean>, expiresAt: number }>`
with a short TTL (default **15s**, configurable via `FLAG_CACHE_TTL_MS`).

- **Why in-process:** SMB-scale write volume; no Redis dependency. 15s means an
  admin flip propagates within seconds without a deploy/restart.
- **Explicit invalidation on writes:** the admin `PUT /admin/tenants/:id/flags`
  clears that tenant's cache entry immediately so the UI reflects the change at
  once (no 15s wait after a deliberate change).
- **Full clear on catalog sync:** boot-time sync clears the whole cache (defaults
  may have changed).

### Backend exposure

The tenant-resolution hook (`plugins/tenant.ts`) attaches `req.tenantFlags` after
resolving the tenant, so handlers can check flags without re-querying:

```ts
req.tenantFlags = await getTenantFlags(tenant.id);   // cached
```

A thin helper keeps call sites one-liners:

```ts
// backend/src/lib/flags.ts
export function isEnabled(req: FastifyRequest, flag: FeatureFlag): boolean {
  return req.tenantFlags?.[flag] === true;
}
```

Requests with no resolved tenant (apex/bypass) have `req.tenantFlags = undefined`
→ `isEnabled` returns `false` (flags are tenant-scoped by definition).

### Frontend exposure

- `GET /features` (any authenticated tenant user) returns the resolved map once
  per session; the SPA holds it in a `FlagsProvider` (React context) and gates UI
  with `useFlag('reservations')`.
- Re-fetched on login/refresh (alongside session restore) so a flag flip is seen
  on next sign-in.

---

## 4. API Surface

Split by audience. Tenant-scoped routes reuse the existing tenant-resolution +
`requireTenantUser` guard; catalog/management routes reuse
`requirePlatformAdmin`.

### Platform admin (apex host) — flag management

| Endpoint | Method | Body / Query | Returns |
|---|---|---|---|
| `/admin/features` | GET | — | `{ features: FeatureDef[] }` — read-only catalog (`key,label,description,enabled`) |
| `/admin/tenants/:id/flags` | GET | — | `{ flags: ResolvedFlag[] }` — resolved per-tenant (`key` + final `enabled`) |
| `/admin/tenants/:id/flags` | PUT | `{ flags: { key: string, enabled: boolean }[] }` | `{ flags: ResolvedFlag[] }` — upserts overrides, returns resolved set |

- **`PUT` semantics:** upsert per entry — each `{ key, enabled }` becomes a
  `tenant_features` upsert; keys not mentioned are left untouched (so the UI can
  send only the toggles that changed). Unknown keys (not in catalog) → `400`.
  Returns the full resolved set so the UI updates in one round-trip.
- **Audit:** `PUT` emits `auditLog` with `action: 'tenant.flags_update'`, target
  the tenant, `extra: { changes: { [key]: [from, to] } }`. Consistent with the
  audit trail added in the user-management/observability feature.
- All three guarded by `requirePlatformAdmin`; rate-limited on writes
  (`PUT` ~20/min, like tenant status flips).

### Tenant user (subdomain) — read only

| Endpoint | Method | Returns |
|---|---|---|
| `/features` | GET | `{ flags: { [key: string]: boolean } }` — the resolved map for *this* tenant (subdomain-resolved, no `:id`) |

- `/features` sits behind `requireTenantUser` (any tenant role), so the
  tenant-match invariant holds — a token for tenant A cannot read tenant B's flags.
- No tenant-scoped write endpoints exist (platform-admin-only management).

### Result shapes

```ts
interface FeatureDef {        // GET /admin/features item
  key: string;
  label: string;
  description: string;
  enabled: boolean;           // platform default
}
interface ResolvedFlag {      // GET/PUT /admin/tenants/:id/flags item
  key: string;
  enabled: boolean;           // resolved (override or default)
}
```

### No catalog-mutation endpoints

There are **no** endpoints to create/update/delete flags. Section 2 (catalog
sync) is the only writer of `features`. Adding a flag is a code change + deploy.

---

## 5. Frontend

Two surfaces, both gated by host context (matching the existing `isApexHost()`
pattern).

### Platform admin (apex `/platform`) — `FeaturesPanel`

A new section in `AdminConsole`, reached via a "Features" nav link (alongside
"Tenants"). Two views:

1. **Catalog overview** (`GET /admin/features`): a read-only table of all flags —
   `key`, `label`, `description`, platform `default`. No edit affordance
   (code-owned). This is the "what flags exist" reference.
2. **Per-tenant management** (`GET`/`PUT /admin/tenants/:id/flags`): pick a tenant
   (reuse the existing tenant list), see its resolved flag map, toggle each on/off
   inline. Save sends only changed toggles via `PUT`. Each row shows `label` +
   current resolved value + a toggle; the platform default is shown as a hint
   ("default: off") so the admin knows what unsetting the override would yield.
   Confirm before flipping.

### Tenant workspace (subdomain `/workspace`) — gating

- On app boot (alongside the existing session restore), fetch `GET /features`
  once and stash in a `FlagsProvider` (React context). `useFlag('reservations')`
  returns `boolean`.
- Feature areas render conditionally: a "Reservations" nav item / route only if
  `useFlag(FeatureFlag.RESERVATIONS)`.
- Unknown flags (not in the typed enum) are ignored by `useFlag` (returns
  `false`) — the typed enum is the gatekeeper, consistent with the backend.

### Reuse

`AppLayout`, `Modal`, `Badge` (tone `green`/`neutral` for on/off), `Spinner`,
`api`/`ApiError`, TanStack Query (cache keys `['features']`, `['tenants', id,
'flags']`), react-hook-form + Zod where forms appear. New types (`FeatureDef`,
`ResolvedFlag`) in `lib/types.ts`; new `api` methods (`listFeatures`,
`getTenantFlags`, `updateTenantFlags`, `getMyFlags`).

Management lives on the apex (where platform staff live); read-only gating lives
on tenant subdomains (where tenants live) — matching the existing host-based
split. No new primitives needed.

---

## Environment Variables

| Var | Default | Notes |
|---|---|---|
| `FLAG_CACHE_TTL_MS` | `15000` | Per-tenant flag cache TTL in milliseconds. |

Added to `src/config/env.ts`. No other new env vars.

## New Dependencies

None.

---

## Out of Scope

- **Typed/variant flag values** (string/number/JSON). Booleans only this iteration.
  The schema (a single `enabled boolean` column) is simple enough that a future
  typed-values migration is feasible without a redesign.
- **Grouped business-type modules** (e.g. a "Restaurant" bundle). Flat flags only;
  bundles can be layered on later as a preset that writes a set of overrides.
- **Tenant-admin self-service flag toggling.** Platform admin only.
- **Gradual rollout / percentage-based flags / per-user targeting.** Boolean
  per-tenant only.
- **Flag change history / audit *table*.** The existing file-based audit log
  captures `tenant.flags_update` events; no DB audit table.
- **Feature deletion from the UI.** Flags are removed by editing `FLAG_CATALOG`
  and redeploying (Section 2).
- **Cross-tenant "which tenants have flag X" reporting UI.** The schema supports
  the query; no dedicated UI this iteration.

## Files Touched (summary)

**Backend — new:**
- `src/db/schema/global/features.ts` — `features` + `tenant_features` tables.
- `src/db/migrations/global/0003_*.sql` — generated by `db:generate:global`.
- `src/lib/flags.ts` — `FeatureFlag` enum + `isEnabled(req, flag)` helper.
- `src/lib/flag-catalog.ts` — `FLAG_CATALOG` source + `syncFlagCatalog()`.
- `src/lib/flag-cache.ts` — in-process TTL cache + invalidation.
- `src/modules/flags/service.ts` — resolver (`getTenantFlags`), admin upsert.
- `src/modules/flags/schema.ts` — Zod schemas for the PUT body.
- `src/controllers/flags.controller.ts` — admin + tenant handlers.
- `src/routes/flags.routes.ts` — route wiring.

**Backend — modified:**
- `src/config/env.ts` — `FLAG_CACHE_TTL_MS`.
- `src/app.ts` — run `syncFlagCatalog` at boot; clear cache after.
- `src/plugins/tenant.ts` — attach `req.tenantFlags` after tenant resolution.
- `src/routes/index.ts` — register flags routes.
- `src/routes/admin.routes.ts` — register `/admin/features` + `/admin/tenants/:id/flags`.

**Frontend — new:**
- `src/lib/flags.ts` — `FeatureFlag` enum mirror.
- `src/features/admin/FeaturesPanel.tsx` — catalog overview + per-tenant mgmt.
- `src/features/flags/FlagsProvider.tsx` — tenant-side context + `useFlag`.

**Frontend — modified:**
- `src/lib/types.ts` — `FeatureDef`, `ResolvedFlag`.
- `src/lib/api.ts` — `listFeatures`, `getTenantFlags`, `updateTenantFlags`, `getMyFlags`.
- `src/features/admin/AdminConsole.tsx` — "Features" nav entry.
- `src/App.tsx` — wrap tenant routes in `FlagsProvider`; conditional feature routes.
- `src/lib/auth.tsx` (or a sibling) — fetch `/features` on session restore.

## Open Questions

None — all clarified during brainstorming.
