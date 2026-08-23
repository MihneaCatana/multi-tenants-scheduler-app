import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';

/**
 * Per-tenant owner-role credential derivation.
 *
 * Each tenant DB is owned by a dedicated PostgreSQL role `tenant_<sub>_owner`
 * whose password is derived deterministically from the tenant id and a single
 * master key:
 *
 *   password = HMAC-SHA256(TENANT_OWNER_MASTER_KEY, tenantId)   [hex]
 *
 * Why HMAC-derived instead of random-and-stored:
 *  - No password table to leak and no secrets manager required. Any code path
 *    can recompute the password for a tenant on the fly.
 *  - Defense in depth: the master key alone is useless without tenant ids
 *    (which live in simi_global); tenant ids alone (from a global dump) are
 *    useless without the master key. Two secrets, two locations.
 *  - Rotation = change TENANT_OWNER_MASTER_KEY + run an ALTER ROLE ... PASSWORD
 *    loop over every tenant (see CODEBASE.md §15).
 *
 * Security property: a leaked per-tenant owner credential lets an attacker
 * destroy exactly ONE tenant DB (their own). It cannot reach any other tenant
 * or the global cluster. See the blast-radius table in CODEBASE.md §15.
 */

/**
 * Derive the PostgreSQL password for a tenant's owner role.
 * Deterministic: same (tenantId, master key) always yields the same password.
 */
export function deriveTenantOwnerPassword(tenantId: string): string {
  return createHmac('sha256', env.TENANT_OWNER_MASTER_KEY)
    .update(tenantId)
    .digest('hex');
}

/**
 * Constant-time check that a presented password matches the derived owner
 * password for a tenant. Used by any path that authenticates as an owner role.
 */
export function isValidTenantOwnerPassword(
  tenantId: string,
  presented: string,
): boolean {
  const expected = deriveTenantOwnerPassword(tenantId);
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Per-tenant app-role credential derivation.
 *
 * Each tenant DB gets a dedicated PostgreSQL role `tenant_<sub>_app` (see
 * subdomainToAppRole in subdomain.ts) whose password is derived from the app
 * master key:
 *
 *   password = HMAC-SHA256(TENANT_APP_MASTER_KEY, tenantId)   [hex]
 *
 * This mirrors the owner-role derivation pattern (TENANT_OWNER_MASTER_KEY)
 * but uses a separate key so compromise of one tier does not expose the other.
 *
 * Security property: a leaked per-tenant app credential lets an attacker
 * read/write exactly ONE tenant DB. It cannot reach any other tenant DB.
 */

/**
 * Derive the PostgreSQL password for a tenant's app role.
 * Deterministic: same (tenantId, app master key) always yields the same password.
 */
export function deriveTenantAppPassword(tenantId: string): string {
  return createHmac('sha256', env.TENANT_APP_MASTER_KEY)
    .update(tenantId)
    .digest('hex');
}

/**
 * Constant-time check that a presented password matches the derived app
 * password for a tenant.
 */
export function isValidTenantAppPassword(
  tenantId: string,
  presented: string,
): boolean {
  const expected = deriveTenantAppPassword(tenantId);
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
