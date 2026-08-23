import { Navigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { tenantContext } from '../lib/tenant';

/**
 * Smart home redirect: send the user to the console that matches both their
 * role AND the host they're on.
 *
 * - apex host + platform_admin -> /platform
 * - apex host + anyone else     -> /login (staff log in here; tenants must use a subdomain)
 * - tenant host + tenant user   -> /workspace
 * - tenant host + platform staff -> /forbidden (staff can't access tenant data)
 *
 * The backend enforces the real rules; this just routes to the right default
 * landing page so deep links behave.
 */
export function RootRedirect() {
  const { status, user } = useAuth();
  const ctx = tenantContext();

  if (status !== 'authenticated') return <Navigate to="/login" replace />;

  if (ctx.kind === 'platform') {
    return user?.role === 'platform_admin' ? (
      <Navigate to="/platform" replace />
    ) : (
      <Navigate to="/login" replace />
    );
  }

  // Tenant host
  return user?.role === 'platform_admin' ? (
    <Navigate to="/forbidden" replace />
  ) : (
    <Navigate to="/workspace" replace />
  );
}
