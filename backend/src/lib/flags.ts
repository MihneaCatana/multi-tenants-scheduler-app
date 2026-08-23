import type { FastifyRequest } from 'fastify';

/**
 * The set of known feature flags. This is the code-side *view* of the
 * catalog: the DB owns definitions (see src/lib/flag-catalog.ts and the
 * `features` table), and this enum owns typo-proof, autocomplete-friendly
 * gating in code. `FLAG_CATALOG` keys and `FeatureFlag` values MUST agree —
 * `syncFlagCatalog` asserts this at boot.
 *
 * Add a flag = add an entry here AND a matching entry in `FLAG_CATALOG`.
 */
export const FeatureFlag = {
  RESERVATIONS: 'reservations',
  INVENTORY: 'inventory',
  POS: 'pos',
  APPOINTMENTS: 'appointments',
} as const;
// eslint-disable-next-line no-redeclare -- intentional const+type sharing (value object + derived union)
export type FeatureFlag = (typeof FeatureFlag)[keyof typeof FeatureFlag];

/**
 * A resolved per-tenant flag map: `{ [flagKey]: enabled }`. Attached to
 * `req.tenantFlags` by the tenant-resolution hook for tenant-scoped requests;
 * `undefined` for apex/bypass requests (flags are tenant-scoped by definition).
 */
export type TenantFlags = Record<string, boolean>;

declare module 'fastify' {
  interface FastifyRequest {
    tenantFlags?: TenantFlags;
  }
}

/**
 * Check whether a flag is enabled for the request's tenant. Uses the flags
 * already attached to `req` by the tenant hook (cached, override-or-default
 * resolved). Returns `false` when there is no resolved tenant (apex/bypass) or
 * the flag is unknown/absent.
 *
 * Always pass a `FeatureFlag.*` member — never a raw string literal — so the
 * call site is typo-checked at compile time.
 */
export function isEnabled(req: FastifyRequest, flag: FeatureFlag): boolean {
  return req.tenantFlags?.[flag] === true;
}
