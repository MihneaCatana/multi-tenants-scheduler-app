/**
 * Backend error code → frontend translation key mapping.
 *
 * The backend returns stable machine-readable error codes in its responses.
 * This module maps those codes to i18n translation keys so the UI can
 * display localized messages.
 *
 * Unknown codes fall back to the raw backend message (in English) via the
 * fallback translation key.
 */

/**
 * Map a backend error code to an i18n translation key.
 * Returns 'error_unknown' if the code has no specific mapping.
 */
export function getErrorKey(code: string): string {
  const mapped = ERROR_CODE_MAP[code];
  return mapped ?? 'error_unknown';
}

/**
 * All known backend error codes mapped to their i18n translation keys.
 */
const ERROR_CODE_MAP: Record<string, string> = {
  // Generic HTTP errors
  BAD_REQUEST: 'error_badRequest',
  UNAUTHORIZED: 'error_unauthorized',
  FORBIDDEN: 'error_forbidden',
  NOT_FOUND: 'error_notFound',
  VALIDATION_ERROR: 'error_validationError',
  CONFLICT: 'error_conflict',
  TOO_MANY_REQUESTS: 'error_tooManyRequests',
  INTERNAL: 'error_internal',
  UNPROCESSABLE_ENTITY: 'error_badRequest',

  // Auth-specific
  INVALID_CREDENTIALS: 'error_invalidCredentials',
  WRONG_PASSWORD: 'error_wrongPassword',
  INVALID_REFRESH_TOKEN: 'error_invalidRefreshToken',
  TOKEN_REUSE_DETECTED: 'error_tokenReuseDetected',
  TOKEN_EXPIRED: 'error_tokenExpired',
  USER_GONE: 'error_userGone',
  NO_REFRESH_TOKEN: 'error_noRefreshToken',

  // Tenant / provisioning
  INVALID_SUBDOMAIN: 'error_invalidSubdomain',
  SUBDOMAIN_TOO_SHORT: 'error_subdomainTooShort',
  SUBDOMAIN_TAKEN: 'error_subdomainTaken',
  TENANT_INIT_FAILED: 'error_tenantInitFailed',
  ALREADY_ACTIVE: 'error_alreadyActive',
  ALREADY_INACTIVE: 'error_alreadyInactive',
  ALREADY_SUSPENDED: 'error_alreadySuspended',
  TENANT_CONCURRENT_UPDATE: 'error_tenantConcurrentUpdate',

  // Staff management
  STAFF_NOT_FOUND: 'error_staffNotFound',
  CANNOT_CHANGE_OWN_ROLE: 'error_cannotChangeOwnRole',
  CANNOT_DEACTIVATE_SELF: 'error_cannotDeactivateSelf',
  EMAIL_TAKEN: 'error_emailTaken',
  ALREADY_DELETED: 'error_alreadyDeleted',

  // Clients
  CLIENT_NOT_FOUND: 'error_clientNotFound',

  // Feature flags
  UNKNOWN_FEATURE_KEYS: 'error_unknownFeatureKeys',

  // Zod validation sub-codes
  TOO_SHORT: 'error_tooShort',
  TOO_LONG: 'error_tooLong',
  TOO_SMALL: 'error_tooSmall',
  TOO_LARGE: 'error_tooLarge',
  INVALID_EMAIL: 'error_invalidEmail',
  INVALID_UUID: 'error_invalidUuid',
  INVALID_STRING: 'error_invalidString',
  INVALID_OPTION: 'error_invalidOption',
  INVALID_TYPE: 'error_invalidType',
  TOO_FEW_ITEMS: 'error_tooFewItems',
  TOO_MANY_ITEMS: 'error_tooManyItems',
};
