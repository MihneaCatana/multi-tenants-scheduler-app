import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { and, eq } from 'drizzle-orm';
import { globalDb } from '../db/client.js';
import { tenants } from '../db/schema/global/tenants.js';
import { tenantDbFor, type TenantDb } from '../db/tenant-pool.js';
import { env } from '../config/env.js';
import { getSubdomain, isApexHost } from '../lib/subdomain.js';
import { getTenantLogger } from '../lib/logger.js';
import { getTenantFlags } from '../modules/flags/service.js';
import { notFound, tooManyRequests } from '../lib/errors.js';
import type { Tenant } from '../db/schema/global/tenants.js';

// ---------------------------------------------------------------------------
// Unknown-subdomain rate limiter (in-memory, per IP).
// Prevents automated tenant enumeration by throttling rapid probing of
// different subdomains from the same source IP.
// ---------------------------------------------------------------------------

/** Tracks per-IP request counts: Map<ip, { count, windowStart }>. */
const probeTracker = new Map<string, { count: number; windowStart: number }>();

const PROBE_WINDOW_MS = 60_000; // 1 minute sliding window
const PROBE_MAX_UNKNOWN = 5; // max unknown-subdomain requests per window

function cleanProbeTracker(): void {
  const now = Date.now();
  for (const [ip, entry] of probeTracker) {
    if (now - entry.windowStart > PROBE_WINDOW_MS) {
      probeTracker.delete(ip);
    }
  }
}

function isProbeRateLimited(ip: string): boolean {
  const now = Date.now();
  let entry = probeTracker.get(ip);
  if (!entry || now - entry.windowStart > PROBE_WINDOW_MS) {
    entry = { count: 0, windowStart: now };
    probeTracker.set(ip, entry);
  }
  entry.count++;
  return entry.count > PROBE_MAX_UNKNOWN;
}

declare module 'fastify' {
  interface FastifyRequest {
    tenant?: Tenant;
    tenantDb?: TenantDb;
  }
}

export interface TenantPluginOptions {
  /**
   * Route prefixes that should bypass tenant resolution (e.g. health, admin
   * endpoints that run on the apex host). Default: ['/health', '/admin'].
   */
  bypassPrefixes?: string[];
}

/**
 * Resolve the request's subdomain to a tenant, look it up in the global DB, and
 * attach a typed tenant-scoped Drizzle instance to `request.tenantDb`.
 *
 * Rules:
 * - Apex host (no subdomain) when APEX_IS_ADMIN_HOST: no tenant attached;
 *   routes that require a tenant will 403/404 in the auth plugin.
 * - Unknown / suspended tenant -> 404 (we deliberately don't reveal "exists
 *   but suspended").
 */
export default fp(
  async (app: FastifyInstance, opts: TenantPluginOptions = {}) => {
    const bypass = new Set(opts.bypassPrefixes ?? ['/health', '/admin']);

    // Periodically clean up the probe rate-limit tracker to prevent unbounded
    // memory growth. Every 5 minutes is sufficient — the window is 1 minute.
    const cleanupTimer = setInterval(cleanProbeTracker, 5 * 60_000);
    app.addHook('onClose', () => clearInterval(cleanupTimer));

    app.addHook('onRequest', async (req: FastifyRequest, _reply: FastifyReply) => {
      const urlPath = req.url.split('?')[0]!;
      // Skip tenant resolution for bypass prefixes and the apex admin host.
      const isBypassByPath = [...bypass].some((p) => urlPath === p || urlPath.startsWith(p + '/'));

      if (isApexHost(req.hostname)) {
        if (env.APEX_IS_ADMIN_HOST) {
          // Apex = admin host. No tenant context.
          return;
        }
        // If apex is not the admin host and we got here without a subdomain,
        // treat as unknown tenant.
        throw notFound();
      }

      if (isBypassByPath) {
        // Allow admin/health on a subdomain too (rare), but do not attach a
        // tenant — admin routes are global anyway.
        return;
      }

      const subdomain = getSubdomain(req.hostname);
      if (!subdomain) {
        throw notFound();
      }

      const [tenant] = await globalDb
        .select()
        .from(tenants)
        .where(and(eq(tenants.subdomain, subdomain), eq(tenants.status, 'active')))
        .limit(1);

      if (!tenant) {
        // Rate-limit unknown-subdomain probes to prevent automated tenant
        // enumeration. After PROBE_MAX_UNKNOWN requests per IP per minute,
        // return 429 instead of 404. The message is intentionally generic.
        if (isProbeRateLimited(req.ip)) {
          throw tooManyRequests();
        }
        throw notFound();
      }

      req.tenant = tenant;
      req.tenantDb = tenantDbFor(tenant.id, tenant.dbName, tenant.subdomain);
      // Route request logs to this tenant's daily file. The child logger carries
      // tenantSubdomain + tenantId bindings, which TenantRoutingStream uses to
      // pick the destination folder. Apex/bypass requests keep the root logger
      // (-> logs/global/).
      req.log = getTenantLogger(tenant.subdomain, tenant.id);

      // ──────────────────────────────────────────────────────────────────────
      // FEATURE-FLAG WHITELIST BRIDGE
      //
      // This is the ONLY control-plane (global DB) data that flows INTO a tenant
      // request beyond the subdomain→DB lookup above. `getTenantFlags` reads the
      // global `features` + `tenant_features` catalog (the whitelist of which
      // capabilities this tenant may use), resolves it to a {key: enabled} map,
      // and attaches it for handlers to gate on via isEnabled(req, FeatureFlag.X).
      //
      // Architectural invariant: apart from these two global reads (tenant
      // identity + flags), a tenant request must never reach into the global DB.
      // All tenant data — users, sessions, business records — lives in the
      // tenant's OWN database (req.tenantDb). The global DB is purely the control
      // plane: tenant registry + flag catalog + platform admins.
      //
      // Cached behind a short TTL; degrades gracefully to empty flags on a
      // transient global-DB failure (the request proceeds; flags read as off).
      // ──────────────────────────────────────────────────────────────────────
      try {
        req.tenantFlags = await getTenantFlags(tenant.id);
      } catch (err) {
        req.log.error({ err }, 'Failed to resolve tenant feature flags; proceeding with defaults.');
        req.tenantFlags = {};
      }
    });
  },
  { name: 'tenant', fastify: '5.x' },
);
