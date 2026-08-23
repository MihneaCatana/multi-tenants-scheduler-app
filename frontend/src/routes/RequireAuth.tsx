import { type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { FullPageSpinner } from '../components/Spinner';
import type { Role } from '../lib/types';

/**
 * Route guard. While the session is being restored we show a spinner (so we
 * never flash the login page for a logged-in user). Once resolved:
 * - unauthenticated -> /login
 * - authenticated but missing a required role -> a "not authorized" route
 * - otherwise -> render the children
 *
 * Host enforcement is separate from role enforcement: a platform_admin on a
 * tenant subdomain (or vice versa) is handled by the layout, not here, because
 * the backend's own guards are the source of truth and we don't want to
 * shadow them with fragile client-side assumptions.
 */
export function RequireAuth({
  children,
  roles,
}: {
  children: ReactNode;
  roles?: Role[];
}) {
  const { status, user } = useAuth();
  const location = useLocation();

  if (status === 'loading') return <FullPageSpinner />;

  if (status === 'unauthenticated') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (roles && user && !roles.includes(user.role)) {
    return <Navigate to="/forbidden" replace />;
  }

  return <>{children}</>;
}
