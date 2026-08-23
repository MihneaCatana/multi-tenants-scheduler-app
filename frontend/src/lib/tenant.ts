/**
 * Browser-side tenant context, derived from the current hostname.
 *
 * This mirrors the backend's getSubdomain() (backend/src/lib/subdomain.ts):
 *   - simisolutions.localhost        -> apex / platform admin (null tenant)
 *   - acme.simisolutions.localhost   -> "acme"
 *   - localhost, 127.0.0.1           -> null (not under the base domain)
 *
 * Keeping this logic here lets the UI show "you are in the Acme tenant" and
 * route to the right experience WITHOUT an extra request, purely from the URL
 * the user is already on.
 */

const SUBDOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function baseDomain(): string {
  // VITE_BASE_DOMAIN must mirror the backend's BASE_DOMAIN. Defaulted so the
  // app still boots if the var is absent (the proxy won't resolve tenants, but
  // at least we don't crash).
  return (import.meta.env.VITE_BASE_DOMAIN ?? 'simisolutions.localhost')
    .toLowerCase()
    .replace(/\.+$/, '');
}

/** Strip port + trailing dot, lowercase. */
function normalizeHost(host: string): string {
  return host.split(':')[0]!.replace(/\.+$/, '').toLowerCase();
}

/** The single-label subdomain under BASE_DOMAIN, or null at the apex. */
export function getSubdomain(host: string = window.location.hostname): string | null {
  const base = baseDomain();
  const normalized = normalizeHost(host);
  if (!normalized.endsWith('.' + base)) return null; // not under base domain
  const prefix = normalized.slice(0, normalized.length - (base.length + 1));
  if (prefix === '') return null; // exactly the apex
  if (prefix.includes('.')) return null; // multi-label (foo.bar) -> not a tenant
  if (!SUBDOMAIN_PATTERN.test(prefix)) return null;
  return prefix;
}

/** True when the current host is the apex / platform-admin host. */
export function isApexHost(host: string = window.location.hostname): boolean {
  return getSubdomain(host) === null;
}

/** True when the current host is a tenant subdomain. */
export function isTenantHost(host: string = window.location.hostname): boolean {
  return getSubdomain(host) !== null;
}

/**
 * Build the absolute URL for a tenant subdomain on the SAME port the user is
 * currently on (so dev `acme.simisolutions.localhost:5173` links work).
 */
export function tenantUrl(subdomain: string): string {
  const port = window.location.port;
  const portSuffix = port ? `:${port}` : '';
  return `${window.location.protocol}//${subdomain}.${baseDomain()}${portSuffix}/workspace`;
}

/** Absolute URL for the apex / platform admin host. */
export function apexUrl(): string {
  const port = window.location.port;
  const portSuffix = port ? `:${port}` : '';
  return `${window.location.protocol}//${baseDomain()}${portSuffix}/platform`;
}

export interface TenantContext {
  /** 'platform' when on apex, 'tenant' when on a subdomain. */
  kind: 'platform' | 'tenant';
  /** Subdomain label when kind === 'tenant', else null. */
  subdomain: string | null;
}

/** One-shot summary of where the browser is. */
export function tenantContext(host: string = window.location.hostname): TenantContext {
  const sub = getSubdomain(host);
  return sub ? { kind: 'tenant', subdomain: sub } : { kind: 'platform', subdomain: null };
}
