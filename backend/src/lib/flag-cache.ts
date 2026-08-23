import { env } from '../config/env.js';
import type { TenantFlags } from './flags.js';

interface CacheEntry {
  flags: TenantFlags;
  expiresAt: number;
}

/**
 * Per-tenant resolved-flag cache. SMB-scale read volume makes a tiny in-process
 * map with a short TTL sufficient — no Redis. Entries are invalidated explicitly
 * on writes (admin toggle clears that tenant) and the whole map is cleared on
 * catalog sync (defaults may have changed).
 */
const cache = new Map<string, CacheEntry>();
const TTL_MS = env.FLAG_CACHE_TTL_MS;

export function getCachedFlags(tenantId: string): TenantFlags | undefined {
  const entry = cache.get(tenantId);
  if (!entry) return undefined;
  if (Date.now() >= entry.expiresAt) {
    cache.delete(tenantId);
    return undefined;
  }
  return entry.flags;
}

export function setCachedFlags(tenantId: string, flags: TenantFlags): void {
  cache.set(tenantId, { flags, expiresAt: Date.now() + TTL_MS });
}

/** Drop one tenant's entry — call after an admin override write. */
export function invalidateTenant(tenantId: string): void {
  cache.delete(tenantId);
}

/** Drop every entry — call after catalog sync (defaults may have changed). */
export function clearFlagCache(): void {
  cache.clear();
}
