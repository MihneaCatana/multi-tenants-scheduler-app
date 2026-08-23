# Responsive Layout & Collapsible Sidebar Design

**Date:** 2026-06-27  
**Status:** Approved  
**Scope:** Frontend only (React + Tailwind CSS)

## Goal

Make the Simi admin console responsive across all viewport sizes and add a collapsible sidebar with desktop icon-only mode and a mobile drawer pattern.

## Approach

React Context (`SidebarProvider`) manages sidebar state. `collapsed` (desktop icon-only) is persisted to `localStorage`. `mobileOpen` controls the mobile drawer overlay. This follows the same context pattern already used by `AuthProvider`.

## Sidebar Behavior

### New file: `src/components/SidebarContext.tsx`

- `SidebarProvider` wraps the app
- State: `{ collapsed: boolean, mobileOpen: boolean }`
- Actions: `toggleCollapse()`, `toggleMobile()`
- On mount: read `collapsed` from `localStorage` key `simi-sidebar-collapsed` (default `false`)
- `toggleCollapse()` writes to `localStorage`

### Desktop (≥ `lg` / 1024px)

- Sidebar always rendered inline in the flex layout
- Chevron button (`‹` / `›`) in the sidebar header toggles `collapsed`
- **Expanded:** `w-56`, full nav labels visible, header shows "Simi"
- **Collapsed:** `w-14`, nav items show a single icon character (first letter of label), header shows "S"
- Smooth transition: `transition-all duration-200 ease-in-out`
- Active/inactive nav styling unchanged

### Mobile (< `lg` / 1024px)

- Sidebar hidden by default (`hidden lg:flex`)
- Hamburger icon (☰) in `AppLayout` header, visible only below `lg` (`lg:hidden`)
- Clicking hamburger sets `mobileOpen: true`
- Sidebar renders as a **fixed overlay** drawer:
  - `fixed inset-y-0 left-0 z-40` with `w-64` (slightly wider for touch targets)
  - Semi-transparent backdrop (`fixed inset-0 z-30 bg-black/30`) closes on click
  - Drawer slides in via `transform translate-x-0` / `-translate-x-full`
- Clicking any nav link closes the drawer

### Accessibility

- Nav items in collapsed mode have `title` attribute with full label text
- Mobile drawer: `aria-hidden` when closed, focus trap on open
- Hamburger button: `aria-label="Open menu"`

## Responsive Tables

**Problem:** All 5 tables use `overflow-hidden` which clips content on small screens.

**Fix:** Replace `overflow-hidden` with `overflow-x-auto` on every table wrapper `<div>`.

**Files:**
- `src/features/accounts/TenantWorkspace.tsx`
- `src/features/admin/AdminConsole.tsx`
- `src/features/admin/FeaturesPanel.tsx` (2 tables)
- `src/features/users/UsersPanel.tsx`

## Responsive Forms & Modals

### Grid forms

Two `grid-cols-2` layouts become responsive:

- `grid grid-cols-2 gap-3` → `grid grid-cols-1 sm:grid-cols-2 gap-3`

**Files:**
- `src/features/admin/AdminConsole.tsx` (provision form, first/last name)
- `src/features/users/UsersPanel.tsx` (edit user modal, first/last name)

### Modals

- `max-w-lg` is already a good size for mobile (full width up to 512px)
- Backdrop already uses `p-4` for edge padding
- No structural changes needed — modals are already responsive

### Main content padding

- `AppLayout` main content: `px-6 py-8` → `px-4 py-6 sm:px-6 sm:py-8`
- `AppLayout` header: `px-6 py-3` → `px-4 py-3 sm:px-6`

## Login Page

Already uses centered card with `max-w-md` and `px-4` on the outer wrapper. Works well on mobile. No changes needed.

## Changes Summary

| File | Change |
|------|--------|
| `src/components/SidebarContext.tsx` | **New** — context provider + hook |
| `src/components/AppSidebar.tsx` | Rewrite — collapse/drawer modes, chevron, icons |
| `src/components/AppLayout.tsx` | Add hamburger button, responsive padding |
| `src/App.tsx` | Wrap with `SidebarProvider` |
| `src/styles.css` | Add slide-in/out transition keyframes for mobile drawer |
| `src/features/accounts/TenantWorkspace.tsx` | Table wrapper: `overflow-hidden` → `overflow-x-auto` |
| `src/features/admin/AdminConsole.tsx` | Table wrapper fix + `grid-cols-1 sm:grid-cols-2` |
| `src/features/admin/FeaturesPanel.tsx` | Table wrapper fix (2 tables) |
| `src/features/users/UsersPanel.tsx` | Table wrapper fix + `grid-cols-1 sm:grid-cols-2` |

**Total:** 1 new file, 8 modified files.
