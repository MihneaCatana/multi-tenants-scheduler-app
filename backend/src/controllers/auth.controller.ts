import type { FastifyReply, FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import { env } from '../config/env.js';
import { globalDb } from '../db/client.js';
import { users } from '../db/schema/global/users.js';
import { signAccessToken } from '../modules/auth/tokens.js';
import {
  authenticate,
  rotateRefreshToken,
  revokeSessionByToken,
  changeOwnPassword,
} from '../modules/auth/service.js';
import {
  authenticateTenant,
  rotateTenantRefreshToken,
  revokeTenantSessionByToken,
  changeTenantOwnPassword,
  loadTenantStaffById,
} from '../modules/auth/tenant-service.js';
import { loginBody, changePasswordBody } from '../modules/auth/schema.js';
import { requireAuth } from '../plugins/auth.js';
import { noRefreshToken, wrongPassword } from '../lib/errors.js';
import { auditLog } from '../lib/audit.js';
import type { AuthResult } from '../modules/auth/service.js';
import type { TenantAuthResult } from '../modules/auth/tenant-service.js';

const REFRESH_COOKIE = 'rt';

function setRefreshCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'strict',
    path: '/v1/auth',
    maxAge: 60 * 60 * 24 * 30, // 30d, mirrors REFRESH_TOKEN_TTL
  });
}

function clearRefreshCookie(reply: FastifyReply): void {
  reply.clearCookie(REFRESH_COOKIE, { path: '/v1/auth' });
}

/**
 * Build the access token + set the refresh cookie for a GLOBAL login (platform
 * admin). `tenantId` is always null for global users.
 */
function buildGlobalAuthResult(
  req: FastifyRequest,
  reply: FastifyReply,
  base: AuthResult,
): { user: typeof base.user; accessToken: string; expiresIn: number } {
  const accessToken = signAccessToken(req.server, {
    sub: base.user.id,
    role: base.user.role,
    tenantId: base.user.tenantId,
  });
  setRefreshCookie(reply, base.refreshToken);
  return { ...base, accessToken };
}

/**
 * Build the access token + set the refresh cookie for a TENANT login. The
 * tenantId comes from the resolved request tenant (the subdomain this request
 * landed on), NOT from a stored column — the staff member lives in that tenant's
 * DB by construction.
 */
function buildTenantAuthResult(
  req: FastifyRequest,
  reply: FastifyReply,
  base: TenantAuthResult,
  tenantId: string,
): { user: typeof base.user & { tenantId: string }; accessToken: string; expiresIn: number } {
  const accessToken = signAccessToken(req.server, {
    sub: base.user.id,
    role: base.user.role,
    tenantId,
  });
  setRefreshCookie(reply, base.refreshToken);
  const userWithTenant = { ...base.user, tenantId };
  return { ...base, user: userWithTenant, accessToken };
}

/**
 * Auth request handlers. Each handler branches on whether the request landed on
 * a tenant subdomain (`req.tenant` set → tenant DB auth) or the apex host (no
 * tenant → global auth for platform admins). Token/session mechanics live in the
 * service layers; these handlers own HTTP concerns only: cookie wrangling, body
 * parsing, and response shaping. Handlers never reference `this`.
 */
export const authController = {
  /**
   * Login — tenant subdomain authenticates against that tenant's `staff`
   * (login identities); apex authenticates against global `users` (platform
   * admins). Platform admins must log in on the apex, not a tenant subdomain.
   */
  async login(req: FastifyRequest, reply: FastifyReply) {
    const input = loginBody.parse(req.body);

    if (req.tenant) {
      // Tenant subdomain: authenticate against this tenant's `staff`.
      const base = await authenticateTenant(req.tenantDb!, input.email, input.password, req);
      const result = buildTenantAuthResult(req, reply, base, req.tenant.id);
      auditLog(req, {
        action: 'auth.login',
        target: { resource: 'user', id: result.user.id },
        msg: 'User logged in.',
      });
      reply.send({
        user: result.user,
        accessToken: result.accessToken,
        expiresIn: result.expiresIn,
      });
      return;
    }

    // Apex: global platform-admin auth.
    const base = await authenticate(input.email, input.password, req);
    const result = buildGlobalAuthResult(req, reply, base);
    auditLog(req, {
      action: 'auth.login',
      target: { resource: 'user', id: result.user.id },
      msg: 'User logged in.',
    });
    reply.send({
      user: result.user,
      accessToken: result.accessToken,
      expiresIn: result.expiresIn,
    });
  },

  /** Refresh — tenant subdomain rotates against tenant_sessions; apex global. */
  async refresh(req: FastifyRequest, reply: FastifyReply) {
    const token = req.cookies[REFRESH_COOKIE];
    if (!token) throw noRefreshToken();

    if (req.tenant) {
      const rotated = await rotateTenantRefreshToken(req.tenantDb!, token, req);
      const result = buildTenantAuthResult(req, reply, rotated, req.tenant.id);
      reply.send({
        user: result.user,
        accessToken: result.accessToken,
        expiresIn: result.expiresIn,
      });
      return;
    }

    const rotated = await rotateRefreshToken(token, req);
    const result = buildGlobalAuthResult(req, reply, {
      user: {
        id: rotated.user.id,
        email: rotated.user.email,
        role: rotated.user.role,
        tenantId: rotated.user.tenantId,
        firstName: rotated.user.firstName,
        lastName: rotated.user.lastName,
        active: rotated.user.active,
        mustChangePassword: rotated.user.mustChangePassword,
      },
      accessToken: '',
      refreshToken: rotated.refreshToken,
      expiresIn: rotated.expiresIn,
    });
    reply.send({
      user: result.user,
      accessToken: result.accessToken,
      expiresIn: result.expiresIn,
    });
  },

  /** Logout — revoke the presented refresh token in the right store; clear cookie. */
  async logout(req: FastifyRequest, reply: FastifyReply) {
    const token = req.cookies[REFRESH_COOKIE];
    if (token) {
      if (req.tenant) {
        await revokeTenantSessionByToken(req.tenantDb!, token);
      } else {
        await revokeSessionByToken(token);
      }
    }
    clearRefreshCookie(reply);
    reply.status(204).send();
  },

  /** /me — who am I? Requires any valid access token. Context-driven lookup. */
  async me(req: FastifyRequest, reply: FastifyReply) {
    requireAuth(req);
    const claims = req.userClaims!;

    if (req.tenant) {
      // Tenant subdomain: mustChangePassword lives on the tenant `staff` row.
      const member = await loadTenantStaffById(req.tenantDb!, claims.sub);
      reply.send({
        user: {
          id: claims.sub,
          role: claims.role,
          tenantId: claims.tenantId,
          mustChangePassword: member?.mustChangePassword ?? false,
        },
      });
      return;
    }

    // Apex: global platform-admin lookup.
    const [u] = await globalDb
      .select({ mustChangePassword: users.mustChangePassword })
      .from(users)
      .where(eq(users.id, claims.sub))
      .limit(1);
    reply.send({
      user: {
        id: claims.sub,
        role: claims.role,
        tenantId: claims.tenantId,
        mustChangePassword: u?.mustChangePassword ?? false,
      },
    });
  },

  /**
   * Self-service password change. Requires the current password; clears
   * must_change_password and revokes other sessions. Context-driven.
   */
  async changePassword(req: FastifyRequest, reply: FastifyReply) {
    requireAuth(req);
    const input = changePasswordBody.parse(req.body);
    const claims = req.userClaims!;

    let ok: boolean;
    if (req.tenant) {
      ok = await changeTenantOwnPassword(req.tenantDb!, claims.sub, input.currentPassword, input.newPassword);
    } else {
      ok = await changeOwnPassword(claims.sub, input.currentPassword, input.newPassword);
    }
    if (!ok) throw wrongPassword();

    auditLog(req, {
      action: 'user.password_change',
      target: { resource: 'user', id: claims.sub },
      msg: 'User changed their own password.',
    });
    // Clear the refresh cookie: the caller's other sessions are revoked.
    clearRefreshCookie(reply);
    reply.status(204).send();
  },
};
