import type {
  Client,
  ApiErrorBody,
  ApiResult,
  AuthUser,
  ProvisionResult,
  TenantSummary,
  ListStaffResult,
  ResetPasswordResult,
  StaffUpdateResult,
  ListFeaturesResult,
  GetTenantFlagsResult,
  UpdateTenantFlagsBody,
  MyFlagsResult,
  Resource,
  Service,
  Appointment,
  AppointmentDetail,
  AppointmentActionBody,
  AppointmentStatusHistory,
  ServiceResourceRequirement,
  WorkingHour,
  TimeOff,
} from './types';

/**
 * Thin fetch wrapper with auth + automatic refresh-on-401.
 *
 * - The access token lives in memory only (set by the auth provider). It is
 *   never persisted to localStorage to avoid XSS token theft.
 * - The refresh token is an HttpOnly cookie the browser attaches automatically
 *   to same-origin /auth/refresh calls — we never see or store it in JS.
 * - On a 401, the client attempts ONE refresh (via the cookie) and retries the
 *   original request. Concurrent 401s share a single in-flight refresh promise
 *   so a burst of expired-token requests triggers exactly one /auth/refresh.
 * - A module-level `onSessionExpired` callback lets the auth provider react
 *   (clear its state, redirect to /login) without the client importing React.
 */

const JSON_CONTENT_TYPE = 'application/json';

/** API version prefix — matches the backend Fastify route group. */
const API_PREFIX = '/v1';

let accessToken: string | null = null;
let onSessionExpired: (() => void) | null = null;
let onTokenRefreshed: ((token: string) => void) | null = null;

/** In-flight refresh promise, shared across concurrent 401s. */
let inflightRefresh: Promise<string | null> | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAuthCallbacks(cb: {
  onSessionExpired: () => void;
  onTokenRefreshed: (token: string) => void;
}): void {
  onSessionExpired = cb.onSessionExpired;
  onTokenRefreshed = cb.onTokenRefreshed;
}

interface ApiOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** Bypass auto-refresh and session-expiry handling (used by /auth/refresh itself). */
  raw?: boolean;
  /** Expect a 204 No Content response (logout) — resolve with null. */
  allowEmpty?: boolean;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function parseError(res: Response): Promise<ApiError> {
  let message = `Request failed with status ${res.status}`;
  let details: unknown;
  try {
    const body = (await res.json()) as ApiErrorBody;
    if (body?.error?.message) message = body.error.message;
    details = body?.error?.details;
  } catch {
    /* ignore: non-JSON or empty body — fall back to status message above */
  }
  return new ApiError(res.status, message, details);
}

function extractMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return 'Unexpected error';
}

export async function apiFetch<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  const { body, raw = false, allowEmpty = false, headers, ...rest } = opts;

  const init: RequestInit = {
    credentials: 'include', // send + accept the rt cookie
    ...rest,
    headers: {
      ...(body !== undefined ? { 'Content-Type': JSON_CONTENT_TYPE } : {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  };

  const res = await fetch(path, init);

  if (res.status === 401 && !raw) {
    // Attempt a single refresh + retry. If refresh fails, treat as logged out.
    const refreshed = await tryRefresh();
    if (refreshed) {
      const retryInit: RequestInit = {
        ...init,
        headers: { ...init.headers, Authorization: `Bearer ${refreshed}` },
      };
      const retryRes = await fetch(path, retryInit);
      return parseBody<T>(retryRes, allowEmpty);
    }
    onSessionExpired?.();
    throw await parseError(res);
  }

  if (!res.ok) {
    throw await parseError(res);
  }

  return parseBody<T>(res, allowEmpty);
}

async function parseBody<T>(res: Response, allowEmpty: boolean): Promise<T> {
  if (res.status === 204 || allowEmpty) return null as T;
  const text = await res.text();
  if (!text) return null as T;
  return JSON.parse(text) as T;
}

/**
 * Refresh once, deduping concurrent callers. Returns the new access token or
 * null if the session is gone (refresh rejected). The refresh request itself
 * uses `raw: true` to avoid recursive 401 handling.
 */
export async function tryRefresh(): Promise<string | null> {
  if (inflightRefresh) return inflightRefresh;
  inflightRefresh = (async () => {
    try {
      // POST /v1/auth/refresh relies on the rt cookie; no body needed. The new
      // access token comes back in the JSON; the rotated rt is set via cookie.
      const res = await fetch(`${API_PREFIX}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': JSON_CONTENT_TYPE },
        body: JSON.stringify({}),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { accessToken: string; expiresIn: number };
      accessToken = data.accessToken;
      onTokenRefreshed?.(data.accessToken);
      return data.accessToken;
    } catch {
      return null;
    } finally {
      inflightRefresh = null;
    }
  })();
  return inflightRefresh;
}

/**
 * Typed convenience wrappers around the typed endpoints. Centralizing these
 * means feature code calls `api.login(...)` rather than hand-rolling fetches,
 * and the request/response shapes are checked against the types here.
 */
export const api = {
  // --- Auth ---
  login: (body: { email: string; password: string }) =>
    apiFetch<{ user: AuthUser; accessToken: string; expiresIn: number }>(`${API_PREFIX}/auth/login`, {
      method: 'POST',
      body,
    }),
  refresh: () =>
    apiFetch<{ user: AuthUser; accessToken: string; expiresIn: number }>(`${API_PREFIX}/auth/refresh`, {
      method: 'POST',
      body: {},
      raw: true,
    }),
  logout: () => apiFetch<null>(`${API_PREFIX}/auth/logout`, { method: 'POST', allowEmpty: true }),

  // --- Admin (apex) ---
  listTenants: (params?: { status?: 'active' | 'suspended'; limit?: number; offset?: number }) => {
    const qs = new URLSearchParams();
    if (params?.status) qs.set('status', params.status);
    if (params?.limit != null) qs.set('limit', String(params.limit));
    if (params?.offset != null) qs.set('offset', String(params.offset));
    const suffix = qs.toString() ? `?${qs}` : '';
    return apiFetch<{ tenants: TenantSummary[] }>(`${API_PREFIX}/admin/tenants${suffix}`, { method: 'GET' });
  },
  provisionTenant: (body: {
    name: string;
    subdomain: string;
    email: string;
    password: string;
    firstName?: string;
    lastName?: string;
  }) => apiFetch<ProvisionResult>(`${API_PREFIX}/admin/tenants`, { method: 'POST', body }),
  updateTenantStatus: (id: string, status: 'active' | 'suspended') =>
    apiFetch<null>(`${API_PREFIX}/admin/tenants/${id}/status`, {
      method: 'PATCH',
      body: { status },
      allowEmpty: true,
    }),

  // --- Tenant clients (customers) ---
  listClients: () => apiFetch<{ clients: Client[] }>(`${API_PREFIX}/clients`, { method: 'GET' }),
  getClient: (id: string) => apiFetch<Client>(`${API_PREFIX}/clients/${id}`, { method: 'GET' }),
  createClient: (body: {
    name: string;
    email?: string;
    phone?: string;
    notes?: string;
  }) => apiFetch<Client>(`${API_PREFIX}/clients`, { method: 'POST', body }),
  updateClient: (
    id: string,
    body: { name?: string; email?: string; phone?: string; notes?: string },
  ) => apiFetch<Client>(`${API_PREFIX}/clients/${id}`, { method: 'PATCH', body }),
  deleteClient: (id: string) =>
    apiFetch<null>(`${API_PREFIX}/clients/${id}`, { method: 'DELETE', allowEmpty: true }),

  // --- Staff (tenant admin) ---
  listStaff: (params?: { status?: 'active' | 'inactive'; limit?: number; offset?: number }) => {
    const qs = new URLSearchParams();
    if (params?.status) qs.set('status', params.status);
    if (params?.limit != null) qs.set('limit', String(params.limit));
    if (params?.offset != null) qs.set('offset', String(params.offset));
    const suffix = qs.toString() ? `?${qs}` : '';
    return apiFetch<ListStaffResult>(`${API_PREFIX}/staff${suffix}`, { method: 'GET' });
  },
  createStaff: (body: {
    email: string;
    password: string;
    firstName?: string;
    lastName?: string;
  }) => apiFetch<StaffUpdateResult>(`${API_PREFIX}/staff`, { method: 'POST', body }),
  updateStaff: (
    id: string,
    body: { firstName?: string; lastName?: string; role?: 'tenant_admin' | 'tenant_user' },
  ) => apiFetch<StaffUpdateResult>(`${API_PREFIX}/staff/${id}`, { method: 'PATCH', body }),
  resetStaffPassword: (id: string) =>
    apiFetch<ResetPasswordResult>(`${API_PREFIX}/staff/${id}/reset-password`, { method: 'POST' }),
  updateStaffStatus: (id: string, active: boolean) =>
    apiFetch<StaffUpdateResult>(`${API_PREFIX}/staff/${id}/status`, { method: 'PATCH', body: { active } }),
  deleteStaff: (id: string) =>
    apiFetch<null>(`${API_PREFIX}/staff/${id}`, { method: 'DELETE', allowEmpty: true }),

  // --- Self-service ---
  changePassword: (body: { currentPassword: string; newPassword: string }) =>
    apiFetch<null>(`${API_PREFIX}/auth/change-password`, { method: 'POST', body, allowEmpty: true }),

  // --- Feature flags ---
  listFeatures: () => apiFetch<ListFeaturesResult>(`${API_PREFIX}/admin/features`, { method: 'GET' }),
  getTenantFlags: (tenantId: string) =>
    apiFetch<GetTenantFlagsResult>(`${API_PREFIX}/admin/tenants/${tenantId}/flags`, { method: 'GET' }),
  updateTenantFlags: (tenantId: string, body: UpdateTenantFlagsBody) =>
    apiFetch<GetTenantFlagsResult>(`${API_PREFIX}/admin/tenants/${tenantId}/flags`, { method: 'PUT', body }),
  getMyFlags: () => apiFetch<MyFlagsResult>(`${API_PREFIX}/features`, { method: 'GET' }),

  // --- Scheduling: Resources ---
  listResources: (params?: { type?: string; includeInactive?: boolean }) => {
    const qs = new URLSearchParams();
    if (params?.type) qs.set('type', params.type);
    if (params?.includeInactive) qs.set('include_inactive', 'true');
    const suffix = qs.toString() ? `?${qs}` : '';
    return apiFetch<{ resources: Resource[] }>(`${API_PREFIX}/resources${suffix}`, { method: 'GET' });
  },
  getResource: (id: string) =>
    apiFetch<Resource>(`${API_PREFIX}/resources/${id}`, { method: 'GET' }),
  createResource: (body: {
    name: string;
    type: string;
    linkedStaffId?: string;
    notes?: string;
  }) => apiFetch<Resource>(`${API_PREFIX}/resources`, { method: 'POST', body }),
  updateResource: (id: string, body: { name?: string; isActive?: boolean; notes?: string }) =>
    apiFetch<Resource>(`${API_PREFIX}/resources/${id}`, { method: 'PATCH', body }),
  deleteResource: (id: string) =>
    apiFetch<null>(`${API_PREFIX}/resources/${id}`, { method: 'DELETE', allowEmpty: true }),

  // --- Scheduling: Working hours (nested under resource) ---
  listWorkingHours: (resourceId: string) =>
    apiFetch<{ workingHours: WorkingHour[] }>(`${API_PREFIX}/resources/${resourceId}/working-hours`, { method: 'GET' }),
  createWorkingHour: (resourceId: string, body: {
    dayOfWeek: number;
    startTime: string;
    endTime: string;
    validFrom: string;
    validTo?: string;
  }) => apiFetch<WorkingHour>(`${API_PREFIX}/resources/${resourceId}/working-hours`, { method: 'POST', body }),
  updateWorkingHour: (id: string, body: Partial<{
    dayOfWeek: number;
    startTime: string;
    endTime: string;
    validFrom: string;
    validTo: string;
  }>) => apiFetch<WorkingHour>(`${API_PREFIX}/working-hours/${id}`, { method: 'PATCH', body }),
  deleteWorkingHour: (id: string) =>
    apiFetch<null>(`${API_PREFIX}/working-hours/${id}`, { method: 'DELETE', allowEmpty: true }),

  // --- Scheduling: Time off (nested under resource) ---
  listTimeOff: (resourceId: string) =>
    apiFetch<{ timeOff: TimeOff[] }>(`${API_PREFIX}/resources/${resourceId}/time-off`, { method: 'GET' }),
  createTimeOff: (resourceId: string, body: { startAt: string; endAt: string; reason?: string }) =>
    apiFetch<TimeOff>(`${API_PREFIX}/resources/${resourceId}/time-off`, { method: 'POST', body }),
  deleteTimeOff: (id: string) =>
    apiFetch<null>(`${API_PREFIX}/time-off/${id}`, { method: 'DELETE', allowEmpty: true }),

  // --- Scheduling: Services catalog ---
  listServices: (params?: { category?: string; includeInactive?: boolean }) => {
    const qs = new URLSearchParams();
    if (params?.category) qs.set('category', params.category);
    if (params?.includeInactive) qs.set('include_inactive', 'true');
    const suffix = qs.toString() ? `?${qs}` : '';
    return apiFetch<{ services: Service[] }>(`${API_PREFIX}/services${suffix}`, { method: 'GET' });
  },
  getService: (id: string) =>
    apiFetch<Service>(`${API_PREFIX}/services/${id}`, { method: 'GET' }),
  createService: (body: {
    name: string;
    description?: string;
    category?: string;
    durationMinutes: number;
    bufferBeforeMinutes?: number;
    bufferAfterMinutes?: number;
    price?: number;
  }) => apiFetch<Service>(`${API_PREFIX}/services`, { method: 'POST', body }),
  updateService: (id: string, body: {
    name?: string;
    description?: string;
    category?: string;
    durationMinutes?: number;
    bufferBeforeMinutes?: number;
    bufferAfterMinutes?: number;
    price?: number;
  }) => apiFetch<Service>(`${API_PREFIX}/services/${id}`, { method: 'PATCH', body }),
  deleteService: (id: string) =>
    apiFetch<null>(`${API_PREFIX}/services/${id}`, { method: 'DELETE', allowEmpty: true }),
  listRequirements: (serviceId: string) =>
    apiFetch<{ requirements: ServiceResourceRequirement[] }>(`${API_PREFIX}/services/${serviceId}/requirements`, { method: 'GET' }),
  replaceRequirements: (serviceId: string, body: {
    resourceType: string;
    quantity?: number;
    isRequired?: boolean;
  }[]) => apiFetch<{ requirements: ServiceResourceRequirement[] }>(`${API_PREFIX}/services/${serviceId}/requirements`, { method: 'PUT', body }),

  // --- Scheduling: Tenant timezone ---
  getTimezone: () =>
    apiFetch<{ timezone: string }>(`${API_PREFIX}/settings/timezone`, { method: 'GET' }),
  setTimezone: (timezone: string) =>
    apiFetch<{ timezone: string }>(`${API_PREFIX}/settings/timezone`, { method: 'PUT', body: { timezone } }),

  // --- Scheduling: Appointments ---
  listAppointments: (params?: {
    from?: string;
    to?: string;
    resourceId?: string;
    clientId?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }) => {
    const qs = new URLSearchParams();
    if (params?.from) qs.set('from', params.from);
    if (params?.to) qs.set('to', params.to);
    if (params?.resourceId) qs.set('resourceId', params.resourceId);
    if (params?.clientId) qs.set('clientId', params.clientId);
    if (params?.status) qs.set('status', params.status);
    if (params?.limit !== undefined) qs.set('limit', String(params.limit));
    if (params?.offset !== undefined) qs.set('offset', String(params.offset));
    const suffix = qs.toString() ? `?${qs}` : '';
    return apiFetch<{ appointments: Appointment[]; total: number }>(`${API_PREFIX}/appointments${suffix}`, { method: 'GET' });
  },
  getAppointment: (id: string) =>
    apiFetch<AppointmentDetail>(`${API_PREFIX}/appointments/${id}`, { method: 'GET' }),
  createAppointment: (body: {
    clientId?: string;
    serviceIds?: string[];
    resourceId: string;
    additionalResourceIds?: string[];
    startAt: string;
    durationMinutes?: number;
    summary?: string;
    notes?: string;
  }) =>
    apiFetch<{ id: string }>(`${API_PREFIX}/appointments`, { method: 'POST', body }),
  patchAppointment: (id: string, body: AppointmentActionBody) =>
    apiFetch<null>(`${API_PREFIX}/appointments/${id}`, { method: 'PATCH', body, allowEmpty: true }),
  getAppointmentHistory: (id: string) =>
    apiFetch<{ history: AppointmentStatusHistory[] }>(`${API_PREFIX}/appointments/${id}/history`, { method: 'GET' }),

  // --- Result helper (for try/catch ergonomics in components) ---
  toResult: async function <T>(p: Promise<T>): Promise<ApiResult<T>> {
    try {
      return { ok: true, data: await p };
    } catch (err) {
      if (err instanceof ApiError) {
        return { ok: false, status: err.status, message: err.message, details: err.details };
      }
      return { ok: false, status: 0, message: extractMessage(err) };
    }
  },
};

// Re-export the domain types from this module so feature code can import both
// the api client and the types it deals in from one place.
export type {
  Client,
  ApiResult,
  AuthUser,
  FeatureDef,
  GetTenantFlagsResult,
  ListFeaturesResult,
  ListStaffResult,
  MyFlagsResult,
  ProvisionResult,
  StaffMember,
  ResetPasswordResult,
  TenantSummary,
  UpdateTenantFlagsBody,
  StaffUpdateResult,
  Resource,
  Service,
  Appointment,
  AppointmentDetail,
  AppointmentAction,
  AppointmentActionBody,
  AppointmentStatus,
  AppointmentStatusHistory,
  ServiceResourceRequirement,
  WorkingHour,
  TimeOff,
  AppointmentResource,
  ResourceType,
} from './types';
