# Scheduling Core — Appointment Booking Module (Phase 1)

**Status:** Approved (brainstormed 2026-07-07)
**Phase:** 1 of a multi-phase scheduling/booking roadmap
**Scope:** Resources & services catalog, working schedule, appointment create + lifecycle
**Out of scope:** Slot availability endpoint, calendar UI, reminders, Google Calendar sync, recurring series, client self-service booking portal, cancellation-policy enforcement

---

## 1. Context & platform fit

Project Simi is a multi-tenant platform using **database-per-tenant** isolation: every tenant's data lives in its own PostgreSQL database, accessed through a per-tenant app role, resolved per-request via the tenant plugin. There is no `tenant_id` column on tenant tables — the database *is* the tenant boundary. This module follows the established layered recipe (`clients` module as template):

```
db/schema/tenant/<entity>.ts        → re-export from schema/tenant/index.ts, add to tenantSchema
modules/<feature>/                  → business logic, no Fastify deps, takes a TenantDb handle
controllers/<entity>.controller.ts  → Zod parse → service call → response shape → auditLog
routes/<entity>.routes.ts           → thin HTTP wiring, preHandler guards, registered in routes/index.ts
```

**Existing primitives reused:**
- `staff` (tenant table) — login identities; the providers/employees. Linked via `resources.linked_staff_id`.
- `clients` (tenant table) — CRM contacts; the customers/patients. Referenced by `appointments.client_id`.
- `FeatureFlag` + `FLAG_CATALOG` + `isEnabled()` — feature gating. A new `APPOINTMENTS` flag is added.
- `HttpError` + `lib/errors.ts` — stable machine-readable error codes for i18n mapping.
- `auditLog(req, {...})` — structured audit logging, called exactly once after a state-changing transaction commits.

**Sectors targeted first:** professional services, healthcare clinics, salon/beauty/spa. All are **1:1 appointments** with a primary resource (provider/stylist/professional) and optional secondary resources (room, equipment, chair). Validated against two concrete scenarios:
- *Salon multi-service* — color + cut + style booking sharing a chair with a stylist.
- *Clinic multi-resource* — Dr. X + Exam Room 3 for a consultation.

**What this phase introduces that does not exist today:**
- A new `tenant_settings` table (carrying `timezone`).
- The `btree_gist` Postgres extension on every tenant DB.
- A date/timezone-handling convention (UTC storage, single tenant TZ as operating context).

**What this phase does NOT introduce:** no queue/job system, no notifications, no OAuth/integration client, no calendar UI library. That discipline defines the scope boundary.

---

## 2. Scope & decomposition

The full booking product spans several subsystems. This spec covers **Phase 1 only**; later phases each get their own spec.

| Phase | Sub-project | New infrastructure it forces |
|---|---|---|
| **1 (this spec)** | Scheduling core — resources, services, working schedule, appointments + state machine, conflict-checked writes | `tenant_settings`, `btree_gist`, timezone convention |
| 2 | Staff calendar UI + slot availability endpoint | calendar component library, date library |
| 3 | Recurring appointment series + reminders | background queue/job system, email/SMS |
| 4 | Google Calendar two-way sync | OAuth client, webhook pattern |
| 5 | Client self-service booking (public page + slot holds) | unauthenticated access, hold table, requested→confirmed flow |

### Locked Phase-1 decisions

| Decision | Choice | Rationale |
|---|---|---|
| Booking actor | Staff-booked only | Single actor, no concurrency race on holds; appointment created directly in `confirmed` |
| Slot engine | Compute-on-demand (algorithm deferred) | Working schedule is source of truth; slots are a thin caller concern, built in phase 2 |
| Resource coupling | Multi-resource, per-type conflict | Booking reserves a set of resources, each checked independently against the time window |
| Schedule model | Weekly recurrence + exceptions | `working_hours` (repeating) + `time_off` (absolute overrides); covers ~95% of availability |
| Timezone | Single timezone per tenant | UTC storage, tenant TZ as operating context; sidesteps multi-TZ matrix |
| Lifecycle | Full state machine + history | `requested→confirmed→checked_in→in_progress→completed`, plus `cancelled`/`no_show`, with a status-history table |
| Conflict strategy | PostgreSQL GiST exclusion constraint | Race-proof correctness at the storage layer |
| Slot availability endpoint | **Deferred** | Phase 1 ships manual time entry with conflict validation on save only |
| Mutation API | Single PATCH with discriminated `{action}` body | Matches `clients`/`staff` PATCH convention; unifies reschedule + status + cancel into one endpoint |
| Cancellation policy | **Dropped** | No `cancellation_deadline_minutes` column; future phase adds it when enforcement exists |
| Tenant timezone storage | New `tenant_settings` table | Clean, future-proof; avoids polluting the global control-plane `tenants` table with business config |

---

## 3. Module layout

```
backend/src/db/schema/tenant/
  resources.ts                       NEW — typed bookable resources
  services.ts                        NEW — bookable services
  service_resource_requirements.ts   NEW — default resource set per service
  working_hours.ts                   NEW — weekly recurring availability
  time_off.ts                        NEW — absolute exceptions
  appointments.ts                    NEW — appointment header
  appointment_resources.ts           NEW — join + GiST exclusion constraint
  appointment_status_history.ts      NEW — transition audit trail
  tenant_settings.ts                 NEW — key/value tenant config (timezone)
  index.ts                           MODIFIED — re-export new tables, add to tenantSchema barrel

backend/src/modules/
  scheduling/                        NEW feature module
    service.ts                          — create, reschedule, transition, list, conflict pre-check
    state-machine.ts                    — data-driven transition graph + canTransition guard
    schema.ts                           — Zod request/response schemas (DTOs)
  resources/                        NEW — typed resources CRUD service
  services-catalog/                 NEW — bookable services CRUD service
  availability/                     NEW — working_hours + time_off CRUD service

backend/src/controllers/
  resources.controller.ts            NEW
  services.controller.ts             NEW
  availability.controller.ts         NEW
  appointments.controller.ts         NEW

backend/src/routes/
  resources.routes.ts                NEW — registered in routes/index.ts under /v1/resources
  services.routes.ts                 NEW — under /v1/services
  availability.routes.ts             NEW — under /v1 (working-hours, time-off)
  appointments.routes.ts             NEW — under /v1/appointments

backend/src/lib/
  errors.ts                          MODIFIED — add scheduling error factories
  flags.ts                           MODIFIED — add FeatureFlag.APPOINTMENTS
  flag-catalog.ts                    MODIFIED — describe APPOINTMENTS flag

backend/src/db/migrations/tenant/
  0005_btree_gist.sql                NEW — CREATE EXTENSION btree_gist
  0006_scheduling.sql                NEW — tables + GiST exclusion constraint

backend/src/db/                                       (tenant_template provisioning path)
  — add btree_gist to tenant_template so new tenants get the extension at provisioning time

frontend/src/features/calendar/      MINIMAL in phase 1
  — a basic create-appointment form wired to POST /v1/appointments
  — full staff calendar workspace deferred to phase 2
```

### Feature flag

Add `FeatureFlag.APPOINTMENTS = 'appointments'` to `lib/flags.ts`; describe it in `flag-catalog.ts` as *"Appointments — Book and manage appointments with multi-resource scheduling."* (default disabled). All scheduling routes are gated through a small `requireAppointments(req, roles)` helper that composes `requireTenantUser(req, { roles })` with `isEnabled(req, FeatureFlag.APPOINTMENTS)`, keeping route declarations readable.

---

## 4. Data model

All tables follow existing conventions: `pgTable`, uuid PKs (`.defaultRandom()`), `snake_case` columns mapped to camelCase TS fields, `created_at`/`updated_at`/`deleted_at` timestamps with timezone, partial unique indexes `WHERE deleted_at IS NULL`. **No `tenant_id` column** — the database is the tenant boundary.

### 4.1 `resources` — typed bookable things

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `name` | varchar(120) | |
| `type` | varchar | `'provider' \| 'room' \| 'equipment' \| 'chair'` |
| `linked_staff_id` | uuid, nullable | FK→`staff.id`; present only when `type='provider'` |
| `is_active` | bool, default true | inactive resources excluded from new bookings |
| `color` | varchar, nullable | UI hint |
| `notes` | text, nullable | |
| `created_at`, `updated_at`, `deleted_at` | timestamptz | |

`linked_staff_id` is the bridge to the existing `staff` table: a `provider` resource is a bookable view of a staff member. Non-staff resources (rooms, chairs, equipment) have `linked_staff_id = NULL`. Enforce in service layer: `type='provider'` requires a non-null `linked_staff_id` referencing an active staff row; other types must have it null.

### 4.2 `services` — the bookable catalog

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `name` | varchar(120) | |
| `description` | text, nullable | |
| `category` | varchar, nullable | e.g. "Hair", "Consultation", "Therapy" |
| `duration_minutes` | integer | |
| `buffer_before_minutes` | integer, default 0 | prep/turnaround before |
| `buffer_after_minutes` | integer, default 0 | cleanup after |
| `is_active` | bool, default true | |
| `created_at`, `updated_at`, `deleted_at` | timestamptz | |

### 4.3 `service_resource_requirements` — default resource set per service

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `service_id` | uuid FK→`services.id` ON DELETE CASCADE | |
| `resource_type` | varchar | matches `resources.type` values |
| `quantity` | integer, default 1 | |
| `is_required` | bool, default true | |
| `created_at`, `updated_at`, `deleted_at` | timestamptz | |

This is a **template** (e.g. "Consultation needs 1×provider + 1×room"). Staff can override the actual resource set at booking time. Drives the booking form's defaults, not a hard rule.

### 4.4 `working_hours` — weekly recurring availability

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `resource_id` | uuid FK→`resources.id` | |
| `day_of_week` | smallint | 0–6, Sun–Sat, matches `EXTRACT(DOW FROM ...)` |
| `start_time` | time | local time, interpreted in tenant TZ |
| `end_time` | time | |
| `valid_from` | date | the date this block takes effect |
| `valid_to` | date, nullable | NULL = open-ended |
| `created_at`, `updated_at`, `deleted_at` | timestamptz | |

Multiple rows per resource per day (e.g. morning + afternoon block). The `valid_from`/`valid_to` window lets a contract change take effect ("from next month my hours change") without rewriting history; future bookings respect the new window while past appointments retain their context.

### 4.5 `time_off` — absolute exceptions

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `resource_id` | uuid FK→`resources.id` | |
| `start_at` | timestamptz | absolute |
| `end_at` | timestamptz | absolute |
| `reason` | varchar, nullable | PTO, holiday, closure |
| `created_at`, `updated_at`, `deleted_at` | timestamptz | |

### 4.6 `appointments` — the header

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `client_id` | uuid FK→`clients.id`, nullable | nullable for walk-ins |
| `primary_resource_id` | uuid FK→`resources.id` | convenience for filtering/display |
| `service_id` | uuid FK→`services.id`, nullable | nullable for custom appointments |
| `start_at` | timestamptz | the "real" appointment start (display + read) |
| `end_at` | timestamptz | `start_at + service.duration_minutes` (or manual if no service) |
| `status` | varchar | enum validated against state machine |
| `summary` | varchar, nullable | short title override |
| `notes` | text, nullable | internal notes |
| `cancellation_reason` | varchar, nullable | set when status→cancelled |
| `created_by_staff_id` | uuid FK→`staff.id` | actor of creation |
| `created_at`, `updated_at`, `deleted_at` | timestamptz | |

`status` ∈ {`requested`, `confirmed`, `checked_in`, `in_progress`, `completed`, `cancelled`, `no_show`}.

### 4.7 `appointment_resources` — the join, and the conflict boundary ⭐

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `appointment_id` | uuid FK→`appointments.id` ON DELETE CASCADE | |
| `resource_id` | uuid FK→`resources.id` | |
| `booked_range` | tstzrange | `[start_at − buffer_before, end_at + buffer_after)` |
| `role` | varchar | `'primary' \| 'assistant' \| 'room' \| ...` |
| `created_at`, `deleted_at` | timestamptz | |

Constraints:
- `UNIQUE(appointment_id, resource_id)` — a resource appears at most once per appointment.
- **GiST exclusion constraint (the race-proof core):**

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE appointment_resources
  ADD CONSTRAINT no_overlapping_active_bookings
  EXCLUDE USING gist (
    resource_id WITH =,
    booked_range WITH &&
  ) WHERE (deleted_at IS NULL);
```

**Cancellation frees a resource via soft-delete.** When an appointment transitions to `cancelled` or `no_show`, the service layer **soft-deletes** that appointment's `appointment_resources` rows (`SET deleted_at = now()`). The partial constraint (`WHERE deleted_at IS NULL`) then ignores them, so the slot frees up while the history row is retained. `completed` appointments keep their rows, but since their `booked_range` is in the past, no future booking can overlap it — harmless.

**Reschedule** = within one transaction, soft-delete the old `appointment_resources` rows *first*, then insert new ones with the updated `booked_range`, then update the `appointments` row. Soft-deleting first avoids a transient self-conflict (rows belonging to the same appointment would momentarily overlap themselves). The constraint is checked at row time, so ordering matters.

**`booked_range` ownership (Option A, approved).** `booked_range` is a regular column, not generated — Postgres cannot make it a `GENERATED ALWAYS` column from two *other tables* (`appointments` + `services`). The service layer computes it on write. `start_at`/`end_at` on the appointment are the "real" times; `booked_range` is derived from them + service buffers. Drift is contained by convention: **no direct PATCH on times except via `rescheduleAppointment()`**, which updates both atomically. The reschedule function is the single owner of `booked_range` mutation.

### 4.8 `appointment_status_history` — transition audit trail

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `appointment_id` | uuid FK→`appointments.id` ON DELETE CASCADE | |
| `from_status` | varchar, nullable | NULL on creation |
| `to_status` | varchar | |
| `changed_by_staff_id` | uuid FK→`staff.id` | |
| `note` | text, nullable | |
| `created_at` | timestamptz | |

One row per transition. Staff booking creation writes `from=NULL, to='confirmed'`. This is the source of the "where is this client right now" timeline.

### 4.9 `tenant_settings` — tenant configuration

A small key/value table for tenant-level business configuration. Phase 1 carries only `timezone`; future phases may add booking window defaults, cancellation policy, etc.

| Column | Type | Notes |
|---|---|---|
| `key` | varchar PK | e.g. `'timezone'` |
| `value` | varchar | e.g. `'Europe/Bucharest'` |
| `updated_at` | timestamptz | |

A typed accessor `getTenantTimezone(tenantDb)` reads the `timezone` row, defaulting to a platform default (configurable via env, fallback `'UTC'`) if unset.

---

## 5. Service layer

The `modules/scheduling/` module contains two files — `state-machine.ts` (pure transition graph) and `service.ts` (transactional core) — both pure functions taking a typed `TenantDb` handle, no Fastify deps, mirroring `modules/staff` and `modules/clients`. Supporting CRUD logic lives in the separate `modules/resources/`, `modules/services-catalog/`, and `modules/availability/` modules (covered in 5.3).

### 5.1 `state-machine.ts` — the explicit transition graph

A pure, data-driven table of legal transitions — the single source of truth for "can this appointment move from X to Y." No scattered `if` statements.

```
TRANSITIONS = {
  requested:  { confirm: 'confirmed', cancel: 'cancelled' },
  confirmed:  { check_in: 'checked_in', start: 'in_progress',
                cancel: 'cancelled', no_show: 'no_show', reschedule: 'confirmed' },
  checked_in: { start: 'in_progress', cancel: 'cancelled', no_show: 'no_show' },
  in_progress:{ complete: 'completed' },
  completed:  {},                       // terminal
  cancelled:  {},                       // terminal
  no_show:    {},                       // terminal (no automatic revive)
}

canTransition(from, action) → bool
assertCanTransition(from, action) → throws HttpError(409, 'INVALID_TRANSITION', ...)
```

`requested` is included for forward-compat (client self-booking in phase 5), but **staff booking always creates directly in `confirmed`**, so it is not reachable in phase 1. Transitions are unit-tested as a full matrix.

### 5.2 `service.ts` — the transactional core

Four operations, each a single DB transaction. `actorStaffId` comes from `req.userClaims.sub` (existing pattern).

**`createAppointment(tenantDb, input, actorStaffId)`**

```
tx:
  1. resolve service (if service_id) → duration_minutes + buffer_before + buffer_after
  2. resolve requested resources:
       - primary resource (required) from input.resourceId
       - additional resources from input.additionalResourceIds (may be empty)
       - if service_id present and additionalResourceIds empty:
           auto-fill from service_resource_requirements (excluding the primary's type slot)
  3. validate each resource: exists, is_active, not soft-deleted
  4. determine duration:
       - if service_id present → service.duration_minutes (buffers from service too)
       - if service_id null → require input.durationMinutes; buffers default to 0
       (a service-less appointment with no explicit duration → INVALID_BOOKING 422)
  5. compute end_at = start_at + duration
  6. compute booked_range per resource = [start_at − buffer_before, end_at + buffer_after)
  7. friendly pre-check: query overlapping active appointment_resources for each resource
       (returns named conflicting resources + appointments for a good error)
  8. INSERT appointment (status='confirmed', created_by=actor)
  9. INSERT appointment_resources rows   ← GiST constraint rejects any overlap here (race backstop)
  10. INSERT appointment_status_history (from=NULL, to='confirmed')
commit
auditLog('appointment.create')
on constraint violation → 409 APPOINTMENT_CONFLICT with named conflicting resources (re-query)
```

The friendly pre-check runs *before* the insert so the common conflict case returns a named, actionable error ("Conflicts with: Dr. X's 14:00 visit") instead of the bare constraint message. The constraint then catches the rare race between pre-check and insert.

**`rescheduleAppointment(id, newStartAt, actorStaffId)`**

```
tx:
  1. assertCanTransition(currentStatus, 'reschedule')
  2. recompute end_at + booked_range from the same service (or manual duration if no service)
  3. DELETE (soft) old appointment_resources WHERE appointment_id = id   ← frees old window first
  4. friendly pre-check on the new window
  5. INSERT new appointment_resources with updated booked_range           ← constraint re-checked
  6. UPDATE appointment SET start_at, end_at
  7. INSERT history (from=current, to=current, note='rescheduled to <time>')
commit
auditLog('appointment.reschedule')
```

Soft-deleting old rows *first* avoids the self-conflict: the old window exits the partial constraint's view before the new window is inserted.

**`transitionStatus(id, action, actorStaffId, { note, reason })`**

```
tx:
  1. load current status
  2. assertCanTransition(current, action) → derive toStatus
  3. if action ∈ {cancel, no_show}:
       soft-delete appointment_resources rows   ← frees the slot under the partial constraint
       if action=cancel: set cancellation_reason
  4. UPDATE appointment SET status = toStatus
  5. INSERT history (from=current, to=toStatus, note, reason)
commit
auditLog('appointment.<action>')
```

**`listAppointments(filters)`** — read-only: by date range (`from`/`to`), by `resourceId`, by `clientId`, by `status`. Paginated. Reads `start_at`/`end_at` from the appointment header (not the range column) for display simplicity.

### 5.3 Supporting CRUD services

`modules/resources/`, `modules/services-catalog/`, `modules/availability/` each expose standard CRUD. Notable rules:

- **Resource soft-delete guard:** `DELETE /resources/:id` returns `409 RESOURCE_HAS_ACTIVE_BOOKINGS` if any non-terminal appointment references it. Safe only when all its bookings are terminal (`completed`/`cancelled`/`no_show`) and their `appointment_resources` rows are soft-deleted, or all bookings are in the past.
- **Service soft-delete guard:** `DELETE /services/:id` returns `409 SERVICE_HAS_FUTURE_APPOINTMENTS` if referenced by any future appointment.
- **`service_resource_requirements`** is edited via full-replace `PUT /services/:id/requirements`, not individual row POST/DELETE.
- **`type='provider'` resources** require `linked_staff_id` referencing an active staff row; other types must have it null. Enforced in the service layer.

---

## 6. API surface

REST under `/v1`, following the thin-routes → controller → service pattern. Every route gated through `requireAppointments(req, roles)` (composes `requireTenantUser` + `isEnabled(APPOINTMENTS)`).

### 6.1 Resources

```
GET    /v1/resources                ?type=&include_inactive=false
POST   /v1/resources                admin   { name, type, linkedStaffId?, color?, notes? }
GET    /v1/resources/:id
PATCH  /v1/resources/:id            admin   (partial; type immutable post-create)
DELETE /v1/resources/:id            admin   (soft delete; 409 if active bookings reference it)
```

### 6.2 Services catalog

```
GET    /v1/services                 ?category=&include_inactive=false
POST   /v1/services                 admin   { name, category?, durationMinutes, bufferBefore?, bufferAfter?, ... }
GET    /v1/services/:id
PATCH  /v1/services/:id             admin
DELETE /v1/services/:id             admin   (soft delete; 409 if referenced by future appointments)

GET    /v1/services/:id/requirements
PUT    /v1/services/:id/requirements   admin, full replace   [{ resourceType, quantity, isRequired }]
```

### 6.3 Availability

```
GET    /v1/resources/:id/working-hours        ?valid_on=date
POST   /v1/resources/:id/working-hours        admin   { dayOfWeek, startTime, endTime, validFrom?, validTo? }
PATCH  /v1/working-hours/:id                   admin   (partial; can extend/cap validTo)
DELETE /v1/working-hours/:id                   admin   (soft delete)

GET    /v1/resources/:id/time-off
POST   /v1/resources/:id/time-off             admin   { startAt, endAt, reason? }
DELETE /v1/time-off/:id                        admin   (soft delete)
```

### 6.4 Appointments

```
GET    /v1/appointments            ?from=&to=&resourceId=&clientId=&status=   (paginated)
GET    /v1/appointments/:id        (includes its resources + latest status)
POST   /v1/appointments            tenant_user + tenant_admin
PATCH  /v1/appointments/:id        discriminated {action} body (see below)
GET    /v1/appointments/:id/history
```

**`POST /v1/appointments` body:**

```json
{
  "clientId": "uuid?",
  "serviceId": "uuid?",
  "resourceId": "uuid",
  "additionalResourceIds": ["uuid"]?,
  "startAt": "2026-07-10T14:00:00Z",
  "durationMinutes": 60?,
  "summary": "string?",
  "notes": "string?"
}
```

`clientId` and `serviceId` are nullable (walk-ins, custom appointments). `resourceId` (primary) is required. `additionalResourceIds` is optional; when `serviceId` is present and `additionalResourceIds` is empty/absent, the service auto-fills from `service_resource_requirements` (excluding the primary's type slot). `durationMinutes` is required **only when `serviceId` is null** (custom appointment with no duration source); it is ignored when `serviceId` is present. A null-`serviceId` request without `durationMinutes` returns `422 INVALID_BOOKING`.

**`PATCH /v1/appointments/:id` body — discriminated union on `action`:**

```jsonc
{ "action": "cancel",     "reason": "string?" }
{ "action": "check_in",   "note": "string?" }
{ "action": "start",      "note": "string?" }
{ "action": "complete",   "note": "string?" }
{ "action": "no_show",    "note": "string?" }
{ "action": "reschedule", "startAt": "2026-07-12T10:00:00Z" }
```

One endpoint, one auth guard, one audit hook. The Zod schema is a discriminated union on `action`; the controller dispatches to the matching service function (`rescheduleAppointment` for `reschedule`, `transitionStatus` for the rest). This matches the `clients`/`staff` PATCH convention and stops route proliferation.

### 6.5 Permission model

| Operation | Roles |
|---|---|
| Create appointment | `tenant_user`, `tenant_admin` |
| Transition/reschedule appointment | `tenant_user`, `tenant_admin` |
| Read appointments/resources/services/schedule | `tenant_user`, `tenant_admin` |
| Manage resources catalog | `tenant_admin` only |
| Manage services catalog | `tenant_admin` only |
| Manage working hours / time off | `tenant_admin` only |
| Tenant settings (timezone) | `tenant_admin` only |

Per-provider calendar visibility (restricting a `tenant_user` to only their own resource's appointments) is **not** modeled in phase 1 — the role system is coarse-grained today. If needed, it is enforced in the `listAppointments` query handler using `req.userClaims.sub` → `staff.id` → `resources.linked_staff_id` mapping. This is called out as an open question, not a committed feature.

---

## 7. Error handling

Stable, i18n-mappable error codes via `lib/errors.ts`. Each is a factory returning an `HttpError` with a machine-readable `code` and English `message` fallback.

| Code | HTTP | Meaning |
|---|---|---|
| `RESOURCE_NOT_FOUND` | 404 | resource id doesn't exist / soft-deleted |
| `SERVICE_NOT_FOUND` | 404 | service id doesn't exist |
| `APPOINTMENT_NOT_FOUND` | 404 | appointment id doesn't exist |
| `CLIENT_NOT_FOUND` | 404 | reuse existing factory |
| `STAFF_NOT_FOUND` | 404 | reuse existing factory |
| `RESOURCE_HAS_ACTIVE_BOOKINGS` | 409 | trying to soft-delete a resource with non-terminal appointments |
| `SERVICE_HAS_FUTURE_APPOINTMENTS` | 409 | trying to soft-delete a service referenced by future appts |
| `APPOINTMENT_CONFLICT` | 409 | overlap on a resource; details name the conflicting resource(s) + appointment |
| `INVALID_TRANSITION` | 409 | illegal status transition per the state machine |
| `INVALID_BOOKING` | 422 | e.g. start_at in the past, end before start, missing required resources |

`APPOINTMENT_CONFLICT` carries `details.conflicting_resources` — an array of `{ resource_id, name, type, conflicts_with: { appointment_id, start_at, end_at } }` — so the UI can show "Conflicts with: Dr. X's 14:00 visit" rather than a bare rejection. When the GiST constraint fires (the race case), the service catches the Postgres error and re-queries to populate these details.

### Audit logging

Every state change emits exactly one `auditLog(req, {...})` **after** the transaction commits. The `action` field uses the action name (not the resulting status) for unambiguity: `appointment.create`, `appointment.reschedule`, `appointment.cancel`, `appointment.check_in`, `appointment.start`, `appointment.complete`, `appointment.no_show`.

---

## 8. Cross-cutting concerns

- **Timestamps:** all `timestamptz` stored UTC. The tenant TZ (from `tenant_settings.timezone`, resolved via `getTenantTimezone(tenantDb)`) governs date-boundary queries (e.g. "appointments on Tuesday"). DST handled by Postgres `AT TIME ZONE` for boundary math.
- **Migrations:** `0005_btree_gist.sql` (the extension) + `0006_scheduling.sql` (tables + GiST constraint). Both run per-tenant via the existing `migrateTenantDb()` loop as the owner role (which can `CREATE EXTENSION`). `btree_gist` is also added to `tenant_template` so new tenants get it at provisioning.
- **Feature flag:** all scheduling routes return 404 when `APPOINTMENTS` is disabled (matches existing flag-gating behavior).
- **Tenant isolation:** inherited from the platform — no new mechanism needed. The per-tenant DB + app role guarantees no cross-tenant leakage; not re-tested per-module.

---

## 9. Testing strategy

The scheduling core is where correctness matters most; this module carries a denser-than-average test layer. Three tiers, all Vitest.

### Tier 1 — Pure unit tests (no DB)

- `state-machine.test.ts`: full transition matrix — every `(from, action)` pair asserted against `canTransition`. Catches any future edit that breaks the graph.
- Zod schema tests: the discriminated `PATCH {action}` union accepts all six actions, rejects unknown actions, enforces `startAt` on `reschedule`, types `reason`/`note` correctly.

### Tier 2 — Service-layer tests (real tenant DB transaction, rolled back)

Uses a real Postgres instance with `btree_gist` enabled. This is where the GiST constraint earns its keep:

- **Conflict matrix:** create appointment A on {stylist, chair} at 14:00; attempt B on the same resources at overlapping times → expect `APPOINTMENT_CONFLICT`. Attempt B on a *different* resource at the same time → success. Attempt B on the *same* resource at a non-overlapping time → success.
- **Buffer awareness:** A at 14:00–15:00 with 15-min buffer; B at 15:05 on the same resource → conflict (15:05 < 15:15); B at 15:15 → success. Proves `booked_range` extends past `end_at`.
- **Cross-type isolation:** two appointments on different rooms with the same provider at the same time → both fail (provider conflict). Proves per-resource independent checking.
- **Lifecycle:** walk an appointment through `confirmed → checked_in → in_progress → completed`; assert history rows written at each step with correct `from`/`to`/`changed_by`. Attempt an illegal transition (`completed → checked_in`) → `INVALID_TRANSITION` 409.
- **Reschedule:** reschedule to a free slot → success, old `appointment_resources` soft-deleted, new ones inserted, history row added. Reschedule to a conflicting slot → conflict, no state change.
- **Cancel frees the slot:** cancel A, then book B on the same resource/window → success. Proves soft-deleted rows exit the partial constraint.
- **Concurrency (the real test):** two parallel transactions booking the same resource/window → exactly one succeeds, the other gets `APPOINTMENT_CONFLICT`. This is the test that justifies the GiST approach.

### Tier 3 — Route/integration tests

- Happy-path HTTP for each endpoint (status code, response shape).
- Authz: `tenant_user` can create/transition appointments but cannot `POST /resources` (403); `tenant_admin` can.
- Feature-flag off → all scheduling routes return 404.
- Tenant isolation inherited from the platform; not re-tested here.

---

## 10. Open questions (deferred, on record)

These are intentionally out of scope. Naming them so the spec is honest about what phase 1 does **not** do:

1. **Slot availability endpoint + staff calendar UI** — phase 2. The compute-on-demand algorithm (`working_hours − time_off − appointments − buffers`, sliced by service duration) is built then, shaped by its actual consumer. No migration needed — the tables already support it.
2. **Per-provider calendar visibility** (restricting `tenant_user` to only their own resource's appointments) — not modeled in phase 1 due to the coarse role system. Can be enforced in the `listAppointments` query via `staff.id → resources.linked_staff_id` mapping if needed; flagged, not committed.
3. **Reminders, holds, no-show auto-flagging** — phase 3; needs the queue/notification infrastructure that does not exist today.
4. **Google Calendar two-way sync** — phase 4; needs an OAuth client and webhook pattern (both absent).
5. **Recurring appointment series** — phase 3+; needs a series-parent entity + exception model.
6. **Client self-service booking** — phase 5; needs unauthenticated access, slot holds, and the `requested → confirmed` flow.
7. **Cancellation policy enforcement** (deadline/fee) — dropped from phase 1. The `cancellation_deadline_minutes` column is **not** added; a future phase adds it when enforcement exists.
