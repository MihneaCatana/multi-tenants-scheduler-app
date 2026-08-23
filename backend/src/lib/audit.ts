import type { FastifyRequest } from 'fastify';

/**
 * Structured audit event. `action` is a dotted, lowercase identifier
 * (e.g. 'user.password_reset'). `target` describes the resource acted upon.
 */
export interface AuditEvent {
  action: string;
  target?: { resource: string; id?: string };
  msg: string;
  level?: 'info' | 'warn';
  /** Extra structured fields merged into the log line. */
  extra?: Record<string, unknown>;
}

/**
 * Emit an audit log line through the request's (tenant-routed) logger. Pulls the
 * actor from `req.userClaims` and the tenant from `req.tenant`. Always uses
 * `req.log` so the line lands in the correct tenant folder (or global/ for
 * apex/bypass requests).
 *
 * Call this EXACTLY ONCE, after the state-changing DB write succeeds.
 */
export function auditLog(req: FastifyRequest, event: AuditEvent): void {
  const claims = req.userClaims;
  const payload: Record<string, unknown> = {
    audit: true,
    action: event.action,
    actor: claims ? { userId: claims.sub, role: claims.role } : null,
  };
  if (event.target) payload.target = event.target;
  if (event.extra) Object.assign(payload, event.extra);
  // `req.log` is the tenant-bound child logger set by the tenant plugin, or the
  // root logger (-> logs/global/) for apex/bypass requests. Indexing a pino
  // logger by level isn't statically typed, so branch explicitly.
  if (event.level === 'warn') {
    req.log.warn(payload, event.msg);
  } else {
    req.log.info(payload, event.msg);
  }
}
