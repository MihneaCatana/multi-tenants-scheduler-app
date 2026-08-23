/*
 * Copyright (c) 2026 Mihnea Catana. All rights reserved.
 * Proprietary and Confidential. Unauthorized copying or commercial use is strictly prohibited.
 */

import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { AuthProvider, useAuth } from './lib/auth';
import { SidebarProvider } from './components/SidebarContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { RequireAuth } from './routes/RequireAuth';
import { RootRedirect } from './routes/RootRedirect';
import { ForbiddenPage } from './routes/ForbiddenPage';
import { LoginPage } from './features/auth/LoginPage';
import { ChangePasswordPage } from './features/auth/ChangePasswordPage';
import { AdminConsole } from './features/admin/AdminConsole';
import { FeaturesPanel } from './features/admin/FeaturesPanel';
import { AppLayout } from './components/AppLayout';
import { ClientsWorkspace } from './features/clients/ClientsWorkspace';
import { ClientView } from './features/clients/ClientView';
import { StaffPanel } from './features/staff/StaffPanel';
import { AppointmentDetail } from './features/calendar/AppointmentDetail';
import { SchedulingPage } from './features/scheduling/SchedulingPage';
import { FlagsProvider } from './features/flags/FlagsProvider';
import { ProfilePage } from './features/profile/ProfilePage';
import { I18nProvider } from './lib/i18n';

/**
 * Route map.
 *
 * Routes are deliberately path-based (not host-based) for the SPA, but the
 * DEFAULT landing is decided by host+role (RootRedirect). A platform_admin who
 * lands on a tenant subdomain hits /forbidden; a tenant user who lands on the
 * apex is sent to /login. The backend's own guards are authoritative — these
 * client rules only smooth the default navigation.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Don't refetch on focus during testing — it causes distracting reloads.
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

export default function App() {
  return (
    <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <I18nProvider>
          <SidebarProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<RootRedirect />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/forbidden" element={<ForbiddenPage />} />
              <Route path="/change-password" element={<ChangePasswordPage />} />

              {/* Platform admin (apex) */}
              <Route
                path="/platform"
                element={
                  <RequireAuth roles={['platform_admin']}>
                    <MaybeForceChangePassword>
                      <AdminConsole />
                    </MaybeForceChangePassword>
                  </RequireAuth>
                }
              />
              <Route
                path="/platform/features"
                element={
                  <RequireAuth roles={['platform_admin']}>
                    <MaybeForceChangePassword>
                      <AppLayout title="Feature flags">
                        <FeaturesPanel />
                      </AppLayout>
                    </MaybeForceChangePassword>
                  </RequireAuth>
                }
              />

              {/* Tenant workspace (subdomain) */}
              <Route
                path="/workspace"
                element={
                  <RequireAuth roles={['tenant_admin', 'tenant_user']}>
                    <MaybeForceChangePassword>
                      <FlagsProvider>
                        <StaffPanel />
                      </FlagsProvider>
                    </MaybeForceChangePassword>
                  </RequireAuth>
                }
              />
              <Route
                path="/workspace/clients"
                element={
                  <RequireAuth roles={['tenant_admin']}>
                    <MaybeForceChangePassword>
                      <FlagsProvider>
                        <ClientsWorkspace />
                      </FlagsProvider>
                    </MaybeForceChangePassword>
                  </RequireAuth>
                }
              />
              <Route
                path="/workspace/clients/:id"
                element={
                  <RequireAuth roles={['tenant_admin']}>
                    <MaybeForceChangePassword>
                      <FlagsProvider>
                        <ClientView />
                      </FlagsProvider>
                    </MaybeForceChangePassword>
                  </RequireAuth>
                }
              />
              {/* Scheduling — unified page with tabs */}
              <Route
                path="/workspace/scheduling"
                element={
                  <RequireAuth roles={['tenant_admin', 'tenant_user']}>
                    <MaybeForceChangePassword>
                      <FlagsProvider>
                        <SchedulingPage />
                      </FlagsProvider>
                    </MaybeForceChangePassword>
                  </RequireAuth>
                }
              />
              {/* Redirects from old scheduling routes */}
              <Route path="/workspace/calendar" element={<Navigate to="/workspace/scheduling" replace />} />
              <Route path="/workspace/resources" element={<Navigate to="/workspace/scheduling" replace />} />
              <Route path="/workspace/services" element={<Navigate to="/workspace/scheduling" replace />} />
              <Route
                path="/workspace/calendar/:id"
                element={
                  <RequireAuth roles={['tenant_admin', 'tenant_user']}>
                    <MaybeForceChangePassword>
                      <FlagsProvider>
                        <AppointmentDetail />
                      </FlagsProvider>
                    </MaybeForceChangePassword>
                  </RequireAuth>
                }
              />
              <Route
                path="/workspace/profile"
                element={
                  <RequireAuth roles={['tenant_admin', 'tenant_user']}>
                    <MaybeForceChangePassword>
                      <FlagsProvider>
                        <ProfilePage />
                      </FlagsProvider>
                    </MaybeForceChangePassword>
                  </RequireAuth>
                }
              />

              {/* Fallback */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </BrowserRouter>
          </SidebarProvider>
        </I18nProvider>
      </AuthProvider>
    </QueryClientProvider>
    </ErrorBoundary>
  );
}

/**
 * While the logged-in user has `mustChangePassword` set, render the forced
 * change-password screen INSTEAD of the requested route. The backend clears the
 * flag on a successful self-change (and revokes other sessions); the change
 * page signs the user out afterward so the next login reflects the cleared
 * flag.
 */
function MaybeForceChangePassword({ children }: { children: ReactNode }) {
  const { mustChangePassword } = useAuth();
  if (mustChangePassword) return <ChangePasswordPage />;
  return <>{children}</>;
}
