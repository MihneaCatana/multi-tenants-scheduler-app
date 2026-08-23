import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { api, setAccessToken, setAuthCallbacks } from './api';
import type { AuthUser } from './types';

/**
 * AuthProvider — the single source of truth for "who is logged in".
 *
 * Design:
 * - The access token is kept in memory inside the api module (never here as
 *   state we'd be tempted to persist). This provider tracks only the USER
 *   object (no secrets) plus a loading flag while we restore the session.
 * - On mount we try to restore the session via /auth/refresh (cookie-based).
 *   If that fails we are simply logged out — no error to the user.
 * - The api module calls back on session-expiry (refresh failed during a
 *   request) so we clear the user and a <RequireAuth> boundary redirects.
 */

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

interface AuthContextValue {
  user: AuthUser | null;
  status: AuthStatus;
  mustChangePassword: boolean;
  login: (email: string, password: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Module-level lock that deduplicates the initial refresh across StrictMode
 * double-mounts. When the first mount starts a refresh, the second mount
 * reuses the same promise. The lock resets on unmount so a genuine re-mount
 * (e.g. after navigation) gets a fresh refresh.
 */
let initialRefreshPromise: Promise<{ accessToken: string; user: AuthUser; expiresIn: number } | null> | null = null;

function refreshSessionOnce(): Promise<{ accessToken: string; user: AuthUser; expiresIn: number } | null> {
  if (initialRefreshPromise) return initialRefreshPromise;
  initialRefreshPromise = api.refresh().catch(() => null);
  return initialRefreshPromise;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');
  const mounted = useRef(true);

  // Wire the api client's callbacks once. session-expired clears the user; a
  // background refresh success just keeps the token fresh (no state change).
  useEffect(() => {
    mounted.current = true;
    setAuthCallbacks({
      onSessionExpired: () => {
        if (!mounted.current) return;
        setAccessToken(null);
        setUser(null);
        setStatus('unauthenticated');
      },
      onTokenRefreshed: () => {
        // Token updated in the api module; user object unchanged. Nothing to do.
      },
    });

    // Restore session on boot: the rt cookie (if any) mints a fresh access token.
    // Uses a module-level lock so StrictMode's double-mount fires only one refresh.
    refreshSessionOnce()
      .then((res) => {
        if (!mounted.current) return;
        if (res) {
          setAccessToken(res.accessToken);
          setUser(res.user);
          setStatus('authenticated');
        } else {
          setAccessToken(null);
          setUser(null);
          setStatus('unauthenticated');
        }
      });

    return () => {
      mounted.current = false;
      // Do NOT reset initialRefreshPromise here. React 18 StrictMode unmounts
      // and immediately remounts — resetting the lock would cause a second
      // POST /auth/refresh to race against the first one's rotating token,
      // resulting in a spurious 401. The promise from the first mount is still
      // valid and will resolve correctly.
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.login({ email, password });
    setAccessToken(res.accessToken);
    setUser(res.user);
    setStatus('authenticated');
    return res.user;
  }, []);

  const logout = useCallback(async () => {
    // Best-effort: revoke the refresh session server-side, then clear locally
    // regardless of the response.
    try {
      await api.logout();
    } finally {
      setAccessToken(null);
      setUser(null);
      setStatus('unauthenticated');
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      status,
      mustChangePassword: user?.mustChangePassword === true,
      login,
      logout,
    }),
    [user, status, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
