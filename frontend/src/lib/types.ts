/**
 * Shared domain types. These mirror the backend's response shapes exactly
 * (see backend src/controllers/*). Keeping them in one place means a change
 * to the API surfaces in one spot rather than scattered across features.
 */

export type Role = 'platform_admin' | 'tenant_admin' | 'tenant_user';

/** Tenant status enum (admin.controller.ts PATCH /admin/tenants/:id/status). */
export type TenantStatus = 'active' | 'suspended';

/**
 * User as returned by /auth/login and /auth/refresh.
 * Auth state is derived from login/refresh — /auth/me is not used by the frontend.
 */
export interface AuthUser {
  id: string;
  email: string;
  role: Role;
  tenantId: string | null;
  firstName?: string | null;
  lastName?: string | null;
  active?: boolean;
  mustChangePassword?: boolean;
}

/** POST /auth/login & /auth/refresh success body. */
export interface AuthResponse {
  user: AuthUser;
  accessToken: string;
  expiresIn: number;
}

/** Tenant row from GET /admin/tenants. */
export interface TenantSummary {
  id: string;
  name: string;
  subdomain: string;
  status: TenantStatus;
  createdAt: string;
}

/** Staff member as returned by /staff and /staff/:id. */
export interface StaffMember {
  id: string;
  email: string;
  role: Role;
  tenantId: string | null;
  firstName: string | null;
  lastName: string | null;
  active: boolean;
  mustChangePassword: boolean;
}

export interface ListStaffResult {
  staff: StaffMember[];
}

export interface StaffUpdateResult {
  staff: StaffMember;
}

export interface ResetPasswordResult {
  temporaryPassword: string;
}

/** One catalog entry, as returned by GET /admin/features (read-only). */
export interface FeatureDef {
  key: string;
  label: string;
  description: string;
  enabled: boolean; // platform default
}

/** One resolved flag for a tenant, as returned by GET/PUT /admin/tenants/:id/flags. */
export interface ResolvedFlag {
  key: string;
  enabled: boolean;
}

export interface ListFeaturesResult {
  features: FeatureDef[];
}

export interface GetTenantFlagsResult {
  flags: ResolvedFlag[];
}

export interface UpdateTenantFlagsBody {
  flags: { key: string; enabled: boolean }[];
}

/** GET /features (tenant subdomain) — this tenant's resolved flag map. */
export interface MyFlagsResult {
  flags: Record<string, boolean>;
}

/** Full provision result from POST /admin/tenants. */
export interface ProvisionResult {
  tenant: {
    id: string;
    name: string;
    subdomain: string;
    status: TenantStatus;
    createdAt: string;
    updatedAt: string;
  };
}

/** Client row from the tenant-scoped /clients endpoints. */
export interface Client {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Backend's uniform error shape ({ error: { code, message, details? } }). */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/** Discriminated union for fetch results the UI can branch on. */
export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; message: string; details?: unknown };

// --- Scheduling ---

export type ResourceType = 'provider' | 'room' | 'equipment' | 'chair';

export interface Resource {
  id: string;
  name: string;
  type: ResourceType;
  linkedStaffId: string | null;
  isActive: boolean;
  notes: string | null;
}

export interface Service {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  durationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  price: number | null;
  isActive: boolean;
}

export type AppointmentStatus =
  | 'requested' | 'confirmed' | 'checked_in' | 'in_progress'
  | 'completed' | 'cancelled' | 'no_show';

export interface Appointment {
  id: string;
  clientId: string | null;
  primaryResourceId: string;
  serviceIds: string[];
  startAt: string;
  endAt: string;
  status: AppointmentStatus;
  summary: string | null;
  notes: string | null;
  cancellationReason: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Nested under AppointmentDetail.resources; from GET /v1/appointments/:id. */
export interface AppointmentResource {
  id: string;
  appointmentId: string;
  resourceId: string;
  role: 'primary' | 'additional';
}

/** GET /v1/appointments/:id returns the appointment merged with resources[]. */
export type AppointmentDetail = Appointment & { resources: AppointmentResource[] };

/** GET /v1/appointments/:id/history → { history: AppointmentStatusHistory[] }. */
export interface AppointmentStatusHistory {
  id: string;
  fromStatus: AppointmentStatus | null;
  toStatus: AppointmentStatus;
  note: string | null;
  createdAt: string;
}

export interface WorkingHour {
  id: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  validFrom: string;
  validTo: string | null;
}

export interface TimeOff {
  id: string;
  startAt: string;
  endAt: string;
  reason: string | null;
}

/** GET/PUT /v1/services/:id/requirements → { requirements: ServiceResourceRequirement[] }. */
export interface ServiceResourceRequirement {
  id: string;
  resourceType: ResourceType;
  quantity: number;
  isRequired: boolean;
}

/** PATCH /v1/appointments/:id body — discriminated union on `action`. */
export type AppointmentActionBody =
  | { action: 'cancel'; reason?: string }
  | { action: 'check_in'; note?: string }
  | { action: 'start'; note?: string }
  | { action: 'complete'; note?: string }
  | { action: 'no_show'; note?: string }
  | { action: 'reschedule'; startAt: string; durationMinutes?: number };

/** The set of `action` values above. */
export type AppointmentAction =
  | 'cancel' | 'check_in' | 'start' | 'complete' | 'no_show' | 'reschedule';
