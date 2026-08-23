# Scheduling Core (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Phase-1 scheduling core for tenant appointment booking — resources, services, working schedule, and appointments with a full state machine and race-proof multi-resource conflict prevention — across the multi-tenant platform.

**Architecture:** DB-per-tenant isolation (no `tenant_id` columns). All new tables in `db/schema/tenant/`, following the established `clients` module recipe (Drizzle `pgTable` → controller → route → register). Conflict prevention via a PostgreSQL GiST exclusion constraint on a `tstzrange` column — race-proof at the storage layer. A pure, data-driven state machine governs appointment transitions. Single `PATCH {action}` endpoint unifies all mutations (reschedule + status transitions + cancel).

**Tech Stack:** Fastify 5, Drizzle ORM, PostgreSQL 16 (+ `btree_gist` extension), Zod, TypeScript (strict, ESM with `.js` imports), Vitest. Frontend: React 18 + TanStack Query + Tailwind/Spectrum (minimal form only this phase).

**Spec:** `docs/superpowers/specs/2026-07-07-scheduling-core-design.md` — read it first.

**Working directory:** `E:\Repositories\Project Simi` (the `backend/` and `frontend/` subdirs are separate git repos; commit within each).

---

## File map

### Backend — schema (`backend/src/db/schema/tenant/`)
| File | Responsibility |
|---|---|
| `tstzrange.ts` | NEW — custom Drizzle type for `tstzrange` (PG range of timestamps) |
| `resources.ts` | NEW — typed bookable resources (provider/room/equipment/chair) |
| `services.ts` | NEW — bookable services catalog (duration, buffers) |
| `service-resource-requirements.ts` | NEW — default resource set per service (template) |
| `working-hours.ts` | NEW — weekly recurring availability per resource |
| `time-off.ts` | NEW — absolute exceptions (PTO, holidays) |
| `appointments.ts` | NEW — appointment header (client, status, times, notes) |
| `appointment-resources.ts` | NEW — join table carrying `booked_range` + GiST constraint |
| `appointment-status-history.ts` | NEW — transition audit trail |
| `tenant-settings.ts` | NEW — key/value tenant config (timezone) |
| `index.ts` | MODIFY — re-export new tables, add to `tenantSchema` barrel |

### Backend — migrations (`backend/src/db/migrations/tenant/`)
| File | Responsibility |
|---|---|
| `0005_*.sql` (generated, then hand-edited) | Tables + `CREATE EXTENSION btree_gist` + GiST exclusion constraint |
| `meta/_journal.json`, `meta/0005_snapshot.json` | MODIFY — drizzle-kit updates these on generate |

### Backend — modules (`backend/src/modules/`)
| File | Responsibility |
|---|---|
| `scheduling/state-machine.ts` | NEW — pure transition graph + `canTransition` guard |
| `scheduling/state-machine.test.ts` | NEW — full transition matrix unit tests |
| `scheduling/schema.ts` | NEW — Zod request/response schemas for appointments |
| `scheduling/schema.test.ts` | NEW — discriminated union validation tests |
| `scheduling/service.ts` | NEW — create, reschedule, transition, list (transactional core) |
| `scheduling/service.test.ts` | NEW — conflict/buffer/lifecycle/reschedule/concurrency tests |
| `resources/service.ts` | NEW — resources CRUD + soft-delete-with-active-bookings guard |
| `resources/schema.ts` | NEW — Zod schemas for resources |
| `services-catalog/service.ts` | NEW — services CRUD + requirements full-replace |
| `services-catalog/schema.ts` | NEW — Zod schemas for services |
| `availability/service.ts` | NEW — working_hours + time_off CRUD |
| `availability/schema.ts` | NEW — Zod schemas for availability |
| `availability/timezone.ts` | NEW — `getTenantTimezone(db)` accessor |

### Backend — controllers & routes (`backend/src/controllers/`, `backend/src/routes/`)
| File | Responsibility |
|---|---|
| `controllers/resources.controller.ts` | NEW |
| `controllers/services.controller.ts` | NEW |
| `controllers/availability.controller.ts` | NEW |
| `controllers/appointments.controller.ts` | NEW |
| `routes/resources.routes.ts` | NEW |
| `routes/services.routes.ts` | NEW |
| `routes/availability.routes.ts` | NEW |
| `routes/appointments.routes.ts` | NEW |
| `routes/index.ts` | MODIFY — register 4 new route groups |

### Backend — lib
| File | Responsibility |
|---|---|
| `lib/errors.ts` | MODIFY — add 9 scheduling error factories |
| `lib/flags.ts` | MODIFY — add `APPOINTMENTS` to `FeatureFlag` |
| `lib/flag-catalog.ts` | MODIFY — add `APPOINTMENTS` catalog entry |
| `lib/require-appointments.ts` | NEW — composes `requireTenantUser` + `isEnabled(APPOINTMENTS)` |

### Frontend
| File | Responsibility |
|---|---|
| `frontend/src/features/calendar/CreateAppointmentForm.tsx` | NEW — minimal form wired to `POST /v1/appointments` |
| `frontend/src/lib/api.ts` | MODIFY — add `createAppointment()` etc. |

---

## Conventions to follow (from existing code)

- **Imports:** ESM, `.js` extensions in relative paths; `@db/*`, `@modules/*`, `@lib/*`, `@config/*` path aliases exist. Use `import type` for type-only imports (`verbatimModuleSyntax`).
- **Schema files:** `pgTable('snake_case', {...}, (t) => ({...indexes}))`; export `type X = typeof x.$inferSelect` and `type NewX = typeof x.$inferInsert`.
- **Soft delete:** `deletedAt timestamp('deleted_at', { withTimezone: true })`; query with `isNull(t.deletedAt)`; partial unique indexes `.where(isNull(t.deletedAt))`.
- **Controllers:** `export const xController = { async list(req, reply) {...} }`. Parse body with `schema.parse(req.body)`. Use `req.tenantDb!`. Call `auditLog(req, {...})` exactly once after the write. Throw `HttpError`s from `lib/errors.ts`.
- **Routes:** `export async function xRoutes(app: FastifyInstance): Promise<void>`. `preHandler: async (req) => requireTenantUser(req, { roles: [...] })`.
- **Errors:** each factory returns `new HttpError(status, 'STABLE_CODE', 'Message', details?)`.
- **Transactions:** `await req.tenantDb!.transaction(async (tx) => { ... })`.
- **Migrations:** hand-rolled SQL files with `--> statement-breakpoint` separators; the journal (`meta/_journal.json`) and snapshot (`meta/000X_snapshot.json`) are managed by `drizzle-kit generate`.

---

## Task 1: Add the APPOINTMENTS feature flag

**Files:**
- Modify: `backend/src/lib/flags.ts`
- Modify: `backend/src/lib/flag-catalog.ts`

- [ ] **Step 1: Add `APPOINTMENTS` to the `FeatureFlag` enum**

In `backend/src/lib/flags.ts`, add `APPOINTMENTS: 'appointments'` to the `FeatureFlag` object (after `POS`):

```typescript
export const FeatureFlag = {
  RESERVATIONS: 'reservations',
  INVENTORY: 'inventory',
  POS: 'pos',
  APPOINTMENTS: 'appointments',
} as const;
```

- [ ] **Step 2: Add the matching catalog entry**

In `backend/src/lib/flag-catalog.ts`, add to the `FLAG_CATALOG` array (after the `POS` entry):

```typescript
  {
    key: FeatureFlag.APPOINTMENTS,
    label: 'Appointments',
    description: 'Book and manage appointments with multi-resource scheduling.',
    enabled: false,
  },
```

- [ ] **Step 3: Verify the boot-time consistency check passes**

Run: `cd backend && pnpm dev` (start the server briefly, then stop with Ctrl+C).
Expected: the startup log includes `Flag catalog synced` (or similar) with `inserted: 1` for the new `appointments` flag, and NO `FLAG_CATALOG / FeatureFlag mismatch` error. The `assertCatalogConsistency()` call at boot would throw if the enum and catalog disagree.

- [ ] **Step 4: Commit**

```bash
cd backend
git add src/lib/flags.ts src/lib/flag-catalog.ts
git commit -m "feat(flags): add APPOINTMENTS feature flag"
```

---

## Task 2: Add scheduling error factories

**Files:**
- Modify: `backend/src/lib/errors.ts`

- [ ] **Step 1: Add 9 scheduling error factories**

Append to `backend/src/lib/errors.ts` (after the `unknownFeatureKeys` factory, before EOF):

```typescript
// --- Scheduling ---

/** Scheduling: resource not found (or soft-deleted). */
export const resourceNotFound = () =>
  new HttpError(404, 'RESOURCE_NOT_FOUND', 'Resource not found.');

/** Scheduling: service not found (or soft-deleted). */
export const serviceNotFound = () =>
  new HttpError(404, 'SERVICE_NOT_FOUND', 'Service not found.');

/** Scheduling: appointment not found (or soft-deleted). */
export const appointmentNotFound = () =>
  new HttpError(404, 'APPOINTMENT_NOT_FOUND', 'Appointment not found.');

/** Scheduling: working-hours or time-off row not found. */
export const scheduleEntryNotFound = () =>
  new HttpError(404, 'SCHEDULE_ENTRY_NOT_FOUND', 'Schedule entry not found.');

/** Scheduling: cannot delete a resource that has non-terminal appointments. */
export const resourceHasActiveBookings = (count: number) =>
  new HttpError(409, 'RESOURCE_HAS_ACTIVE_BOOKINGS', `Resource has ${count} active booking(s) and cannot be deleted.`);

/** Scheduling: cannot delete a service referenced by future appointments. */
export const serviceHasFutureAppointments = (count: number) =>
  new HttpError(409, 'SERVICE_HAS_FUTURE_APPOINTMENTS', `Service is referenced by ${count} future appointment(s) and cannot be deleted.`);

/** Scheduling: a resource is already booked for the requested window. */
export const appointmentConflict = (conflicts: unknown) =>
  new HttpError(409, 'APPOINTMENT_CONFLICT', 'The requested time conflicts with an existing booking.', conflicts);

/** Scheduling: illegal status transition per the state machine. */
export const invalidTransition = (from: string, action: string) =>
  new HttpError(409, 'INVALID_TRANSITION', `Cannot perform '${action}' on an appointment in status '${from}'.`);

/** Scheduling: the booking request is malformed (past date, no duration, etc.). */
export const invalidBooking = (message: string, details?: unknown) =>
  new HttpError(422, 'INVALID_BOOKING', message, details);
```

- [ ] **Step 2: Verify it type-checks**

Run: `cd backend && pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd backend
git add src/lib/errors.ts
git commit -m "feat(errors): add scheduling error factories"
```

---

## Task 3: Add the `requireAppointments` guard helper

**Files:**
- Create: `backend/src/lib/require-appointments.ts`

- [ ] **Step 1: Write the guard**

Create `backend/src/lib/require-appointments.ts`:

```typescript
import type { FastifyRequest } from 'fastify';
import { requireTenantUser } from '../plugins/auth.js';
import type { Role } from './roles.js';
import { isEnabled } from './flags.js';
import { FeatureFlag } from './flags.js';
import { notFound } from './errors.js';

/**
 * Compose the two scheduling guards: a valid tenant user in the allowed roles,
 * AND the APPOINTMENTS feature flag enabled for this tenant. When the flag is
 * off, scheduling routes return 404 (the feature is invisible) rather than 403
 * — matching how a disabled feature should appear not to exist.
 *
 * Returns a Fastify preHandler function.
 */
export function requireAppointments(options: { roles?: Role[] } = {}) {
  return async (req: FastifyRequest): Promise<void> => {
    requireTenantUser(req, options);
    if (!isEnabled(req, FeatureFlag.APPOINTMENTS)) {
      throw notFound();
    }
  };
}
```

Note: returning 404 when the flag is off matches the platform convention — a disabled feature is invisible, not forbidden.

- [ ] **Step 2: Verify it type-checks**

Run: `cd backend && pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd backend
git add src/lib/require-appointments.ts
git commit -m "feat(scheduling): add requireAppointments guard"
```

---

## Task 4: Add the `tstzrange` custom Drizzle type

**Files:**
- Create: `backend/src/db/schema/tenant/tstzrange.ts`

- [ ] **Step 1: Write the custom type**

Create `backend/src/db/schema/tenant/tstzrange.ts`:

```typescript
import { customType } from 'drizzle-orm/pg-core';

/**
 * Custom Drizzle type for PostgreSQL `tstzrange` (a range of timestamps with
 * time zone). Used by `appointment_resources.booked_range` to power the GiST
 * exclusion constraint that prevents double-booking.
 *
 * Values are exchanged as PG range literals, e.g.:
 *   [2026-07-10T14:00:00+00:00,2026-07-10T15:00:00+00:00)
 *
 * We store the lower bound inclusive `[` and upper bound exclusive `)`. The
 * service layer constructs the literal string from two Date objects; reads are
 * rare (the slot engine is deferred), so we return the raw string for now.
 */
export const tstzrange = customType<{
  data: string; // PG range literal, e.g. "[2026-...,2026-...)"
  driverData: string;
}>({
  dataType() {
    return 'tstzrange';
  },
});

/**
 * Build a PG tstzrange literal from two Dates: [start, end) —
 * lower-inclusive, upper-exclusive. This matches how the GiST `&&` (overlaps)
 * operator expects adjacent bookings to butt up without conflicting.
 */
export function rangeLiteral(start: Date, end: Date): string {
  // toISOString() yields e.g. 2026-07-10T14:00:00.000Z — PG accepts this in a
  // tstzrange literal.
  return `[${start.toISOString()},${end.toISOString()})`;
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `cd backend && pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd backend
git add src/db/schema/tenant/tstzrange.ts
git commit -m "feat(scheduling): add tstzrange custom Drizzle type"
```

---

## Task 5: Schema — `tenant_settings`, `resources`, `services`, `service_resource_requirements`

**Files:**
- Create: `backend/src/db/schema/tenant/tenant-settings.ts`
- Create: `backend/src/db/schema/tenant/resources.ts`
- Create: `backend/src/db/schema/tenant/services.ts`
- Create: `backend/src/db/schema/tenant/service-resource-requirements.ts`

- [ ] **Step 1: Write `tenant_settings.ts`**

Create `backend/src/db/schema/tenant/tenant-settings.ts`:

```typescript
import { pgTable, varchar, timestamp } from 'drizzle-orm/pg-core';

/**
 * Tenant-level business configuration (key/value). Physically isolated per
 * tenant (lives in the tenant DB). Phase 1 carries only `timezone`
 * (e.g. 'Europe/Bucharest'); future phases may add booking-window defaults,
 * cancellation policy, etc.
 */
export const tenantSettings = pgTable('tenant_settings', {
  key: varchar('key', { length: 80 }).primaryKey(),
  value: varchar('value', { length: 255 }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type TenantSetting = typeof tenantSettings.$inferSelect;
export type NewTenantSetting = typeof tenantSettings.$inferInsert;
```

- [ ] **Step 2: Write `resources.ts`**

Create `backend/src/db/schema/tenant/resources.ts`:

```typescript
import { pgTable, uuid, varchar, boolean, text, timestamp, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/**
 * Resources — the typed, BOOKABLE things in a tenant. A booking reserves a set
 * of these. Types: 'provider' (a staff member), 'room', 'equipment', 'chair'.
 *
 * `linked_staff_id` bridges to the existing `staff` table: it is present ONLY
 * when type='provider' (a provider resource IS a bookable view of a staff
 * member). Non-staff resources have it null. Enforced in the service layer.
 *
 * Soft-deleted resources are excluded from new bookings and listings.
 */
export const RESOURCES_TYPE_VALUES = ['provider', 'room', 'equipment', 'chair'] as const;
export type ResourceType = (typeof RESOURCES_TYPE_VALUES)[number];

export const resources = pgTable(
  'resources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 120 }).notNull(),
    type: varchar('type', { length: 30 }).notNull().$type<ResourceType>(),
    linkedStaffId: uuid('linked_staff_id'),
    isActive: boolean('is_active').notNull().default(true),
    color: varchar('color', { length: 20 }),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    typeIdx: index('resources_type_idx').on(t.type),
    linkedStaffIdx: index('resources_linked_staff_idx').on(t.linkedStaffId),
  }),
);

export type Resource = typeof resources.$inferSelect;
export type NewResource = typeof resources.$inferInsert;
```

- [ ] **Step 3: Write `services.ts`**

Create `backend/src/db/schema/tenant/services.ts`:

```typescript
import { pgTable, uuid, varchar, integer, boolean, text, timestamp, index } from 'drizzle-orm/pg-core';
import { isNull } from 'drizzle-orm';

/**
 * Services — the tenant's bookable catalog (e.g. 'Haircut', 'Consultation',
 * 'Deep Tissue Massage'). Carries duration and buffer (prep/cleanup) minutes.
 *
 * A service also has a default set of required resource types
 * (service_resource_requirements) used to pre-fill the booking form — but staff
 * can override the actual resources at booking time.
 */
export const services = pgTable(
  'services',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 120 }).notNull(),
    description: text('description'),
    category: varchar('category', { length: 80 }),
    durationMinutes: integer('duration_minutes').notNull(),
    bufferBeforeMinutes: integer('buffer_before_minutes').notNull().default(0),
    bufferAfterMinutes: integer('buffer_after_minutes').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    categoryIdx: index('services_category_idx').on(t.category).where(isNull(t.deletedAt)),
  }),
);

export type Service = typeof services.$inferSelect;
export type NewService = typeof services.$inferInsert;
```

- [ ] **Step 4: Write `service-resource-requirements.ts`**

Create `backend/src/db/schema/tenant/service-resource-requirements.ts`:

```typescript
import { pgTable, uuid, varchar, integer, boolean, timestamp } from 'drizzle-orm/pg-core';
import { services } from './services.js';
import type { ResourceType } from './resources.js';

/**
 * Default resource set per service — a TEMPLATE for the booking form. E.g.
 * 'Consultation' requires 1×provider + 1×room. Staff can override the actual
 * resources at booking time; this only drives defaults.
 */
export const serviceResourceRequirements = pgTable('service_resource_requirements', {
  id: uuid('id').primaryKey().defaultRandom(),
  serviceId: uuid('service_id').notNull().references(() => services.id, { onDelete: 'cascade' }),
  resourceType: varchar('resource_type', { length: 30 }).notNull().$type<ResourceType>(),
  quantity: integer('quantity').notNull().default(1),
  isRequired: boolean('is_required').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type ServiceResourceRequirement = typeof serviceResourceRequirements.$inferSelect;
export type NewServiceResourceRequirement = typeof serviceResourceRequirements.$inferInsert;
```

- [ ] **Step 5: Verify it type-checks**

Run: `cd backend && pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
cd backend
git add src/db/schema/tenant/tenant-settings.ts src/db/schema/tenant/resources.ts src/db/schema/tenant/services.ts src/db/schema/tenant/service-resource-requirements.ts
git commit -m "feat(scheduling): add tenant_settings, resources, services, requirements schemas"
```

---

## Task 6: Schema — `working_hours`, `time_off`

**Files:**
- Create: `backend/src/db/schema/tenant/working-hours.ts`
- Create: `backend/src/db/schema/tenant/time-off.ts`

- [ ] **Step 1: Write `working-hours.ts`**

Create `backend/src/db/schema/tenant/working-hours.ts`:

```typescript
import { pgTable, uuid, smallint, date, time, timestamp, index } from 'drizzle-orm/pg-core';
import { resources } from './resources.js';

/**
 * Working hours — weekly RECURRING availability for a resource. Multiple rows
 * per resource per day (e.g. a morning block + an afternoon block). `day_of_week`
 * is 0–6 (Sun–Sat) matching PostgreSQL's `EXTRACT(DOW FROM ...)` so the slot
 * engine (phase 2) can join directly.
 *
 * `valid_from`/`valid_to` lets a contract change take effect on a future date
 * without rewriting history: future bookings respect the new window while past
 * appointments keep their context. NULL `valid_to` = open-ended.
 *
 * `start_time`/`end_time` are local TIME (no date, no tz); they are interpreted
 * in the tenant's timezone at query time.
 */
export const workingHours = pgTable(
  'working_hours',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    resourceId: uuid('resource_id').notNull().references(() => resources.id, { onDelete: 'cascade' }),
    dayOfWeek: smallint('day_of_week').notNull(),
    startTime: time('start_time', { withTimezone: false }).notNull(),
    endTime: time('end_time', { withTimezone: false }).notNull(),
    validFrom: date('valid_from').notNull(),
    validTo: date('valid_to'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    resourceIdx: index('working_hours_resource_idx').on(t.resourceId),
    dayIdx: index('working_hours_day_idx').on(t.dayOfWeek),
  }),
);

export type WorkingHour = typeof workingHours.$inferSelect;
export type NewWorkingHour = typeof workingHours.$inferInsert;
```

- [ ] **Step 2: Write `time-off.ts`**

Create `backend/src/db/schema/tenant/time-off.ts`:

```typescript
import { pgTable, uuid, varchar, timestamp, index } from 'drizzle-orm/pg-core';
import { resources } from './resources.js';

/**
 * Time off — ABSOLUTE exceptions to a resource's recurring availability: PTO,
 * holidays, one-off closures. `start_at`/`end_at` are absolute timestamps (UTC).
 * The slot engine subtracts these from the recurring blocks.
 */
export const timeOff = pgTable(
  'time_off',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    resourceId: uuid('resource_id').notNull().references(() => resources.id, { onDelete: 'cascade' }),
    startAt: timestamp('start_at', { withTimezone: true }).notNull(),
    endAt: timestamp('end_at', { withTimezone: true }).notNull(),
    reason: varchar('reason', { length: 200 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    resourceIdx: index('time_off_resource_idx').on(t.resourceId),
    startIdx: index('time_off_start_idx').on(t.startAt),
  }),
);

export type TimeOff = typeof timeOff.$inferSelect;
export type NewTimeOff = typeof timeOff.$inferInsert;
```

- [ ] **Step 3: Verify it type-checks**

Run: `cd backend && pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd backend
git add src/db/schema/tenant/working-hours.ts src/db/schema/tenant/time-off.ts
git commit -m "feat(scheduling): add working_hours and time_off schemas"
```

---

## Task 7: Schema — `appointments`, `appointment_resources`, `appointment_status_history`

**Files:**
- Create: `backend/src/db/schema/tenant/appointments.ts`
- Create: `backend/src/db/schema/tenant/appointment-resources.ts`
- Create: `backend/src/db/schema/tenant/appointment-status-history.ts`

- [ ] **Step 1: Write `appointments.ts`**

Create `backend/src/db/schema/tenant/appointments.ts`:

```typescript
import { pgTable, uuid, varchar, text, timestamp, index } from 'drizzle-orm/pg-core';
import { clients } from './clients.js';
import { resources } from './resources.js';
import { services } from './services.js';
import { staff } from './staff.js';

/**
 * Appointment status values. The legal transitions between these are defined
 * in modules/scheduling/state-machine.ts. `requested` is included for
 * forward-compat (client self-booking, phase 5) but is NOT reachable in phase 1
 * — staff booking always creates directly in `confirmed`.
 */
export const APPOINTMENT_STATUS_VALUES = [
  'requested',
  'confirmed',
  'checked_in',
  'in_progress',
  'completed',
  'cancelled',
  'no_show',
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUS_VALUES)[number];

/** Statuses whose appointment_resources rows count as "active" (occupying a slot). */
export const ACTIVE_STATUSES: AppointmentStatus[] = [
  'requested',
  'confirmed',
  'checked_in',
  'in_progress',
];

/**
 * Appointments — the header record. `start_at`/`end_at` are the "real" display
 * times; the per-resource booked window (including buffers) lives in
 * appointment_resources.booked_range. `client_id` and `service_id` are nullable
 * (walk-ins, custom appointments). `cancellation_reason` is set on cancel.
 */
export const appointments = pgTable(
  'appointments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: uuid('client_id').references(() => clients.id),
    primaryResourceId: uuid('primary_resource_id').notNull().references(() => resources.id),
    serviceId: uuid('service_id').references(() => services.id),
    startAt: timestamp('start_at', { withTimezone: true }).notNull(),
    endAt: timestamp('end_at', { withTimezone: true }).notNull(),
    status: varchar('status', { length: 20 }).notNull().$type<AppointmentStatus>().default('confirmed'),
    summary: varchar('summary', { length: 200 }),
    notes: text('notes'),
    cancellationReason: varchar('cancellation_reason', { length: 200 }),
    createdByStaffId: uuid('created_by_staff_id').notNull().references(() => staff.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    primaryResourceIdx: index('appointments_primary_resource_idx').on(t.primaryResourceId),
    clientIdx: index('appointments_client_idx').on(t.clientId),
    startIdx: index('appointments_start_idx').on(t.startAt),
    statusIdx: index('appointments_status_idx').on(t.status),
  }),
);

export type Appointment = typeof appointments.$inferSelect;
export type NewAppointment = typeof appointments.$inferInsert;
```

- [ ] **Step 2: Write `appointment-resources.ts`**

Create `backend/src/db/schema/tenant/appointment-resources.ts`:

```typescript
import { pgTable, uuid, varchar, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { isNull } from 'drizzle-orm';
import { appointments } from './appointments.js';
import { resources } from './resources.js';
import { tstzrange } from './tstzrange.js';

/**
 * Appointment ↔ Resource join. Each row represents one resource reserved for one
 * appointment, over the window `[start − buffer_before, end + buffer_after)`.
 *
 * This table carries the GiST exclusion constraint that makes double-booking
 * physically impossible (see migration 0005). The constraint is PARTIAL — it
 * only applies where `deleted_at IS NULL`, so cancelling an appointment (which
 * soft-deletes its rows here) frees the slot for rebooking.
 *
 * `booked_range` is a regular tstzrange column (PG can't generate it from two
 * other tables). The scheduling service computes and writes it; the reschedule
 * function is the SINGLE owner of its mutation (no direct time PATCH elsewhere).
 */
export const appointmentResources = pgTable(
  'appointment_resources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    appointmentId: uuid('appointment_id').notNull().references(() => appointments.id, { onDelete: 'cascade' }),
    resourceId: uuid('resource_id').notNull().references(() => resources.id),
    bookedRange: tstzrange('booked_range').notNull(),
    role: varchar('role', { length: 30 }).notNull().default('primary'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    // A resource appears at most once per appointment.
    appointmentResourceIdx: uniqueIndex('appointment_resources_uniq_idx')
      .on(t.appointmentId, t.resourceId),
    resourceIdx: undefined as unknown as never, // placeholder, see note below
  }),
);

export type AppointmentResource = typeof appointmentResources.$inferSelect;
export type NewAppointmentResource = typeof appointmentResources.$inferInsert;
```

**Note on the GiST constraint:** Drizzle's schema DSL cannot express `EXCLUDE USING gist`, so we DO NOT attempt it in the table definition. The constraint is added by hand in the generated migration (Task 9). Remove the `resourceIdx: undefined as unknown as never` placeholder line before generating the migration — it was only there as a reminder that additional indexes live in the migration. The final file should have ONLY the `appointmentResourceIdx` unique index in the callback:

```typescript
  (t) => ({
    appointmentResourceIdx: uniqueIndex('appointment_resources_uniq_idx')
      .on(t.appointmentId, t.resourceId),
  }),
```

- [ ] **Step 3: Write `appointment-status-history.ts`**

Create `backend/src/db/schema/tenant/appointment-status-history.ts`:

```typescript
import { pgTable, uuid, varchar, text, timestamp, index } from 'drizzle-orm/pg-core';
import { appointments } from './appointments.js';
import { staff } from './staff.js';
import type { AppointmentStatus } from './appointments.js';

/**
 * One row per appointment status transition. `from_status` is NULL on creation
 * (the initial row). This is the source of the "where is this client right now"
 * timeline the staff calendar displays.
 */
export const appointmentStatusHistory = pgTable(
  'appointment_status_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    appointmentId: uuid('appointment_id').notNull().references(() => appointments.id, { onDelete: 'cascade' }),
    fromStatus: varchar('from_status', { length: 20 }).$type<AppointmentStatus>(),
    toStatus: varchar('to_status', { length: 20 }).notNull().$type<AppointmentStatus>(),
    changedByStaffId: uuid('changed_by_staff_id').notNull().references(() => staff.id),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    appointmentIdx: index('appointment_status_history_appointment_idx').on(t.appointmentId),
  }),
);

export type AppointmentStatusHistory = typeof appointmentStatusHistory.$inferSelect;
export type NewAppointmentStatusHistory = typeof appointmentStatusHistory.$inferInsert;
```

- [ ] **Step 4: Verify it type-checks**

Run: `cd backend && pnpm tsc --noEmit`
Expected: no errors (after removing the placeholder line noted in Step 2).

- [ ] **Step 5: Commit**

```bash
cd backend
git add src/db/schema/tenant/appointments.ts src/db/schema/tenant/appointment-resources.ts src/db/schema/tenant/appointment-status-history.ts
git commit -m "feat(scheduling): add appointments, appointment_resources, status_history schemas"
```

---

## Task 8: Register new tables in the schema barrel

**Files:**
- Modify: `backend/src/db/schema/tenant/index.ts`

- [ ] **Step 1: Add re-exports and update the `tenantSchema` barrel**

In `backend/src/db/schema/tenant/index.ts`, add the new imports, re-exports, and `tenantSchema` entries. The final file should look like:

```typescript
/**
 * Tenant DB schema barrel — imported by drizzle.config.tenant.ts and used to
 * build the typed Drizzle instance for each per-tenant DB at runtime.
 *
 * Every export here must be a table that is intended to exist in tenant DBs
 * only. Do NOT import anything from the global schema.
 */
import { staff } from './staff.js';
import { clients } from './clients.js';
import { tenantSessions } from './tenant-sessions.js';
import { tenantSettings } from './tenant-settings.js';
import { resources } from './resources.js';
import { services } from './services.js';
import { serviceResourceRequirements } from './service-resource-requirements.js';
import { workingHours } from './working-hours.js';
import { timeOff } from './time-off.js';
import { appointments } from './appointments.js';
import { appointmentResources } from './appointment-resources.js';
import { appointmentStatusHistory } from './appointment-status-history.js';

export * from './staff.js';
export * from './clients.js';
export * from './tenant-sessions.js';
export * from './tenant-settings.js';
export * from './resources.js';
export * from './services.js';
export * from './service-resource-requirements.js';
export * from './working-hours.js';
export * from './time-off.js';
export * from './appointments.js';
export * from './appointment-resources.js';
export * from './appointment-status-history.js';

export { staff } from './staff.js';
export { clients } from './clients.js';
export { tenantSessions } from './tenant-sessions.js';
export { tenantSettings } from './tenant-settings.js';
export { resources } from './resources.js';
export { services } from './services.js';
export { serviceResourceRequirements } from './service-resource-requirements.js';
export { workingHours } from './working-hours.js';
export { timeOff } from './time-off.js';
export { appointments } from './appointments.js';
export { appointmentResources } from './appointment-resources.js';
export { appointmentStatusHistory } from './appointment-status-history.js';

export const tenantSchema = {
  staff,
  clients,
  tenantSessions,
  tenantSettings,
  resources,
  services,
  serviceResourceRequirements,
  workingHours,
  timeOff,
  appointments,
  appointmentResources,
  appointmentStatusHistory,
} as const;
```

- [ ] **Step 2: Verify it type-checks**

Run: `cd backend && pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd backend
git add src/db/schema/tenant/index.ts
git commit -m "feat(scheduling): register scheduling tables in tenant schema barrel"
```

---

## Task 9: Generate the migration and add the GiST exclusion constraint by hand

This is the most delicate task. Drizzle generates the table DDL, but the `tstzrange` column type and the GiST exclusion constraint need manual addition.

**Files:**
- Create: `backend/src/db/migrations/tenant/0005_*.sql` (drizzle-kit generates the name)
- Modify: `backend/src/db/migrations/tenant/0005_*.sql` (hand-edit to add extension + constraint)

- [ ] **Step 1: Generate the migration**

Run:
```bash
cd backend && pnpm db:generate:tenant
```
Expected: drizzle-kit prints a diff and writes a new `0005_<some_name>.sql` file plus updates `meta/_journal.json` and adds `meta/0005_snapshot.json`. Note the exact generated filename.

- [ ] **Step 2: Inspect the generated SQL**

Open `backend/src/db/migrations/tenant/0005_*.sql`. Verify it contains `CREATE TABLE` statements for all 8 new tables (`tenant_settings`, `resources`, `services`, `service_resource_requirements`, `working_hours`, `time_off`, `appointments`, `appointment_resources`, `appointment_status_history`) and that `appointment_resources.booked_range` is declared as `tstzrange`.

If `booked_range` is NOT `tstzrange` (e.g. drizzle-kit emitted something else), the custom type didn't take — revisit Task 4.

- [ ] **Step 3: Hand-edit the migration to add the extension and the GiST constraint**

At the TOP of `0005_*.sql`, add (before the first `CREATE TABLE`):

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
```

At the BOTTOM of `0005_*.sql` (after all `CREATE TABLE` / `CREATE INDEX` statements), add the exclusion constraint:

```sql
--> statement-breakpoint
ALTER TABLE "appointment_resources"
  ADD CONSTRAINT "no_overlapping_active_bookings"
  EXCLUDE USING gist (
    "resource_id" WITH =,
    "booked_range" WITH &&
  ) WHERE ("deleted_at" IS NULL);
```

- [ ] **Step 4: Apply the migration to the dev tenant DB**

Run:
```bash
cd backend && pnpm db:migrate
```
Expected: the migrate runner connects to each active tenant DB as its owner role and applies pending migrations. The log should show `✓ Tenant database up to date.` for each. If `btree_gist` is missing on the tenant cluster, this fails with `extension "btree_gist" must be installed` — install it on the cluster (`CREATE EXTENSION btree_gist;` run once as superuser on the tenant server, OR ensure the owner role has permission to create trusted extensions).

- [ ] **Step 5: Verify the constraint exists**

Run (substitute your dev tenant DB name):
```bash
cd backend && pnpm tsx -e "
import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.TENANT_DB_URL });
const r = await pool.query(\"SELECT conname FROM pg_constraint WHERE conname = 'no_overlapping_active_bookings'\");
console.log('constraint:', r.rows);
await pool.end();
"
```
Expected: prints `constraint: [ { conname: 'no_overlapping_active_bookings' } ]`.

- [ ] **Step 6: Add `btree_gist` to the tenant template**

Find the provisioning script (`backend/src/modules/tenants/provision.ts`) and verify whether the tenant template DB is cloned with migrations applied. If provisioning runs `migrateTenantDb()`, the new migration applies automatically to new tenants — no extra step. If provisioning does NOT run migrations on the template, add `CREATE EXTENSION IF NOT EXISTS btree_gist;` to the template-creation SQL in `provision.ts`. (Read the file to determine which path applies.)

- [ ] **Step 7: Commit**

```bash
cd backend
git add src/db/migrations/tenant/
git commit -m "feat(scheduling): migration for scheduling tables + GiST exclusion constraint"
```

---

## Task 10: State machine module (TDD)

**Files:**
- Create: `backend/src/modules/scheduling/state-machine.ts`
- Test: `backend/src/modules/scheduling/state-machine.test.ts`

- [ ] **Step 1: Write the failing test — full transition matrix**

Create `backend/src/modules/scheduling/state-machine.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  TRANSITIONS,
  canTransition,
  assertCanTransition,
  type AppointmentAction,
  type AppointmentStatus,
} from './state-machine.js';

describe('state-machine', () => {
  // Legal transitions: for each status, each defined action leads to the
  // expected target status.
  const LEGAL: Array<{ from: AppointmentStatus; action: AppointmentAction; to: AppointmentStatus }> = [
    { from: 'requested', action: 'confirm', to: 'confirmed' },
    { from: 'requested', action: 'cancel', to: 'cancelled' },
    { from: 'confirmed', action: 'check_in', to: 'checked_in' },
    { from: 'confirmed', action: 'start', to: 'in_progress' },
    { from: 'confirmed', action: 'cancel', to: 'cancelled' },
    { from: 'confirmed', action: 'no_show', to: 'no_show' },
    { from: 'confirmed', action: 'reschedule', to: 'confirmed' },
    { from: 'checked_in', action: 'start', to: 'in_progress' },
    { from: 'checked_in', action: 'cancel', to: 'cancelled' },
    { from: 'checked_in', action: 'no_show', to: 'no_show' },
    { from: 'in_progress', action: 'complete', to: 'completed' },
  ];

  for (const { from, action, to } of LEGAL) {
    it(`allows ${from} --${action}--> ${to}`, () => {
      expect(canTransition(from, action)).toBe(true);
      expect(TRANSITIONS[from][action]).toBe(to);
    });
  }

  // Terminal statuses have no outgoing transitions.
  for (const terminal of ['completed', 'cancelled', 'no_show'] as AppointmentStatus[]) {
    it(`terminal status '${terminal}' has no outgoing transitions`, () => {
      expect(Object.keys(TRANSITIONS[terminal]).length).toBe(0);
    });
  }

  // Illegal transitions are rejected.
  const ILLEGAL: Array<{ from: AppointmentStatus; action: AppointmentAction }> = [
    { from: 'completed', action: 'check_in' },
    { from: 'cancelled', action: 'start' },
    { from: 'no_show', action: 'complete' },
    { from: 'confirmed', action: 'complete' }, // must go through in_progress
    { from: 'in_progress', action: 'cancel' }, // can't cancel mid-service
  ];

  for (const { from, action } of ILLEGAL) {
    it(`rejects ${from} --${action}-->`, () => {
      expect(canTransition(from, action)).toBe(false);
    });
  }

  it('assertCanTransition throws on illegal transition', () => {
    expect(() => assertCanTransition('completed', 'check_in')).toThrow();
  });

  it('assertCanTransition returns the target status on legal transition', () => {
    expect(assertCanTransition('confirmed', 'check_in')).toBe('checked_in');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && pnpm vitest run src/modules/scheduling/state-machine.test.ts`
Expected: FAIL with "Cannot find module './state-machine.js'" or similar.

- [ ] **Step 3: Write the implementation**

Create `backend/src/modules/scheduling/state-machine.ts`:

```typescript
import type { AppointmentStatus } from '../../db/schema/tenant/appointments.js';
import { invalidTransition } from '../../lib/errors.js';

/**
 * The set of actions an appointment can undergo. Each maps to one or more legal
 * transitions in TRANSITIONS below.
 */
export type AppointmentAction =
  | 'confirm'
  | 'check_in'
  | 'start'
  | 'complete'
  | 'cancel'
  | 'no_show'
  | 'reschedule';

/**
 * The legal transition graph: { [fromStatus]: { [action]: toStatus } }.
 *
 * This is the SINGLE source of truth for "can this appointment move from X to
 * Y" — no scattered if-statements elsewhere. `requested` is included for
 * forward-compat (client self-booking, phase 5) but is not reachable from staff
 * booking in phase 1 (staff booking creates directly in `confirmed`).
 *
 * Terminal statuses (completed, cancelled, no_show) have empty maps — no
 * outgoing transitions, no automatic revive.
 */
export const TRANSITIONS: Record<AppointmentStatus, Partial<Record<AppointmentAction, AppointmentStatus>>> = {
  requested: { confirm: 'confirmed', cancel: 'cancelled' },
  confirmed: {
    check_in: 'checked_in',
    start: 'in_progress',
    cancel: 'cancelled',
    no_show: 'no_show',
    reschedule: 'confirmed',
  },
  checked_in: { start: 'in_progress', cancel: 'cancelled', no_show: 'no_show' },
  in_progress: { complete: 'completed' },
  completed: {},
  cancelled: {},
  no_show: {},
};

/** Can the appointment in status `from` perform `action`? */
export function canTransition(from: AppointmentStatus, action: AppointmentAction): boolean {
  return action in TRANSITIONS[from];
}

/**
 * Assert the transition is legal and return the target status. Throws 409
 * INVALID_TRANSITION otherwise — a stable error code the frontend can map.
 */
export function assertCanTransition(from: AppointmentStatus, action: AppointmentAction): AppointmentStatus {
  const to = TRANSITIONS[from][action];
  if (!to) {
    throw invalidTransition(from, action);
  }
  return to;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && pnpm vitest run src/modules/scheduling/state-machine.test.ts`
Expected: PASS — all matrix cases green.

- [ ] **Step 5: Commit**

```bash
cd backend
git add src/modules/scheduling/state-machine.ts src/modules/scheduling/state-machine.test.ts
git commit -m "feat(scheduling): data-driven appointment state machine with full matrix tests"
```

---

## Task 11: Zod request schemas for appointments

**Files:**
- Create: `backend/src/modules/scheduling/schema.ts`
- Test: `backend/src/modules/scheduling/schema.test.ts`

- [ ] **Step 1: Write the failing test for the PATCH discriminated union**

Create `backend/src/modules/scheduling/schema.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { createAppointmentBody, patchAppointmentBody, appointmentIdParam } from './schema.js';

describe('createAppointmentBody', () => {
  it('accepts a service-backed appointment', () => {
    const parsed = createAppointmentBody.parse({
      resourceId: '123e4567-e89b-12d3-a456-426614174000',
      serviceId: '123e4567-e89b-12d3-a456-426614174001',
      startAt: '2026-07-10T14:00:00.000Z',
    });
    expect(parsed.resourceId).toBe('123e4567-e89b-12d3-a456-426614174000');
  });

  it('requires durationMinutes when serviceId is null', () => {
    const ok = createAppointmentBody.safeParse({
      resourceId: '123e4567-e89b-12d3-a456-426614174000',
      startAt: '2026-07-10T14:00:00.000Z',
      durationMinutes: 60,
    });
    expect(ok.success).toBe(true);
  });

  it('rejects a service-less appointment without durationMinutes', () => {
    const bad = createAppointmentBody.safeParse({
      resourceId: '123e4567-e89b-12d3-a456-426614174000',
      startAt: '2026-07-10T14:00:00.000Z',
    });
    expect(bad.success).toBe(false);
  });

  it('rejects a startAt in the past', () => {
    const bad = createAppointmentBody.safeParse({
      resourceId: '123e4567-e89b-12d3-a456-426614174000',
      serviceId: '123e4567-e89b-12d3-a456-426614174001',
      startAt: '2020-01-01T00:00:00.000Z',
    });
    expect(bad.success).toBe(false);
  });
});

describe('patchAppointmentBody', () => {
  it('accepts a cancel action with a reason', () => {
    const parsed = patchAppointmentBody.parse({ action: 'cancel', reason: 'Client called.' });
    expect(parsed.action).toBe('cancel');
  });

  it('accepts a reschedule action with startAt', () => {
    const parsed = patchAppointmentBody.parse({
      action: 'reschedule',
      startAt: '2026-08-01T10:00:00.000Z',
    });
    expect(parsed.action).toBe('reschedule');
  });

  it('rejects a reschedule action without startAt', () => {
    const bad = patchAppointmentBody.safeParse({ action: 'reschedule' });
    expect(bad.success).toBe(false);
  });

  it('rejects an unknown action', () => {
    const bad = patchAppointmentBody.safeParse({ action: 'teleport' });
    expect(bad.success).toBe(false);
  });
});

describe('appointmentIdParam', () => {
  it('accepts a uuid', () => {
    expect(appointmentIdParam.parse({ id: '123e4567-e89b-12d3-a456-426614174000' }).id).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && pnpm vitest run src/modules/scheduling/schema.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `backend/src/modules/scheduling/schema.ts`:

```typescript
import { z } from 'zod';

const uuid = z.string().uuid();
const futureTimestamp = z.string().datetime().refine((s) => new Date(s) > new Date(), {
  message: 'startAt must be in the future.',
});

/**
 * POST /v1/appointments body.
 *
 * `resourceId` (primary) is always required. `serviceId` is nullable (custom
 * appointments). `durationMinutes` is required ONLY when `serviceId` is null —
 * enforced by the refinement. `additionalResourceIds` is optional and auto-
 * filled from the service defaults when absent.
 */
export const createAppointmentBody = z
  .object({
    clientId: uuid.optional(),
    serviceId: uuid.optional(),
    resourceId: uuid,
    additionalResourceIds: z.array(uuid).optional(),
    startAt: futureTimestamp,
    durationMinutes: z.number().int().positive().optional(),
    summary: z.string().max(200).optional(),
    notes: z.string().max(5000).optional(),
  })
  .refine((b) => b.serviceId !== undefined || b.durationMinutes !== undefined, {
    message: 'durationMinutes is required when serviceId is not provided.',
    path: ['durationMinutes'],
  });

/**
 * PATCH /v1/appointments/:id body — discriminated union on `action`.
 * One endpoint, one auth guard, dispatch in the controller.
 */
export const patchAppointmentBody = z.discriminatedUnion('action', [
  z.object({ action: z.literal('cancel'), reason: z.string().max(200).optional() }),
  z.object({ action: z.literal('check_in'), note: z.string().max(500).optional() }),
  z.object({ action: z.literal('start'), note: z.string().max(500).optional() }),
  z.object({ action: z.literal('complete'), note: z.string().max(500).optional() }),
  z.object({ action: z.literal('no_show'), note: z.string().max(500).optional() }),
  z.object({ action: z.literal('reschedule'), startAt: futureTimestamp }),
]);

export const appointmentIdParam = z.object({ id: uuid });

export type CreateAppointmentInput = z.infer<typeof createAppointmentBody>;
export type PatchAppointmentInput = z.infer<typeof patchAppointmentBody>;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && pnpm vitest run src/modules/scheduling/schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd backend
git add src/modules/scheduling/schema.ts src/modules/scheduling/schema.test.ts
git commit -m "feat(scheduling): Zod schemas for appointment create + patch action union"
```

---

## Task 12: Scheduling service — create + conflict detection

**Files:**
- Create: `backend/src/modules/scheduling/service.ts`

This is the transactional core. We build `createAppointment` first (the conflict-checked write path), then add the other operations in subsequent tasks.

- [ ] **Step 1: Write the create + conflict helper**

Create `backend/src/modules/scheduling/service.ts`:

```typescript
import { eq, and, isNull, sql, inArray } from 'drizzle-orm';
import type { TenantDb } from '../../db/tenant-pool.js';
import { appointments } from '../../db/schema/tenant/appointments.js';
import { appointmentResources } from '../../db/schema/tenant/appointment-resources.js';
import { appointmentStatusHistory } from '../../db/schema/tenant/appointment-status-history.js';
import { resources } from '../../db/schema/tenant/resources.js';
import { services } from '../../db/schema/tenant/services.js';
import { serviceResourceRequirements } from '../../db/schema/tenant/service-resource-requirements.js';
import { clients } from '../../db/schema/tenant/clients.js';
import { rangeLiteral } from '../../db/schema/tenant/tstzrange.js';
import {
  resourceNotFound,
  serviceNotFound,
  appointmentConflict,
  invalidBooking,
  clientNotFound,
} from '../../lib/errors.js';
import type { CreateAppointmentInput } from './schema.js';

/**
 * A resource the appointment will reserve, with the window it occupies
 * (including service buffers).
 */
interface BookedResource {
  resourceId: string;
  role: string;
  rangeStart: Date;
  rangeEnd: Date;
}

/**
 * Find appointments that conflict with any of the given (resourceId, window)
 * pairs — i.e. overlapping active appointment_resources rows. Returns the
 * conflict details for a 409 APPOINTMENT_CONFLICT response, or null if clean.
 */
export async function findConflicts(
  db: TenantDb,
  booked: BookedResource[],
): Promise<{ resourceId: string; resourceName: string; resourceType: string; conflictAppointmentId: string; conflictStart: Date; conflictEnd: Date }[] | null> {
  const conflicts: Array<Record<string, unknown>> = [];
  for (const b of booked) {
    // Overlap query: same resource, deleted_at IS NULL, booked_range && [start,end)
    const overlapping = await db
      .select({
        arId: appointmentResources.id,
        appointmentId: appointmentResources.appointmentId,
        resourceId: appointmentResources.resourceId,
        resourceName: resources.name,
        resourceType: resources.type,
        apptStart: appointments.startAt,
        apptEnd: appointments.endAt,
      })
      .from(appointmentResources)
      .innerJoin(resources, eq(appointmentResources.resourceId, resources.id))
      .innerJoin(appointments, eq(appointmentResources.appointmentId, appointments.id))
      .where(
        and(
          eq(appointmentResources.resourceId, b.resourceId),
          isNull(appointmentResources.deletedAt),
          sql`${appointmentResources.bookedRange} && tstzrange(${b.rangeStart}, ${b.rangeEnd}, '[)')`,
        ),
      );
    for (const row of overlapping) {
      conflicts.push({
        resourceId: row.resourceId,
        resourceName: row.resourceName,
        resourceType: row.resourceType,
        conflictAppointmentId: row.appointmentId,
        conflictStart: row.apptStart,
        conflictEnd: row.apptEnd,
      });
    }
  }
  return conflicts.length > 0 ? conflicts as any : null;
}

/**
 * Create an appointment in `confirmed` status. Resolves the service (if any) for
 * duration + buffers, validates the resources, friendly-conflict-checks, then
 * inserts — the GiST constraint is the race-proof backstop. One transaction.
 */
export async function createAppointment(
  db: TenantDb,
  input: CreateAppointmentInput,
  actorStaffId: string,
): Promise<{ id: string }> {
  return await db.transaction(async (tx) => {
    // 1. Resolve service → duration + buffers (if service_id present)
    let durationMinutes: number;
    let bufferBefore = 0;
    let bufferAfter = 0;
    let requirementDefaults: { resourceType: string; quantity: number }[] = [];

    if (input.serviceId) {
      const [svc] = await tx.select().from(services)
        .where(and(eq(services.id, input.serviceId), isNull(services.deletedAt)))
        .limit(1);
      if (!svc) throw serviceNotFound();
      durationMinutes = svc.durationMinutes;
      bufferBefore = svc.bufferBeforeMinutes;
      bufferAfter = svc.bufferAfterMinutes;
      const reqs = await tx.select().from(serviceResourceRequirements)
        .where(eq(serviceResourceRequirements.serviceId, svc.id));
      requirementDefaults = reqs
        .filter((r) => r.isRequired)
        .map((r) => ({ resourceType: r.resourceType, quantity: r.quantity }));
    } else {
      // service-less: durationMinutes is required by the schema refinement
      durationMinutes = input.durationMinutes!;
    }

    // 2. Resolve the requested resource set
    const resourceIds = new Set<string>([input.resourceId]);
    if (input.additionalResourceIds) {
      for (const rid of input.additionalResourceIds) resourceIds.add(rid);
    }
    // (Auto-fill from service defaults is intentionally minimal in phase 1: the
    // caller passes explicit resource ids. Service defaults drive the future UI.)

    // 3. Validate each resource: exists, active, not soft-deleted
    const resourceRows = await tx.select().from(resources)
      .where(and(inArray(resources.id, [...resourceIds]), isNull(resources.deletedAt)));
    if (resourceRows.length !== resourceIds.size) throw resourceNotFound();
    for (const r of resourceRows) {
      if (!r.isActive) throw invalidBooking(`Resource '${r.name}' is inactive.`);
    }

    // 4. Validate client if provided
    if (input.clientId) {
      const [c] = await tx.select().from(clients)
        .where(and(eq(clients.id, input.clientId), isNull(clients.deletedAt)))
        .limit(1);
      if (!c) throw clientNotFound();
    }

    // 5. Compute end_at + per-resource booked window
    const startAt = new Date(input.startAt);
    const endAt = new Date(startAt.getTime() + durationMinutes * 60_000);

    const booked: BookedResource[] = [...resourceIds].map((rid, idx) => ({
      resourceId: rid,
      role: rid === input.resourceId ? 'primary' : 'additional',
      rangeStart: new Date(startAt.getTime() - bufferBefore * 60_000),
      rangeEnd: new Date(endAt.getTime() + bufferAfter * 60_000),
    }));

    // 6. Friendly pre-check: name the conflicting resource(s) for a good error
    const conflicts = await findConflicts(tx, booked);
    if (conflicts) throw appointmentConflict({ conflicting_resources: conflicts });

    // 7. INSERT appointment
    const [appt] = await tx.insert(appointments).values({
      clientId: input.clientId,
      serviceId: input.serviceId,
      primaryResourceId: input.resourceId,
      startAt,
      endAt,
      status: 'confirmed',
      summary: input.summary,
      notes: input.notes,
      createdByStaffId: actorStaffId,
    }).returning();

    // 8. INSERT appointment_resources (GiST constraint rejects overlaps here)
    await tx.insert(appointmentResources).values(
      booked.map((b) => ({
        appointmentId: appt!.id,
        resourceId: b.resourceId,
        bookedRange: rangeLiteral(b.rangeStart, b.rangeEnd),
        role: b.role,
      })),
    );

    // 9. INSERT initial status history
    await tx.insert(appointmentStatusHistory).values({
      appointmentId: appt!.id,
      fromStatus: null,
      toStatus: 'confirmed',
      changedByStaffId: actorStaffId,
    });

    return { id: appt!.id };
  });
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `cd backend && pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit (defer tests to Task 15 which needs a DB; this is the implementation skeleton)**

```bash
cd backend
git add src/modules/scheduling/service.ts
git commit -m "feat(scheduling): createAppointment with friendly conflict pre-check"
```

---

## Task 13: Scheduling service — reschedule + transition + list

**Files:**
- Modify: `backend/src/modules/scheduling/service.ts`

- [ ] **Step 1: Append the reschedule, transition, and list operations**

Append to `backend/src/modules/scheduling/service.ts` (after `createAppointment`):

```typescript
import type { AppointmentStatus } from '../../db/schema/tenant/appointments.js';
import { appointmentNotFound } from '../../lib/errors.js';
import { assertCanTransition, type AppointmentAction } from './state-machine.js';

/**
 * Reschedule: move an appointment to a new start time. Same service, recomputed
 * window. Within one transaction: soft-delete old appointment_resources FIRST
 * (avoids self-conflict), pre-check, insert new rows, update header, log history.
 */
export async function rescheduleAppointment(
  db: TenantDb,
  id: string,
  newStartAt: string,
  actorStaffId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [appt] = await tx.select().from(appointments)
      .where(and(eq(appointments.id, id), isNull(appointments.deletedAt)))
      .limit(1);
    if (!appt) throw appointmentNotFound();

    assertCanTransition(appt.status, 'reschedule');

    // Recompute window from the same service (or manual duration if no service)
    let durationMinutes = 60;
    let bufferBefore = 0;
    let bufferAfter = 0;
    if (appt.serviceId) {
      const [svc] = await tx.select().from(services).where(eq(services.id, appt.serviceId)).limit(1);
      if (svc) {
        durationMinutes = svc.durationMinutes;
        bufferBefore = svc.bufferBeforeMinutes;
        bufferAfter = svc.bufferAfterMinutes;
      }
    }

    const startAt = new Date(newStartAt);
    const endAt = new Date(startAt.getTime() + durationMinutes * 60_000);

    // Load existing resource assignments so we re-book the same set
    const existing = await tx.select().from(appointmentResources)
      .where(and(eq(appointmentResources.appointmentId, id), isNull(appointmentResources.deletedAt)));

    const booked: BookedResource[] = existing.map((e) => ({
      resourceId: e.resourceId,
      role: e.role,
      rangeStart: new Date(startAt.getTime() - bufferBefore * 60_000),
      rangeEnd: new Date(endAt.getTime() + bufferAfter * 60_000),
    }));

    // Soft-delete old rows FIRST so they don't conflict with the new ones
    await tx.update(appointmentResources)
      .set({ deletedAt: new Date() })
      .where(and(eq(appointmentResources.appointmentId, id), isNull(appointmentResources.deletedAt)));

    // Friendly pre-check on the new window
    const conflicts = await findConflicts(tx, booked);
    if (conflicts) throw appointmentConflict({ conflicting_resources: conflicts });

    // Insert new rows
    await tx.insert(appointmentResources).values(
      booked.map((b) => ({
        appointmentId: id,
        resourceId: b.resourceId,
        bookedRange: rangeLiteral(b.rangeStart, b.rangeEnd),
        role: b.role,
      })),
    );

    // Update header
    await tx.update(appointments)
      .set({ startAt, endAt, updatedAt: new Date() })
      .where(eq(appointments.id, id));

    // History: reschedule keeps the same status; log the time change
    await tx.insert(appointmentStatusHistory).values({
      appointmentId: id,
      fromStatus: appt.status,
      toStatus: appt.status,
      changedByStaffId: actorStaffId,
      note: `Rescheduled to ${startAt.toISOString()}`,
    });
  });
}

/**
 * Transition an appointment's status per the state machine. For cancel/no_show,
 * soft-delete the appointment_resources rows so the slot frees up under the
 * partial GiST constraint. One transaction.
 */
export async function transitionStatus(
  db: TenantDb,
  id: string,
  action: AppointmentAction,
  actorStaffId: string,
  options: { note?: string; reason?: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [appt] = await tx.select().from(appointments)
      .where(and(eq(appointments.id, id), isNull(appointments.deletedAt)))
      .limit(1);
    if (!appt) throw appointmentNotFound();

    const toStatus = assertCanTransition(appt.status, action) as AppointmentStatus;

    // Cancel/no_show free the slot: soft-delete the resource rows
    if (action === 'cancel' || action === 'no_show') {
      await tx.update(appointmentResources)
        .set({ deletedAt: new Date() })
        .where(and(eq(appointmentResources.appointmentId, id), isNull(appointmentResources.deletedAt)));
    }

    await tx.update(appointments)
      .set({
        status: toStatus,
        cancellationReason: action === 'cancel' ? options.reason ?? null : undefined,
        updatedAt: new Date(),
      })
      .where(eq(appointments.id, id));

    await tx.insert(appointmentStatusHistory).values({
      appointmentId: id,
      fromStatus: appt.status,
      toStatus,
      changedByStaffId: actorStaffId,
      note: options.note,
    });
  });
}

/**
 * List appointments with filters. Read-only; uses the appointment header times
 * for display (not the range column).
 */
export async function listAppointments(
  db: TenantDb,
  filters: { from?: string; to?: string; resourceId?: string; clientId?: string; status?: string },
): Promise<typeof appointments.$inferSelect[]> {
  const conditions = [isNull(appointments.deletedAt)];
  if (filters.from) conditions.push(sql`${appointments.startAt} >= ${new Date(filters.from)}`);
  if (filters.to) conditions.push(sql`${appointments.startAt} < ${new Date(filters.to)}`);
  if (filters.resourceId) conditions.push(eq(appointments.primaryResourceId, filters.resourceId));
  if (filters.clientId) conditions.push(eq(appointments.clientId, filters.clientId));
  if (filters.status) conditions.push(eq(appointments.status, filters.status as AppointmentStatus));

  return await db.select().from(appointments)
    .where(and(...conditions))
    .orderBy(appointments.startAt)
    .limit(200);
}
```

Note: the imports `appointmentNotFound`, `assertCanTransition`, `AppointmentAction`, and `AppointmentStatus` should be consolidated at the top of the file with the other imports rather than duplicated. When implementing, merge all imports into the single import block at the top.

- [ ] **Step 2: Verify it type-checks (consolidate imports first)**

Run: `cd backend && pnpm tsc --noEmit`
Expected: no errors. If duplicate-import errors appear, merge the import statements at the top of `service.ts`.

- [ ] **Step 3: Commit**

```bash
cd backend
git add src/modules/scheduling/service.ts
git commit -m "feat(scheduling): reschedule, transitionStatus, listAppointments"
```

---

## Task 14: Resources CRUD module + controller + routes

**Files:**
- Create: `backend/src/modules/resources/schema.ts`
- Create: `backend/src/modules/resources/service.ts`
- Create: `backend/src/controllers/resources.controller.ts`
- Create: `backend/src/routes/resources.routes.ts`

- [ ] **Step 1: Write the resources schema**

Create `backend/src/modules/resources/schema.ts`:

```typescript
import { z } from 'zod';

export const createResourceBody = z.object({
  name: z.string().min(1).max(120),
  type: z.enum(['provider', 'room', 'equipment', 'chair']),
  linkedStaffId: z.string().uuid().optional(),
  color: z.string().max(20).optional(),
  notes: z.string().max(5000).optional(),
});

export const updateResourceBody = z.object({
  name: z.string().min(1).max(120).optional(),
  isActive: z.boolean().optional(),
  color: z.string().max(20).optional(),
  notes: z.string().max(5000).optional(),
});

export const resourceIdParam = z.object({ id: z.string().uuid() });
```

- [ ] **Step 2: Write the resources service (with the active-bookings delete guard)**

Create `backend/src/modules/resources/service.ts`:

```typescript
import { eq, and, isNull } from 'drizzle-orm';
import type { TenantDb } from '../../db/tenant-pool.js';
import { resources } from '../../db/schema/tenant/resources.js';
import { appointmentResources } from '../../db/schema/tenant/appointment-resources.js';
import { appointments } from '../../db/schema/tenant/appointments.js';
import { staff } from '../../db/schema/tenant/staff.js';
import { resourceNotFound, resourceHasActiveBookings, invalidBooking } from '../../lib/errors.js';
import { ACTIVE_STATUSES } from '../../db/schema/tenant/appointments.js';
import { inArray } from 'drizzle-orm';

export async function listResources(db: TenantDb, opts: { type?: string; includeInactive?: boolean }) {
  const conditions = [isNull(resources.deletedAt)];
  if (opts.type) conditions.push(eq(resources.type, opts.type as any));
  if (!opts.includeInactive) conditions.push(eq(resources.isActive, true));
  return await db.select().from(resources).where(and(...conditions)).orderBy(resources.name);
}

export async function getResource(db: TenantDb, id: string) {
  const [row] = await db.select().from(resources)
    .where(and(eq(resources.id, id), isNull(resources.deletedAt))).limit(1);
  if (!row) throw resourceNotFound();
  return row;
}

export async function createResource(db: TenantDb, input: { name: string; type: string; linkedStaffId?: string; color?: string; notes?: string }) {
  // type='provider' requires a valid linkedStaffId; other types forbid it
  if (input.type === 'provider') {
    if (!input.linkedStaffId) throw invalidBooking('A provider resource requires linkedStaffId.');
    const [s] = await db.select().from(staff)
      .where(and(eq(staff.id, input.linkedStaffId), eq(staff.active, true), isNull(staff.deletedAt))).limit(1);
    if (!s) throw invalidBooking('linkedStaffId does not reference an active staff member.');
  } else if (input.linkedStaffId) {
    throw invalidBooking('Only provider resources may have a linkedStaffId.');
  }
  const [created] = await db.insert(resources).values({
    name: input.name,
    type: input.type as any,
    linkedStaffId: input.linkedStaffId,
    color: input.color,
    notes: input.notes,
  }).returning();
  return created!;
}

export async function updateResource(db: TenantDb, id: string, set: Partial<{ name: string; isActive: boolean; color: string; notes: string }>) {
  const [updated] = await db.update(resources)
    .set({ ...set, updatedAt: new Date() })
    .where(and(eq(resources.id, id), isNull(resources.deletedAt)))
    .returning();
  if (!updated) throw resourceNotFound();
  return updated;
}

export async function deleteResource(db: TenantDb, id: string) {
  // Guard: reject if any non-terminal appointment references this resource
  const activeBookings = await db.select({ id: appointmentResources.id })
    .from(appointmentResources)
    .innerJoin(appointments, eq(appointmentResources.appointmentId, appointments.id))
    .where(and(
      eq(appointmentResources.resourceId, id),
      isNull(appointmentResources.deletedAt),
      inArray(appointments.status, ACTIVE_STATUSES as string[]),
    ));
  if (activeBookings.length > 0) throw resourceHasActiveBookings(activeBookings.length);

  const [softDeleted] = await db.update(resources)
    .set({ deletedAt: new Date(), updatedAt: new Date(), isActive: false })
    .where(and(eq(resources.id, id), isNull(resources.deletedAt)))
    .returning({ id: resources.id });
  if (!softDeleted) throw resourceNotFound();
}
```

- [ ] **Step 3: Write the controller**

Create `backend/src/controllers/resources.controller.ts`:

```typescript
import type { FastifyReply, FastifyRequest } from 'fastify';
import { createResourceBody, updateResourceBody, resourceIdParam } from '../modules/resources/schema.js';
import { listResources, getResource, createResource, updateResource, deleteResource } from '../modules/resources/service.js';
import { auditLog } from '../lib/audit.js';

export const resourcesController = {
  async list(req: FastifyRequest, _reply: FastifyReply) {
    const type = (req.query as { type?: string }).type;
    const includeInactive = (req.query as { include_inactive?: string }).include_inactive === 'true';
    const rows = await listResources(req.tenantDb!, { type, includeInactive });
    return { resources: rows };
  },

  async getById(req: FastifyRequest, reply: FastifyReply) {
    const { id } = resourceIdParam.parse(req.params);
    const row = await getResource(req.tenantDb!, id);
    reply.send(row);
  },

  async create(req: FastifyRequest, reply: FastifyReply) {
    const input = createResourceBody.parse(req.body);
    const created = await createResource(req.tenantDb!, input);
    auditLog(req, { action: 'resource.create', target: { resource: 'resource', id: created.id }, msg: 'Resource created.' });
    reply.status(201).send(created);
  },

  async update(req: FastifyRequest, reply: FastifyReply) {
    const { id } = resourceIdParam.parse(req.params);
    const set = updateResourceBody.parse(req.body);
    const updated = await updateResource(req.tenantDb!, id, set);
    auditLog(req, { action: 'resource.update', target: { resource: 'resource', id }, msg: 'Resource updated.' });
    reply.send(updated);
  },

  async remove(req: FastifyRequest, reply: FastifyReply) {
    const { id } = resourceIdParam.parse(req.params);
    await deleteResource(req.tenantDb!, id);
    auditLog(req, { action: 'resource.delete', target: { resource: 'resource', id }, msg: 'Resource soft-deleted.' });
    reply.status(204).send();
  },
};
```

- [ ] **Step 4: Write the routes**

Create `backend/src/routes/resources.routes.ts`:

```typescript
import type { FastifyInstance } from 'fastify';
import { resourcesController } from '../controllers/resources.controller.js';
import { requireAppointments } from '../lib/require-appointments.js';
import { Role } from '../lib/roles.js';

/**
 * Tenant-scoped RESOURCES CRUD. Reads open to any tenant user; writes require
 * tenant_admin. All gated on the APPOINTMENTS feature flag.
 */
export async function resourceRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: requireAppointments(), handler: resourcesController.list });
  app.get('/:id', { preHandler: requireAppointments(), handler: resourcesController.getById });
  app.post('/', { preHandler: requireAppointments({ roles: [Role.TENANT_ADMIN] }), handler: resourcesController.create });
  app.patch('/:id', { preHandler: requireAppointments({ roles: [Role.TENANT_ADMIN] }), handler: resourcesController.update });
  app.delete('/:id', { preHandler: requireAppointments({ roles: [Role.TENANT_ADMIN] }), handler: resourcesController.remove });
}
```

- [ ] **Step 5: Verify it type-checks**

Run: `cd backend && pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
cd backend
git add src/modules/resources/ src/controllers/resources.controller.ts src/routes/resources.routes.ts
git commit -m "feat(scheduling): resources CRUD module + controller + routes"
```

---

## Task 15: Services catalog CRUD module + controller + routes

**Files:**
- Create: `backend/src/modules/services-catalog/schema.ts`
- Create: `backend/src/modules/services-catalog/service.ts`
- Create: `backend/src/controllers/services.controller.ts`
- Create: `backend/src/routes/services.routes.ts`

- [ ] **Step 1: Write the services schema**

Create `backend/src/modules/services-catalog/schema.ts`:

```typescript
import { z } from 'zod';

export const createServiceBody = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(5000).optional(),
  category: z.string().max(80).optional(),
  durationMinutes: z.number().int().positive(),
  bufferBeforeMinutes: z.number().int().min(0).default(0).optional(),
  bufferAfterMinutes: z.number().int().min(0).default(0).optional(),
});

export const updateServiceBody = createServiceBody.partial();

export const serviceIdParam = z.object({ id: z.string().uuid() });

export const requirementsBody = z.array(z.object({
  resourceType: z.enum(['provider', 'room', 'equipment', 'chair']),
  quantity: z.number().int().positive().default(1),
  isRequired: z.boolean().default(true),
}));
```

- [ ] **Step 2: Write the services service (with requirements full-replace and future-appts delete guard)**

Create `backend/src/modules/services-catalog/service.ts`:

```typescript
import { eq, and, isNull } from 'drizzle-orm';
import type { TenantDb } from '../../db/tenant-pool.js';
import { services } from '../../db/schema/tenant/services.js';
import { serviceResourceRequirements } from '../../db/schema/tenant/service-resource-requirements.js';
import { appointments } from '../../db/schema/tenant/appointments.js';
import { serviceNotFound, serviceHasFutureAppointments } from '../../lib/errors.js';

export async function listServices(db: TenantDb, opts: { category?: string; includeInactive?: boolean }) {
  const conditions = [isNull(services.deletedAt)];
  if (opts.category) conditions.push(eq(services.category, opts.category));
  if (!opts.includeInactive) conditions.push(eq(services.isActive, true));
  return await db.select().from(services).where(and(...conditions)).orderBy(services.name);
}

export async function getService(db: TenantDb, id: string) {
  const [row] = await db.select().from(services)
    .where(and(eq(services.id, id), isNull(services.deletedAt))).limit(1);
  if (!row) throw serviceNotFound();
  return row;
}

export async function createService(db: TenantDb, input: any) {
  const [created] = await db.insert(services).values({
    name: input.name,
    description: input.description,
    category: input.category,
    durationMinutes: input.durationMinutes,
    bufferBeforeMinutes: input.bufferBeforeMinutes ?? 0,
    bufferAfterMinutes: input.bufferAfterMinutes ?? 0,
  }).returning();
  return created!;
}

export async function updateService(db: TenantDb, id: string, set: any) {
  const [updated] = await db.update(services)
    .set({ ...set, updatedAt: new Date() })
    .where(and(eq(services.id, id), isNull(services.deletedAt)))
    .returning();
  if (!updated) throw serviceNotFound();
  return updated;
}

export async function deleteService(db: TenantDb, id: string) {
  // Guard: reject if referenced by future appointments
  const future = await db.select({ id: appointments.id })
    .from(appointments)
    .where(and(eq(appointments.serviceId, id), isNull(appointments.deletedAt)));
  if (future.length > 0) throw serviceHasFutureAppointments(future.length);

  await db.update(services)
    .set({ deletedAt: new Date(), updatedAt: new Date(), isActive: false })
    .where(and(eq(services.id, id), isNull(services.deletedAt)));
}

/** Full-replace the resource requirements for a service. */
export async function replaceRequirements(db: TenantDb, serviceId: string, reqs: any[]) {
  // Verify the service exists
  await getService(db, serviceId);
  // Delete existing, insert new — within an implicit transaction
  await db.delete(serviceResourceRequirements).where(eq(serviceResourceRequirements.serviceId, serviceId));
  if (reqs.length > 0) {
    await db.insert(serviceResourceRequirements).values(
      reqs.map((r) => ({
        serviceId,
        resourceType: r.resourceType,
        quantity: r.quantity,
        isRequired: r.isRequired,
      })),
    );
  }
  return await db.select().from(serviceResourceRequirements)
    .where(eq(serviceResourceRequirements.serviceId, serviceId));
}

export async function listRequirements(db: TenantDb, serviceId: string) {
  await getService(db, serviceId);
  return await db.select().from(serviceResourceRequirements)
    .where(eq(serviceResourceRequirements.serviceId, serviceId));
}
```

- [ ] **Step 3: Write the controller**

Create `backend/src/controllers/services.controller.ts`:

```typescript
import type { FastifyReply, FastifyRequest } from 'fastify';
import { createServiceBody, updateServiceBody, serviceIdParam, requirementsBody } from '../modules/services-catalog/schema.js';
import { listServices, getService, createService, updateService, deleteService, replaceRequirements, listRequirements } from '../modules/services-catalog/service.js';
import { auditLog } from '../lib/audit.js';

export const servicesController = {
  async list(req: FastifyRequest, _reply: FastifyReply) {
    const category = (req.query as { category?: string }).category;
    const includeInactive = (req.query as { include_inactive?: string }).include_inactive === 'true';
    const rows = await listServices(req.tenantDb!, { category, includeInactive });
    return { services: rows };
  },

  async getById(req: FastifyRequest, reply: FastifyReply) {
    const { id } = serviceIdParam.parse(req.params);
    reply.send(await getService(req.tenantDb!, id));
  },

  async create(req: FastifyRequest, reply: FastifyReply) {
    const input = createServiceBody.parse(req.body);
    const created = await createService(req.tenantDb!, input);
    auditLog(req, { action: 'service.create', target: { resource: 'service', id: created.id }, msg: 'Service created.' });
    reply.status(201).send(created);
  },

  async update(req: FastifyRequest, reply: FastifyReply) {
    const { id } = serviceIdParam.parse(req.params);
    const set = updateServiceBody.parse(req.body);
    const updated = await updateService(req.tenantDb!, id, set);
    auditLog(req, { action: 'service.update', target: { resource: 'service', id }, msg: 'Service updated.' });
    reply.send(updated);
  },

  async remove(req: FastifyRequest, reply: FastifyReply) {
    const { id } = serviceIdParam.parse(req.params);
    await deleteService(req.tenantDb!, id);
    auditLog(req, { action: 'service.delete', target: { resource: 'service', id }, msg: 'Service soft-deleted.' });
    reply.status(204).send();
  },

  async listRequirements(req: FastifyRequest, reply: FastifyReply) {
    const { id } = serviceIdParam.parse(req.params);
    const rows = await listRequirements(req.tenantDb!, id);
    reply.send({ requirements: rows });
  },

  async replaceRequirements(req: FastifyRequest, reply: FastifyReply) {
    const { id } = serviceIdParam.parse(req.params);
    const reqs = requirementsBody.parse(req.body);
    const rows = await replaceRequirements(req.tenantDb!, id, reqs);
    auditLog(req, { action: 'service.requirements_replace', target: { resource: 'service', id }, msg: 'Service requirements replaced.', extra: { count: rows.length } });
    reply.send({ requirements: rows });
  },
};
```

- [ ] **Step 4: Write the routes**

Create `backend/src/routes/services.routes.ts`:

```typescript
import type { FastifyInstance } from 'fastify';
import { servicesController } from '../controllers/services.controller.js';
import { requireAppointments } from '../lib/require-appointments.js';
import { Role } from '../lib/roles.js';

/**
 * Tenant-scoped SERVICES catalog CRUD + nested requirements. Reads open to any
 * tenant user; writes require tenant_admin. Gated on APPOINTMENTS flag.
 */
export async function serviceRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: requireAppointments(), handler: servicesController.list });
  app.get('/:id', { preHandler: requireAppointments(), handler: servicesController.getById });
  app.post('/', { preHandler: requireAppointments({ roles: [Role.TENANT_ADMIN] }), handler: servicesController.create });
  app.patch('/:id', { preHandler: requireAppointments({ roles: [Role.TENANT_ADMIN] }), handler: servicesController.update });
  app.delete('/:id', { preHandler: requireAppointments({ roles: [Role.TENANT_ADMIN] }), handler: servicesController.remove });
  app.get('/:id/requirements', { preHandler: requireAppointments(), handler: servicesController.listRequirements });
  app.put('/:id/requirements', { preHandler: requireAppointments({ roles: [Role.TENANT_ADMIN] }), handler: servicesController.replaceRequirements });
}
```

- [ ] **Step 5: Verify it type-checks**

Run: `cd backend && pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
cd backend
git add src/modules/services-catalog/ src/controllers/services.controller.ts src/routes/services.routes.ts
git commit -m "feat(scheduling): services catalog CRUD + requirements routes"
```

---

## Task 16: Availability (working hours + time off) module + controller + routes

**Files:**
- Create: `backend/src/modules/availability/schema.ts`
- Create: `backend/src/modules/availability/service.ts`
- Create: `backend/src/modules/availability/timezone.ts`
- Create: `backend/src/controllers/availability.controller.ts`
- Create: `backend/src/routes/availability.routes.ts`

- [ ] **Step 1: Write the timezone accessor**

Create `backend/src/modules/availability/timezone.ts`:

```typescript
import { eq } from 'drizzle-orm';
import type { TenantDb } from '../../db/tenant-pool.js';
import { tenantSettings } from '../../db/schema/tenant/tenant-settings.js';
import { env } from '../../config/env.js';

/**
 * Read the tenant's timezone (e.g. 'Europe/Bucharest'). Defaults to the
 * platform default (`DEFAULT_TENANT_TIMEZONE` env, fallback 'UTC') when unset.
 */
export async function getTenantTimezone(db: TenantDb): Promise<string> {
  const [row] = await db.select().from(tenantSettings)
    .where(eq(tenantSettings.key, 'timezone')).limit(1);
  return row?.value ?? env.DEFAULT_TENANT_TIMEZONE ?? 'UTC';
}

/** Upsert the tenant timezone. */
export async function setTenantTimezone(db: TenantDb, tz: string): Promise<void> {
  await db.insert(tenantSettings).values({ key: 'timezone', value: tz })
    .onConflictDoUpdate({ target: tenantSettings.key, set: { value: tz, updatedAt: new Date() } });
}
```

- [ ] **Step 2: Verify `DEFAULT_TENANT_TIMEZONE` is in the env schema**

Open `backend/src/config/env.ts`. If `DEFAULT_TENANT_TIMEZONE` is not defined in the zod env schema, add it with a default:

```typescript
DEFAULT_TENANT_TIMEZONE: z.string().default('UTC'),
```

(Place it among the other env vars; the exact location doesn't matter as long as it's in the schema object.)

- [ ] **Step 3: Write the availability schema**

Create `backend/src/modules/availability/schema.ts`:

```typescript
import { z } from 'zod';

export const createWorkingHourBody = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  startTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),  // HH:mm or HH:mm:ss
  endTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),     // YYYY-MM-DD
  validTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const updateWorkingHourBody = createWorkingHourBody.partial();

export const createTimeOffBody = z.object({
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  reason: z.string().max(200).optional(),
});

export const resourceIdParam = z.object({ id: z.string().uuid() });
export const workingHourIdParam = z.object({ id: z.string().uuid() });
export const timeOffIdParam = z.object({ id: z.string().uuid() });
export const timezoneBody = z.object({ timezone: z.string().min(2).max(50) });
```

- [ ] **Step 4: Write the availability service**

Create `backend/src/modules/availability/service.ts`:

```typescript
import { eq, and, isNull, lte, gte, or } from 'drizzle-orm';
import type { TenantDb } from '../../db/tenant-pool.js';
import { workingHours } from '../../db/schema/tenant/working-hours.js';
import { timeOff } from '../../db/schema/tenant/time-off.js';
import { scheduleEntryNotFound } from '../../lib/errors.js';

// --- Working hours ---

export async function listWorkingHours(db: TenantDb, resourceId: string) {
  return await db.select().from(workingHours)
    .where(and(eq(workingHours.resourceId, resourceId), isNull(workingHours.deletedAt)))
    .orderBy(workingHours.dayOfWeek, workingHours.startTime);
}

export async function createWorkingHour(db: TenantDb, resourceId: string, input: any) {
  const [created] = await db.insert(workingHours).values({
    resourceId,
    dayOfWeek: input.dayOfWeek,
    startTime: input.startTime,
    endTime: input.endTime,
    validFrom: input.validFrom,
    validTo: input.validTo,
  }).returning();
  return created!;
}

export async function updateWorkingHour(db: TenantDb, id: string, set: any) {
  const [updated] = await db.update(workingHours)
    .set({ ...set, updatedAt: new Date() })
    .where(and(eq(workingHours.id, id), isNull(workingHours.deletedAt)))
    .returning();
  if (!updated) throw scheduleEntryNotFound();
  return updated;
}

export async function deleteWorkingHour(db: TenantDb, id: string) {
  const [row] = await db.update(workingHours)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(workingHours.id, id), isNull(workingHours.deletedAt)))
    .returning({ id: workingHours.id });
  if (!row) throw scheduleEntryNotFound();
}

// --- Time off ---

export async function listTimeOff(db: TenantDb, resourceId: string) {
  return await db.select().from(timeOff)
    .where(and(eq(timeOff.resourceId, resourceId), isNull(timeOff.deletedAt)))
    .orderBy(timeOff.startAt);
}

export async function createTimeOff(db: TenantDb, resourceId: string, input: any) {
  const [created] = await db.insert(timeOff).values({
    resourceId,
    startAt: new Date(input.startAt),
    endAt: new Date(input.endAt),
    reason: input.reason,
  }).returning();
  return created!;
}

export async function deleteTimeOff(db: TenantDb, id: string) {
  const [row] = await db.update(timeOff)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(timeOff.id, id), isNull(timeOff.deletedAt)))
    .returning({ id: timeOff.id });
  if (!row) throw scheduleEntryNotFound();
}
```

- [ ] **Step 5: Write the controller**

Create `backend/src/controllers/availability.controller.ts`:

```typescript
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  createWorkingHourBody, updateWorkingHourBody, createTimeOffBody,
  resourceIdParam, workingHourIdParam, timeOffIdParam, timezoneBody,
} from '../modules/availability/schema.js';
import {
  listWorkingHours, createWorkingHour, updateWorkingHour, deleteWorkingHour,
  listTimeOff, createTimeOff, deleteTimeOff,
} from '../modules/availability/service.js';
import { getTenantTimezone, setTenantTimezone } from '../modules/availability/timezone.js';
import { auditLog } from '../lib/audit.js';

export const availabilityController = {
  // Working hours
  async listWorkingHours(req: FastifyRequest, reply: FastifyReply) {
    const { id } = resourceIdParam.parse(req.params);
    const rows = await listWorkingHours(req.tenantDb!, id);
    reply.send({ workingHours: rows });
  },
  async createWorkingHour(req: FastifyRequest, reply: FastifyReply) {
    const { id } = resourceIdParam.parse(req.params);
    const input = createWorkingHourBody.parse(req.body);
    const created = await createWorkingHour(req.tenantDb!, id, input);
    auditLog(req, { action: 'working_hours.create', target: { resource: 'resource', id }, msg: 'Working hours block added.' });
    reply.status(201).send(created);
  },
  async updateWorkingHour(req: FastifyRequest, reply: FastifyReply) {
    const { id } = workingHourIdParam.parse(req.params);
    const set = updateWorkingHourBody.parse(req.body);
    reply.send(await updateWorkingHour(req.tenantDb!, id, set));
  },
  async deleteWorkingHour(req: FastifyRequest, reply: FastifyReply) {
    const { id } = workingHourIdParam.parse(req.params);
    await deleteWorkingHour(req.tenantDb!, id);
    auditLog(req, { action: 'working_hours.delete', target: { resource: 'working_hours', id }, msg: 'Working hours block removed.' });
    reply.status(204).send();
  },

  // Time off
  async listTimeOff(req: FastifyRequest, reply: FastifyReply) {
    const { id } = resourceIdParam.parse(req.params);
    const rows = await listTimeOff(req.tenantDb!, id);
    reply.send({ timeOff: rows });
  },
  async createTimeOff(req: FastifyRequest, reply: FastifyReply) {
    const { id } = resourceIdParam.parse(req.params);
    const input = createTimeOffBody.parse(req.body);
    const created = await createTimeOff(req.tenantDb!, id, input);
    auditLog(req, { action: 'time_off.create', target: { resource: 'resource', id }, msg: 'Time off added.' });
    reply.status(201).send(created);
  },
  async deleteTimeOff(req: FastifyRequest, reply: FastifyReply) {
    const { id } = timeOffIdParam.parse(req.params);
    await deleteTimeOff(req.tenantDb!, id);
    auditLog(req, { action: 'time_off.delete', target: { resource: 'time_off', id }, msg: 'Time off removed.' });
    reply.status(204).send();
  },

  // Tenant timezone
  async getTimezone(req: FastifyRequest, reply: FastifyReply) {
    const tz = await getTenantTimezone(req.tenantDb!);
    reply.send({ timezone: tz });
  },
  async setTimezone(req: FastifyRequest, reply: FastifyReply) {
    const { timezone } = timezoneBody.parse(req.body);
    await setTenantTimezone(req.tenantDb!, timezone);
    auditLog(req, { action: 'tenant_settings.timezone_set', msg: 'Tenant timezone updated.', extra: { timezone } });
    reply.send({ timezone });
  },
};
```

- [ ] **Step 6: Write the routes**

Create `backend/src/routes/availability.routes.ts`:

```typescript
import type { FastifyInstance } from 'fastify';
import { availabilityController } from '../controllers/availability.controller.js';
import { requireAppointments } from '../lib/require-appointments.js';
import { Role } from '../lib/roles.js';

/**
 * Tenant-scoped AVAILABILITY: working hours + time off per resource, plus the
 * tenant timezone setting. Reads open to any tenant user; writes require admin.
 */
export async function availabilityRoutes(app: FastifyInstance): Promise<void> {
  // Working hours, nested under the resource
  app.get('/resources/:id/working-hours', { preHandler: requireAppointments(), handler: availabilityController.listWorkingHours });
  app.post('/resources/:id/working-hours', { preHandler: requireAppointments({ roles: [Role.TENANT_ADMIN] }), handler: availabilityController.createWorkingHour });
  app.patch('/working-hours/:id', { preHandler: requireAppointments({ roles: [Role.TENANT_ADMIN] }), handler: availabilityController.updateWorkingHour });
  app.delete('/working-hours/:id', { preHandler: requireAppointments({ roles: [Role.TENANT_ADMIN] }), handler: availabilityController.deleteWorkingHour });

  // Time off, nested under the resource
  app.get('/resources/:id/time-off', { preHandler: requireAppointments(), handler: availabilityController.listTimeOff });
  app.post('/resources/:id/time-off', { preHandler: requireAppointments({ roles: [Role.TENANT_ADMIN] }), handler: availabilityController.createTimeOff });
  app.delete('/time-off/:id', { preHandler: requireAppointments({ roles: [Role.TENANT_ADMIN] }), handler: availabilityController.deleteTimeOff });

  // Tenant timezone
  app.get('/settings/timezone', { preHandler: requireAppointments(), handler: availabilityController.getTimezone });
  app.put('/settings/timezone', { preHandler: requireAppointments({ roles: [Role.TENANT_ADMIN] }), handler: availabilityController.setTimezone });
}
```

- [ ] **Step 7: Verify it type-checks**

Run: `cd backend && pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
cd backend
git add src/modules/availability/ src/controllers/availability.controller.ts src/routes/availability.routes.ts
git commit -m "feat(scheduling): availability module (working hours, time off, timezone)"
```

---

## Task 17: Appointments controller + routes

**Files:**
- Create: `backend/src/controllers/appointments.controller.ts`
- Create: `backend/src/routes/appointments.routes.ts`

- [ ] **Step 1: Write the controller**

Create `backend/src/controllers/appointments.controller.ts`:

```typescript
import type { FastifyReply, FastifyRequest } from 'fastify';
import { eq, and, isNull } from 'drizzle-orm';
import { appointments } from '../db/schema/tenant/appointments.js';
import { appointmentResources } from '../db/schema/tenant/appointment-resources.js';
import { appointmentStatusHistory } from '../db/schema/tenant/appointment-status-history.js';
import { appointmentNotFound } from '../lib/errors.js';
import { auditLog } from '../lib/audit.js';
import { createAppointmentBody, patchAppointmentBody, appointmentIdParam } from '../modules/scheduling/schema.js';
import { createAppointment, rescheduleAppointment, transitionStatus, listAppointments } from '../modules/scheduling/service.js';

export const appointmentsController = {
  async list(req: FastifyRequest, _reply: FastifyReply) {
    const q = req.query as Record<string, string | undefined>;
    const rows = await listAppointments(req.tenantDb!, {
      from: q.from, to: q.to, resourceId: q.resourceId, clientId: q.clientId, status: q.status,
    });
    return { appointments: rows };
  },

  async getById(req: FastifyRequest, reply: FastifyReply) {
    const { id } = appointmentIdParam.parse(req.params);
    const [row] = await req.tenantDb!.select().from(appointments)
      .where(and(eq(appointments.id, id), isNull(appointments.deletedAt))).limit(1);
    if (!row) throw appointmentNotFound();
    const resources = await req.tenantDb!.select().from(appointmentResources)
      .where(and(eq(appointmentResources.appointmentId, id), isNull(appointmentResources.deletedAt)));
    reply.send({ ...row, resources });
  },

  async create(req: FastifyRequest, reply: FastifyReply) {
    const input = createAppointmentBody.parse(req.body);
    const actorStaffId = req.userClaims!.sub;
    const { id } = await createAppointment(req.tenantDb!, input, actorStaffId);
    auditLog(req, { action: 'appointment.create', target: { resource: 'appointment', id }, msg: 'Appointment created.' });
    reply.status(201).send({ id });
  },

  async patch(req: FastifyRequest, reply: FastifyReply) {
    const { id } = appointmentIdParam.parse(req.params);
    const input = patchAppointmentBody.parse(req.body);
    const actorStaffId = req.userClaims!.sub;

    if (input.action === 'reschedule') {
      await rescheduleAppointment(req.tenantDb!, id, input.startAt, actorStaffId);
      auditLog(req, { action: 'appointment.reschedule', target: { resource: 'appointment', id }, msg: 'Appointment rescheduled.' });
    } else {
      const opts = 'reason' in input ? { reason: input.reason } : { note: (input as { note?: string }).note };
      await transitionStatus(req.tenantDb!, id, input.action, actorStaffId, opts);
      auditLog(req, { action: `appointment.${input.action}`, target: { resource: 'appointment', id }, msg: `Appointment ${input.action}.` });
    }
    reply.status(204).send();
  },

  async history(req: FastifyRequest, reply: FastifyReply) {
    const { id } = appointmentIdParam.parse(req.params);
    const rows = await req.tenantDb!.select().from(appointmentStatusHistory)
      .where(eq(appointmentStatusHistory.appointmentId, id))
      .orderBy(appointmentStatusHistory.createdAt);
    reply.send({ history: rows });
  },
};
```

- [ ] **Step 2: Write the routes**

Create `backend/src/routes/appointments.routes.ts`:

```typescript
import type { FastifyInstance } from 'fastify';
import { appointmentsController } from '../controllers/appointments.controller.js';
import { requireAppointments } from '../lib/require-appointments.js';
import { Role } from '../lib/roles.js';

/**
 * Tenant-scoped APPOINTMENTS. Create/patch open to any tenant user (receptionist
 * + admin); the single PATCH endpoint dispatches reschedule + all status
 * transitions + cancel via a discriminated {action} body.
 */
export async function appointmentRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: requireAppointments(), handler: appointmentsController.list });
  app.get('/:id', { preHandler: requireAppointments(), handler: appointmentsController.getById });
  app.post('/', { preHandler: requireAppointments(), handler: appointmentsController.create });
  app.patch('/:id', { preHandler: requireAppointments(), handler: appointmentsController.patch });
  app.get('/:id/history', { preHandler: requireAppointments(), handler: appointmentsController.history });
}
```

- [ ] **Step 3: Verify it type-checks**

Run: `cd backend && pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd backend
git add src/controllers/appointments.controller.ts src/routes/appointments.routes.ts
git commit -m "feat(scheduling): appointments controller + routes (PATCH action dispatch)"
```

---

## Task 18: Register all scheduling route groups

**Files:**
- Modify: `backend/src/routes/index.ts`

- [ ] **Step 1: Register the four new route groups**

In `backend/src/routes/index.ts`, add the imports and registrations. The file should become:

```typescript
import type { FastifyInstance } from 'fastify';
import { authRoutes } from './auth.routes.js';
import { adminRoutes } from './admin.routes.js';
import { clientRoutes } from './clients.routes.js';
import { staffRoutes } from './staff.routes.js';
import { flagsRoutes } from './flags.routes.js';
import { resourceRoutes } from './resources.routes.js';
import { serviceRoutes } from './services.routes.js';
import { availabilityRoutes } from './availability.routes.js';
import { appointmentRoutes } from './appointments.routes.js';

export async function registerApiRoutes(app: FastifyInstance): Promise<void> {
  await app.register(authRoutes, { prefix: '/v1/auth' });
  await app.register(adminRoutes, { prefix: '/v1/admin' });
  await app.register(clientRoutes, { prefix: '/v1/clients' });
  await app.register(staffRoutes, { prefix: '/v1/staff' });
  await app.register(flagsRoutes, { prefix: '/v1/features' });
  await app.register(resourceRoutes, { prefix: '/v1/resources' });
  await app.register(serviceRoutes, { prefix: '/v1/services' });
  await app.register(availabilityRoutes, { prefix: '/v1' });
  await app.register(appointmentRoutes, { prefix: '/v1/appointments' });
}
```

Note: `availabilityRoutes` is registered under `/v1` (not `/v1/availability`) because its paths are mixed (`/resources/:id/working-hours`, `/working-hours/:id`, `/time-off/:id`, `/settings/timezone`). The routes file already specifies the full relative paths.

- [ ] **Step 2: Verify it type-checks and the server boots**

Run: `cd backend && pnpm tsc --noEmit`
Expected: no errors.

Run: `cd backend && pnpm dev` (briefly, then Ctrl+C)
Expected: server starts without route-registration errors.

- [ ] **Step 3: Commit**

```bash
cd backend
git add src/routes/index.ts
git commit -m "feat(scheduling): register scheduling route groups under /v1"
```

---

## Task 19: Service-layer conflict + lifecycle tests (real DB)

This is the test tier that justifies the GiST constraint. It needs a real tenant DB with `btree_gist`. Check `backend/src/test/` for the existing test-harness setup (how tests obtain a `TenantDb` against the dev tenant DB); reuse it.

**Files:**
- Create: `backend/src/modules/scheduling/service.test.ts`

- [ ] **Step 1: Locate the test harness**

Read `backend/src/test/` and `backend/vitest.config.ts` to find how existing tests obtain a tenant DB connection (there may be a helper that yields a `TenantDb` against `TENANT_DB_URL` in a transaction that rolls back). If none exists, the test must create its own pool against `process.env.TENANT_DB_URL` and clean up between tests by soft-deleting created rows.

- [ ] **Step 2: Write the conflict-matrix + lifecycle tests**

Create `backend/src/modules/scheduling/service.test.ts`. Adapt the DB acquisition to the harness found in Step 1; the test logic below assumes a `getTestDb()` helper returning a `TenantDb`:

```typescript
import { describe, it, expect, afterEach } from 'vitest';
import { getTestDb, seedResource, seedService, cleanup } from '../../test/helpers.js';
import { createAppointment, rescheduleAppointment, transitionStatus } from './service.js';
// Note: match on the `.code` string property of HttpError, not an imported
// constant. The codes are stable strings: 'APPOINTMENT_CONFLICT', 'INVALID_TRANSITION'.

// NOTE: adapt getTestDb/seedResource/seedService/cleanup to whatever the
// existing test harness provides. If none exists, create minimal helpers in
// backend/src/test/helpers.ts that:
//   - getTestDb(): returns a TenantDb against TENANT_DB_URL
//   - seedResource(db, {type, name}): inserts + returns a resource row
//   - seedService(db, {durationMinutes, bufferBefore, bufferAfter}): inserts + returns a service
//   - cleanup(db): soft-deletes all scheduling rows created during the test run

describe('scheduling service (real DB)', () => {
  const db = getTestDb();
  const FUTURE = new Date(Date.now() + 7 * 86_400_000).toISOString(); // +7 days

  afterEach(async () => { await cleanup(db); });

  it('rejects a double-booking on the same resource', async () => {
    const stylist = await seedResource(db, { type: 'chair', name: 'Chair A' });
    const svc = await seedService(db, { durationMinutes: 60 });
    await createAppointment(db, { resourceId: stylist.id, serviceId: svc.id, startAt: FUTURE }, 'staff-1');
    await expect(createAppointment(db, { resourceId: stylist.id, serviceId: svc.id, startAt: FUTURE }, 'staff-1'))
      .rejects.toMatchObject({ code: 'APPOINTMENT_CONFLICT' });
  });

  it('allows concurrent bookings on different resources at the same time', async () => {
    const room1 = await seedResource(db, { type: 'room', name: 'Room 1' });
    const room2 = await seedResource(db, { type: 'room', name: 'Room 2' });
    const svc = await seedService(db, { durationMinutes: 60 });
    await createAppointment(db, { resourceId: room1.id, serviceId: svc.id, startAt: FUTURE }, 'staff-1');
    await expect(createAppointment(db, { resourceId: room2.id, serviceId: svc.id, startAt: FUTURE }, 'staff-1'))
      .resolves.toBeTruthy();
  });

  it('extends the booked window by the service buffer', async () => {
    const chair = await seedResource(db, { type: 'chair', name: 'Chair B' });
    const svc = await seedService(db, { durationMinutes: 60, bufferBefore: 15, bufferAfter: 15 });
    const start = new Date(Date.now() + 8 * 86_400_000);
    await createAppointment(db, { resourceId: chair.id, serviceId: svc.id, startAt: start.toISOString() }, 'staff-1');
    // A booking starting 5 min after end (within the 15-min buffer) must conflict
    const tooEarly = new Date(start.getTime() + 65 * 60_000).toISOString();
    await expect(createAppointment(db, { resourceId: chair.id, serviceId: svc.id, startAt: tooEarly }, 'staff-1'))
      .rejects.toMatchObject({ code: 'APPOINTMENT_CONFLICT' });
    // One starting at exactly end + buffer is fine
    const ok = new Date(start.getTime() + 75 * 60_000).toISOString();
    await expect(createAppointment(db, { resourceId: chair.id, serviceId: svc.id, startAt: ok }, 'staff-1'))
      .resolves.toBeTruthy();
  });

  it('walks the lifecycle and writes history', async () => {
    const r = await seedResource(db, { type: 'provider', name: 'Dr X' });
    const svc = await seedService(db, { durationMinutes: 30 });
    const { id } = await createAppointment(db, { resourceId: r.id, serviceId: svc.id, startAt: FUTURE }, 'staff-1');
    await transitionStatus(db, id, 'check_in', 'staff-1', {});
    await transitionStatus(db, id, 'start', 'staff-1', {});
    await transitionStatus(db, id, 'complete', 'staff-1', {});
    // Illegal: completed -> check_in
    await expect(transitionStatus(db, id, 'check_in', 'staff-1', {}))
      .rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
  });

  it('cancel frees the slot for rebooking', async () => {
    const r = await seedResource(db, { type: 'room', name: 'Room Z' });
    const svc = await seedService(db, { durationMinutes: 60 });
    const { id } = await createAppointment(db, { resourceId: r.id, serviceId: svc.id, startAt: FUTURE }, 'staff-1');
    await transitionStatus(db, id, 'cancel', 'staff-1', { reason: 'No-show caller' });
    // Same window should now be bookable
    await expect(createAppointment(db, { resourceId: r.id, serviceId: svc.id, startAt: FUTURE }, 'staff-1'))
      .resolves.toBeTruthy();
  });

  it('reschedule moves the appointment and frees the old window', async () => {
    const r = await seedResource(db, { type: 'provider', name: 'Dr Y' });
    const svc = await seedService(db, { durationMinutes: 60 });
    const start = new Date(Date.now() + 9 * 86_400_000);
    const { id } = await createAppointment(db, { resourceId: r.id, serviceId: svc.id, startAt: start.toISOString() }, 'staff-1');
    const moved = new Date(start.getTime() + 2 * 86_400_000).toISOString(); // +2 days
    await rescheduleAppointment(db, id, moved, 'staff-1');
    // Old window is now free
    await expect(createAppointment(db, { resourceId: r.id, serviceId: svc.id, startAt: start.toISOString() }, 'staff-1'))
      .resolves.toBeTruthy();
  });
});
```

- [ ] **Step 3: Run the tests**

Run: `cd backend && pnpm vitest run src/modules/scheduling/service.test.ts`
Expected: all 6 tests PASS. If the DB harness helpers don't exist, create them first (Step 1) — this is the one place the plan allows creating shared test infrastructure.

- [ ] **Step 4: Commit**

```bash
cd backend
git add src/modules/scheduling/service.test.ts src/test/helpers.ts
git commit -m "test(scheduling): conflict matrix, buffer, lifecycle, reschedule, cancel-frees-slot"
```

---

## Task 20: End-to-end smoke check via HTTP

Verify the whole stack wires together by exercising the API.

- [ ] **Step 1: Enable the APPOINTMENTS flag on a dev tenant**

Run the dev server (`cd backend && pnpm dev`) and use the platform-admin API to enable the flag for a dev tenant:

```bash
# Substitute a real tenant id + a valid platform-admin token
curl -X PUT http://localhost:3000/v1/admin/tenants/<tenant-id>/flags \
  -H "Authorization: Bearer <platform-admin-token>" \
  -H "Content-Type: application/json" \
  -d '{"flags":[{"key":"appointments","enabled":true}]}'
```
Expected: 200 with the resolved flags including `appointments: true`.

- [ ] **Step 2: Create a resource, service, then an appointment (as a tenant user)**

```bash
# Create a room resource
curl -X POST http://<tenant-subdomain>.localhost:3000/v1/resources \
  -H "Authorization: Bearer <tenant-token>" -H "Content-Type: application/json" \
  -d '{"name":"Exam Room 1","type":"room"}'

# Create a 30-min service
curl -X POST http://<tenant-subdomain>.localhost:3000/v1/services \
  -H "Authorization: Bearer <tenant-token>" -H "Content-Type: application/json" \
  -d '{"name":"Consultation","durationMinutes":30,"bufferAfterMinutes":15}'

# Book an appointment (substitute the resource + service ids)
curl -X POST http://<tenant-subdomain>.localhost:3000/v1/appointments \
  -H "Authorization: Bearer <tenant-token>" -H "Content-Type: application/json" \
  -d '{"resourceId":"<resource-id>","serviceId":"<service-id>","startAt":"2026-07-15T14:00:00.000Z"}'
```
Expected: 201 with `{ "id": "..." }`.

- [ ] **Step 3: Attempt a conflicting booking — expect 409**

```bash
curl -X POST http://<tenant-subdomain>.localhost:3000/v1/appointments \
  -H "Authorization: Bearer <tenant-token>" -H "Content-Type: application/json" \
  -d '{"resourceId":"<same-resource-id>","serviceId":"<same-service-id>","startAt":"2026-07-15T14:00:00.000Z"}'
```
Expected: 409 with `{"error":{"code":"APPOINTMENT_CONFLICT","message":"...","details":{"conflicting_resources":[...]}}}`.

- [ ] **Step 4: Transition the appointment through the lifecycle**

```bash
# Check in
curl -X PATCH http://<tenant-subdomain>.localhost:3000/v1/appointments/<id> \
  -H "Authorization: Bearer <tenant-token>" -H "Content-Type: application/json" \
  -d '{"action":"check_in"}'

# View the history
curl http://<tenant-subdomain>.localhost:3000/v1/appointments/<id>/history \
  -H "Authorization: Bearer <tenant-token>"
```
Expected: 204 on the PATCH; the history GET returns the timeline including the creation + check-in rows.

- [ ] **Step 5: Verify the flag-off case returns 404**

Disable the flag (Step 1 with `enabled:false`), then re-hit any scheduling endpoint. Expected: 404. Re-enable it afterward.

---

## Task 21: Minimal frontend create-appointment form

This is the only frontend work in Phase 1 — a basic form to exercise the API. The full staff calendar workspace is Phase 2.

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Create: `frontend/src/features/calendar/CreateAppointmentForm.tsx`

- [ ] **Step 1: Add API methods**

In `frontend/src/lib/api.ts`, add (following the existing `api.listClients()` pattern):

```typescript
async createResource(input: { name: string; type: string }) {
  return post<{ id: string }>('/v1/resources', input);
},
async listServices() {
  return get<{ services: Service[] }>('/v1/services');
},
async createAppointment(input: { resourceId: string; serviceId?: string; startAt: string; durationMinutes?: number }) {
  return post<{ id: string }>('/v1/appointments', input);
},
```

(Adapt the `post`/`get` helpers and types to whatever `api.ts` already uses.)

- [ ] **Step 2: Write the form component**

Create `frontend/src/features/calendar/CreateAppointmentForm.tsx` — a react-hook-form + zod form inside a `<Modal>` (following the `clients` feature's form pattern). Fields: service select, resource select, start datetime. On submit, call `api.createAppointment()`. Keep it minimal — this is scaffolding to exercise the API, not the phase-2 calendar.

- [ ] **Step 3: Wire it into the sidebar/app behind the `APPOINTMENTS` flag**

Use `useFlag(FeatureFlag.APPOINTMENTS)` to conditionally render the nav entry + form (following the existing flag-gating pattern in the frontend).

- [ ] **Step 4: Verify it builds**

Run: `cd frontend && pnpm build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
cd frontend
git add src/lib/api.ts src/features/calendar/
git commit -m "feat(calendar): minimal create-appointment form (phase 1 scaffolding)"
```

---

## Done — Phase 1 complete

After Task 21, the scheduling core is functional end-to-end:
- Resources, services, and availability are manageable.
- Appointments can be created (conflict-checked), rescheduled, and walked through the full lifecycle.
- Double-booking is physically prevented by the GiST constraint.
- The APPOINTMENTS feature flag gates the whole module.

Deferred to later phases (per the spec):
- **Phase 2:** slot availability endpoint + full staff calendar workspace UI.
- **Phase 3:** recurring series + reminders (needs queue/notification infra).
- **Phase 4:** Google Calendar two-way sync.
- **Phase 5:** client self-service booking portal.

Run the full test suite as a final check: `cd backend && pnpm vitest run`
