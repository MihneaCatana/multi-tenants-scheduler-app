/**
 * Application-level HTTP error helpers.
 *
 * Throwing one of these anywhere in a request handler lets the centralized
 * error plugin translate it into a clean JSON response. Unknown errors are
 * never leaked to the client in production.
 *
 * Each helper returns an HttpError with a stable machine-readable `code`. The
 * frontend maps these codes to localized strings via the i18n system — the
 * English `message` field is a human-readable fallback for API consumers that
 * don't use code-based mapping.
 */

export class HttpError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

// ---------------------------------------------------------------------------
// Generic helpers (used across many contexts)
// ---------------------------------------------------------------------------

export const badRequest = (message: string, details?: unknown) =>
  new HttpError(400, 'BAD_REQUEST', message, details);
export const unauthorized = (message = 'Unauthorized.') =>
  new HttpError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'Forbidden.') =>
  new HttpError(403, 'FORBIDDEN', message);
export const notFound = (message = 'Not found.') =>
  new HttpError(404, 'NOT_FOUND', message);
export const conflict = (message: string, details?: unknown) =>
  new HttpError(409, 'CONFLICT', message, details);
export const tooManyRequests = (message = 'Too many requests.') =>
  new HttpError(429, 'TOO_MANY_REQUESTS', message);
export const unprocessable = (message: string, details?: unknown) =>
  new HttpError(422, 'UNPROCESSABLE_ENTITY', message, details);
export const internal = (message = 'Internal server error.') =>
  new HttpError(500, 'INTERNAL', message);

// ---------------------------------------------------------------------------
// Specific, domain-scoped helpers
//
// Each has a unique error code so the frontend can map it to a localized
// string. The English message is a human-readable fallback.
// ---------------------------------------------------------------------------

/** Login: wrong email or password (global). */
export const invalidCredentials = () =>
  new HttpError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');

/** Password change: current password is wrong. */
export const wrongPassword = () =>
  new HttpError(401, 'WRONG_PASSWORD', 'Current password is incorrect.');

/** Refresh: presented refresh token not found / revoked. */
export const invalidRefreshToken = () =>
  new HttpError(401, 'INVALID_REFRESH_TOKEN', 'Invalid refresh token.');

/** Refresh: reuse of a previously-revoked token detected (possible theft). */
export const tokenReuseDetected = () =>
  new HttpError(401, 'TOKEN_REUSE_DETECTED', 'Refresh token reuse detected. All sessions revoked.');

/** Refresh: presented token has expired. */
export const tokenExpired = () =>
  new HttpError(401, 'TOKEN_EXPIRED', 'Refresh token expired.');

/** Auth: the user record backing the token no longer exists. */
export const userGone = () =>
  new HttpError(401, 'USER_GONE', 'User no longer exists.');

/** Refresh: no refresh cookie or body token provided. */
export const noRefreshToken = () =>
  new HttpError(400, 'NO_REFRESH_TOKEN', 'No refresh token provided.');

// --- Tenant / provisioning ---

/** Provisioning: subdomain format is invalid. */
export const invalidSubdomain = () =>
  new HttpError(400, 'INVALID_SUBDOMAIN', 'Invalid subdomain. Use lowercase letters, digits, hyphens (max 63).');

/** Provisioning: subdomain is too short. */
export const subdomainTooShort = () =>
  new HttpError(400, 'SUBDOMAIN_TOO_SHORT', 'Subdomain must be at least 2 characters.');

/** Provisioning: subdomain already taken. */
export const subdomainTaken = () =>
  new HttpError(409, 'SUBDOMAIN_TAKEN', 'Unable to create tenant with the requested subdomain.');

/** Provisioning: DB creation or migration failed. */
export const tenantInitFailed = () =>
  new HttpError(500, 'TENANT_INIT_FAILED', 'Tenant database initialization failed.');

/** Admin: tenant status already equals the requested status. */
export const tenantAlreadyHasStatus = (status: string) =>
  new HttpError(409, `ALREADY_${status.toUpperCase()}`, `Tenant is already ${status}.`);

/** Admin: CAS guard — tenant status changed under us. */
export const tenantConcurrentUpdate = () =>
  new HttpError(409, 'TENANT_CONCURRENT_UPDATE', 'Tenant status changed concurrently; reload and retry.');

// --- Staff management ---

/** Staff: member not found. */
export const staffNotFound = () =>
  new HttpError(404, 'STAFF_NOT_FOUND', 'Staff member not found.');

/** Staff: cannot change own role. */
export const cannotChangeOwnRole = () =>
  new HttpError(403, 'CANNOT_CHANGE_OWN_ROLE', 'You cannot change your own role.');

/** Staff: cannot deactivate self. */
export const cannotDeactivateSelf = () =>
  new HttpError(403, 'CANNOT_DEACTIVATE_SELF', 'You cannot deactivate yourself.');

/** Staff: member already has the requested status. */
export const staffAlreadyHasStatus = (active: boolean) =>
  new HttpError(409, active ? 'ALREADY_ACTIVE' : 'ALREADY_INACTIVE', `Staff member is already ${active ? 'active' : 'inactive'}.`);

/** Staff: email already taken. */
export const staffEmailTaken = () =>
  new HttpError(409, 'EMAIL_TAKEN', 'A staff member with this email already exists.');

/** Staff: staff member has already been soft-deleted. */
export const staffAlreadyDeleted = () =>
  new HttpError(409, 'ALREADY_DELETED', 'Staff member has already been deleted.');

// --- Clients ---

/** Client: not found. */
export const clientNotFound = () =>
  new HttpError(404, 'CLIENT_NOT_FOUND', 'Client not found.');

// --- Feature flags ---

/** Flags: unknown feature keys in the request. */
export const unknownFeatureKeys = (keys: string[]) =>
  new HttpError(400, 'UNKNOWN_FEATURE_KEYS', `Unknown feature key(s): ${keys.join(', ')}`);

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
