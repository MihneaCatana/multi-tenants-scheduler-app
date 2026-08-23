/**
 * Authorization roles used across the platform.
 *
 * - `platform_admin`: staff operating the platform. Has NO tenantId and is
 *   forbidden from accessing any tenant-scoped route or tenant data. This is
 *   the core of the "global user can't see client data" requirement.
 * - `tenant_admin`:  the owner/manager of a specific tenant. Full access within
 *   their tenant DB, scoped to their tenantId.
 * - `tenant_user`:   a regular user inside a specific tenant.
 *
 * The numeric rank is only a convenience for ordering; authorization is always
 * decided by explicit role + tenant match, never by rank alone.
 */
export const Role = {
  PLATFORM_ADMIN: 'platform_admin',
  TENANT_ADMIN: 'tenant_admin',
  TENANT_USER: 'tenant_user',
} as const;

// eslint-disable-next-line no-redeclare -- intentional const+type sharing (value object + derived union)
export type Role = (typeof Role)[keyof typeof Role];

export const ALL_ROLES: Role[] = [
  Role.PLATFORM_ADMIN,
  Role.TENANT_ADMIN,
  Role.TENANT_USER,
];

export const TENANT_ROLES: Role[] = [Role.TENANT_ADMIN, Role.TENANT_USER];

export function isTenantRole(role: unknown): role is Role {
  return role === Role.TENANT_ADMIN || role === Role.TENANT_USER;
}

export function isPlatformRole(role: unknown): role is Role {
  return role === Role.PLATFORM_ADMIN;
}
