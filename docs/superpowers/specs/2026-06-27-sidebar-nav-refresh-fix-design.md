# Sidebar Navigation + Dedicated Features Page + Auth Refresh Fix

**Date:** 2026-06-27
**Status:** Draft

## Problem Statement

1. **No persistent navigation.** Users switch between pages via in-page tabs (platform admin) or bare text links (tenant workspace). There is no sidebar or consistent navigation structure.
2. **Feature flags are buried.** The `FeaturesPanel` lives inside a tab on the `/platform` admin console — not a first-class page with its own route.
3. **Duplicate sign-out.** The sign-out button exists in `AppLayout`'s header but may appear redundant alongside per-page navigation elements.
4. **Auth refresh race on page reload.** Refreshing the page causes two refresh-token requests: the first fails (401), the second succeeds. Root cause: React 18 `StrictMode` double-mounting + `AuthProvider`'s direct `api.refresh()` bypassing the `tryRefresh()` dedup lock.

## Scope

### In scope

- Add a shared `AppSidebar` component with role-based navigation links
- Create a dedicated `/platform/features` route for the feature flags page
- Simplify `AdminConsole` by removing the tab switcher (only tenant list remains)
- Fix the auth refresh race condition on page reload
- Remove any redundant sign-out elements

### Out of scope

- New feature flag functionality
- New pages beyond the current set
- Mobile-responsive sidebar (deferred — hamburger/drawer pattern is pre-designed but not implemented this round)

## Design

### 1. Sidebar Component (`AppSidebar`)

A vertical sidebar rendered inside `AppLayout`, to the left of the main content area.

- **Position:** Fixed-width (`w-56`), full viewport height, left side
- **Layout:** Flexbox — sidebar takes fixed width, main content fills remaining space
- **Desktop:** Always visible
- **Mobile:** Hidden behind a hamburger toggle (future enhancement, not this round — but the CSS structure supports it)

**Navigation items by role:**

| Role | Label | Route |
|------|-------|-------|
| `platform_admin` | Tenants | `/platform` |
| `platform_admin` | Features | `/platform/features` |
| `tenant_admin` | Accounts | `/workspace` |
| `tenant_admin` | Users | `/workspace/users` |
| `tenant_user` | Accounts | `/workspace` |

- Active item highlighted based on current route (use `useLocation()` from react-router-dom)
- Items use `<NavLink>` from react-router-dom for client-side navigation
- Icons optional (emoji or inline SVG if time permits, plain text labels are fine for now)

**AppLayout integration:**

```
┌─────────────────────────────────────────┐
│  Header (Simi Console + Badge + User)    │
├──────────┬──────────────────────────────┤
│ Sidebar  │  Main content                │
│          │                              │
│ • Item 1 │  <page content>              │
│ • Item 2 │                              │
│          │                              │
└──────────┴──────────────────────────────┘
```

The `AppLayout` component gains a `sidebarItems` prop (or derives items from role internally). The sidebar is rendered only on authenticated pages (which already go through `AppLayout`).

### 2. Dedicated Features Page

**New route:** `/platform/features`

```tsx
<Route path="/platform/features" element={
  <RequireAuth roles={['platform_admin']}>
    <MaybeForceChangePassword>
      <FeaturesPage />
    </MaybeForceChangePassword>
  </RequireAuth>
} />
```

A thin wrapper `FeaturesPage` renders the existing `FeaturesPanel` inside `AppLayout` with `title="Features"`.

**AdminConsole simplification:**

- Remove the `tab` state and tab switcher from `AdminConsole`
- Remove the `FeaturesPanel` import and rendering
- `AdminConsole` now only shows the tenant list

### 3. Sign-out Cleanup

The sign-out button lives exclusively in `AppLayout`'s header. After this change:
- No page should render its own sign-out button
- The header sign-out remains the single sign-out point

### 4. Auth Refresh Race Condition Fix

**Root cause:** React 18 `StrictMode` double-mounts components in development. `AuthProvider`'s `useEffect` calls `api.refresh()` directly, which bypasses the `tryRefresh()` dedup lock (`inflightRefresh`). This means on mount:

1. First mount: `AuthProvider` calls `api.refresh()` → fires `POST /auth/refresh`
2. StrictMode unmounts + remounts: `AuthProvider` calls `api.refresh()` again → fires a second `POST /auth/refresh`
3. The two calls race — one may arrive when the server has already consumed the rotate-on-use refresh token, causing the other to fail with 401

Meanwhile, any data-fetching that fires before auth state resolves may also trigger `tryRefresh()`.

**Fix:** Make `AuthProvider`'s initial refresh use a module-level mount lock (separate from `tryRefresh`):

```ts
// In auth.tsx
let initialRefreshPromise: Promise<AuthUser | null> | null = null;

function refreshSessionOnce(): Promise<AuthUser | null> {
  if (initialRefreshPromise) return initialRefreshPromise;
  initialRefreshPromise = (async () => {
    try {
      const user = await api.refresh();
      return user;
    } catch {
      return null;
    }
  })();
  return initialRefreshPromise;
}
```

On unmount, reset the lock (`initialRefreshPromise = null`) so a re-mount actually refreshes. This deduplicates the StrictMode double-fire while still allowing genuine re-refreshes after unmount.

## Implementation Notes

- The sidebar reads the user role from `useAuth()` and the current route from `useLocation()`
- `AppLayout` signature gains an optional `sidebar?: boolean` prop (default `true`) for pages that don't need a sidebar (e.g., change-password)
- The `FeaturesPanel` component is reused as-is; only its wrapper changes
- The auth fix is isolated to `auth.tsx` and `api.ts` — no backend changes needed
