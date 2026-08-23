import { and, eq } from 'drizzle-orm';
import { globalDb } from '../../db/client.js';
import { features, tenantFeatures } from '../../db/schema/global/features.js';
import { tenants } from '../../db/schema/global/tenants.js';
import { notFound, unknownFeatureKeys } from '../../lib/errors.js';
import {
  getCachedFlags,
  setCachedFlags,
  invalidateTenant,
} from '../../lib/flag-cache.js';
import { FLAG_CATALOG, type CatalogEntry } from '../../lib/flag-catalog.js';
import type { TenantFlags } from '../../lib/flags.js';

/** One row of the read-only catalog, as returned by GET /admin/features. */
export function listCatalog(): CatalogEntry[] {
  return FLAG_CATALOG.map((f) => ({ ...f }));
}

/**
 * Resolve every flag for a tenant: an explicit override wins, else the catalog
 * default. One LEFT JOIN, no N+1. Result is cached (short TTL); writes
 * invalidate the entry.
 */
export async function getTenantFlags(tenantId: string): Promise<TenantFlags> {
  const cached = getCachedFlags(tenantId);
  if (cached) return cached;

  const rows = await globalDb
    .select({
      key: features.key,
      enabled: tenantFeatures.enabled,
      defaultEnabled: features.enabled,
    })
    .from(features)
    .leftJoin(
      tenantFeatures,
      and(eq(tenantFeatures.featureId, features.id), eq(tenantFeatures.tenantId, tenantId)),
    );

  const flags: TenantFlags = {};
  for (const r of rows) {
    // override wins; else the catalog default. NoUncheckedIndexedAccess makes
    // r.enabled nullable (LEFT JOIN), so an explicit `=== null` check is the
    // safe read.
    flags[r.key] = r.enabled === null ? r.defaultEnabled : r.enabled;
  }
  setCachedFlags(tenantId, flags);
  return flags;
}

export interface ResolvedFlag {
  key: string;
  enabled: boolean;
}

/** Resolved set as an ordered array (for the admin UI table). */
export async function getTenantFlagsList(tenantId: string): Promise<ResolvedFlag[]> {
  const flags = await getTenantFlags(tenantId);
  // Order by the catalog definition so the UI is stable.
  return FLAG_CATALOG.map((f) => ({ key: f.key, enabled: flags[f.key] === true }));
}

/**
 * Assert the tenant exists (404 otherwise). Used by admin endpoints that take a
 * `:id` so a non-existent tenant is reported cleanly.
 */
async function assertTenantExists(tenantId: string): Promise<void> {
  const [row] = await globalDb.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!row) throw notFound();
}

export interface FlagOverrideInput {
  key: string;
  enabled: boolean;
}

/**
 * Upsert per-tenant overrides. Each input entry becomes a `tenant_features`
 * upsert (insert-or-update on the composite PK); keys not mentioned are left
 * untouched. Unknown keys (not in the catalog) → 400. Returns the resolved set
 * after the write. Invalidates the tenant's cache entry.
 */
export async function setTenantFlags(
  tenantId: string,
  overrides: FlagOverrideInput[],
): Promise<ResolvedFlag[]> {
  await assertTenantExists(tenantId);

  const validKeys = new Set<string>(FLAG_CATALOG.map((f) => f.key));
  const unknown = overrides.filter((o) => !validKeys.has(o.key));
  if (unknown.length > 0) {
    throw unknownFeatureKeys(unknown.map((u) => u.key));
  }

  // Resolve feature ids for the given keys.
  const idRows = await globalDb.select({ id: features.id, key: features.key }).from(features);
  const keyToId = new Map(idRows.map((r) => [r.key, r.id]));

  for (const o of overrides) {
    const featureId = keyToId.get(o.key);
    if (!featureId) continue; // defensively skip (validated above)
    // Insert-or-update on the composite PK via ON CONFLICT.
    await globalDb
      .insert(tenantFeatures)
      .values({ tenantId, featureId, enabled: o.enabled })
      .onConflictDoUpdate({
        target: [tenantFeatures.tenantId, tenantFeatures.featureId],
        set: { enabled: o.enabled, updatedAt: new Date() },
      });
  }

  invalidateTenant(tenantId);
  return getTenantFlagsList(tenantId);
}
