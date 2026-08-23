import { env } from '../config/env.js';

/**
 * Subdomain → tenant resolution.
 *
 * Given a request `Host` header (possibly with a port, possibly with a trailing
 * dot), return the tenant subdomain, or `null` if the host is the apex domain
 * itself (no subdomain).
 *
 * Example with BASE_DOMAIN = "simisolutions.localhost":
 *   acme.simisolutions.localhost  -> "acme"
 *   acme.simisolutions.localhost:3000 -> "acme"
 *   simisolutions.localhost       -> null (apex)
 *   localhost                     -> null
 *   admin.simisolutions.localhost -> "admin"  (caller decides if reserved)
 */

const SUBDOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function normalizeHost(hostHeader: string | undefined): string {
  if (!hostHeader) return '';
  // Strip port and any trailing dot.
  return hostHeader.split(':')[0]!.replace(/\.+$/, '').toLowerCase();
}

export function getSubdomain(hostHeader: string | undefined): string | null {
  const host = normalizeHost(hostHeader);
  if (!host) return null;

  const base = env.BASE_DOMAIN.toLowerCase().replace(/\.+$/, '');
  if (!host.endsWith('.' + base)) {
    // Host is not under the base domain at all (e.g. "localhost", an IP, or a
    // misconfigured proxy). Treat as apex / no subdomain.
    return null;
  }

  const prefix = host.slice(0, host.length - (base.length + 1));
  if (prefix === '') return null; // exactly the apex
  if (!SUBDOMAIN_PATTERN.test(prefix)) return null; // malformed multi-label
  // If the prefix has dots (e.g. "foo.bar.simisolutions.localhost") we only
  // accept single-label tenant subdomains; multi-label returns null.
  if (prefix.includes('.')) return null;
  return prefix;
}

/** True when the request host is the apex / admin host. */
export function isApexHost(hostHeader: string | undefined): boolean {
  return getSubdomain(hostHeader) === null;
}

/**
 * Validate a candidate subdomain string (used during provisioning) against the
 * same rules getSubdomain enforces.
 */
export function isValidSubdomain(subdomain: string): boolean {
  return SUBDOMAIN_PATTERN.test(subdomain);
}

/**
 * Convert a subdomain into a safe PostgreSQL database name.
 * E.g. "acme" -> "tenant_acme", "big-corp" -> "tenant_big_corp".
 */
export function subdomainToDbName(subdomain: string): string {
  const cleaned = subdomain.replace(/[^a-z0-9]/g, '_').toLowerCase();
  return `tenant_${cleaned}`;
}

/**
 * Convert a subdomain into the per-tenant PostgreSQL OWNER role name.
 * E.g. "acme" -> "tenant_acme_owner", "big-corp" -> "tenant_big_corp_owner".
 *
 * Derived identically to subdomainToDbName (same [a-z0-9_] cleaning) so the
 * role name is a guaranteed-safe PG identifier. An owner role has full power
 * inside its own tenant DB but zero access to any other DB — this is the
 * per-tenant blast-radius primitive (see CODEBASE.md §15).
 */
export function subdomainToOwnerRole(subdomain: string): string {
  const cleaned = subdomain.replace(/[^a-z0-9]/g, '_').toLowerCase();
  return `tenant_${cleaned}_owner`;
}

/**
 * Convert a subdomain into the per-tenant PostgreSQL APP role name.
 * E.g. "acme" -> "tenant_acme_app", "big-corp" -> "tenant_big_corp_app".
 *
 * Derived identically to subdomainToOwnerRole (same [a-z0-9_] cleaning).
 * An app role has DML (SELECT/INSERT/UPDATE/DELETE) inside its own tenant
 * DB but zero access to any other DB — this is the per-tenant least-privilege
 * primitive for runtime data access (see CODEBASE.md §15).
 */
export function subdomainToAppRole(subdomain: string): string {
  const cleaned = subdomain.replace(/[^a-z0-9]/g, '_').toLowerCase();
  return `tenant_${cleaned}_app`;
}
