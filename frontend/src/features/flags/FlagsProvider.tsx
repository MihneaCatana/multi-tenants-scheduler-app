import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { FlagsContext, type FlagsContextValue } from './context';

/**
 * Holds the current tenant's resolved feature-flag map and exposes `useFlag`.
 *
 * Fetches `GET /features` once the session is authenticated. We gate on
 * `status` (rather than firing on raw mount) so the access token is already
 * set in the api module when we fetch — otherwise the request 401s before auth
 * has restored the token, and `apiFetch`'s auto-refresh path would race against
 * `AuthProvider`'s own session restore on a rotating refresh token.
 *
 * This file exports ONLY the React component; the hooks live in `hooks.ts`
 * (Fast Refresh requires a component file to export only components).
 */
export function FlagsProvider({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (status !== 'authenticated') return;
    let cancelled = false;
    api
      .getMyFlags()
      .then((res) => {
        if (!cancelled) setFlags(res.flags);
      })
      .catch(() => {
        // Unauthenticated / not on a tenant host — leave flags empty (all off).
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [status]);

  const value: FlagsContextValue = { flags, loading };
  return <FlagsContext.Provider value={value}>{children}</FlagsContext.Provider>;
}
