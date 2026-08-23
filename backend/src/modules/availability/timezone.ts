import { eq } from 'drizzle-orm';
import type { TenantDb } from '../../db/tenant-pool.js';
import { tenantSettings } from '../../db/schema/tenant/tenant-settings.js';
import { env } from '../../config/env.js';

/**
 * Read the tenant's timezone (e.g. 'Europe/Bucharest'). Defaults to the
 * platform default (`DEFAULT_TENANT_TIMEZONE` env, fallback 'UTC') when unset.
 */
export async function getTenantTimezone(db: TenantDb): Promise<string> {
  const [row] = await db
    .select()
    .from(tenantSettings)
    .where(eq(tenantSettings.key, 'timezone'))
    .limit(1);
  return row?.value ?? env.DEFAULT_TENANT_TIMEZONE ?? 'UTC';
}

/** Upsert the tenant timezone. */
export async function setTenantTimezone(db: TenantDb, tz: string): Promise<void> {
  await db
    .insert(tenantSettings)
    .values({ key: 'timezone', value: tz })
    .onConflictDoUpdate({ target: tenantSettings.key, set: { value: tz, updatedAt: new Date() } });
}
