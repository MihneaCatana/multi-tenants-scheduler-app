# PrimeReact Migration Design

## Context

The frontend uses shadcn/ui (copy-paste Radix primitives) with Tailwind CSS. The UX is buggy and the decision is to migrate to PrimeReact with the Arya-Orange preset theme. Full rewrite approach — remove all shadcn/Radix/Tailwind in one pass.

## Decisions

| Decision | Choice |
|---|---|
| Approach | Full rewrite |
| Theme | Arya-Orange preset |
| Calendar scheduler | Keep @schedule-x/calendar |
| Table | Replace TanStack Table → PrimeReact DataTable |
| Forms | PrimeReact useForm with per-field validation |
| Styling | Drop Tailwind entirely, full PrimeReact |
| Icons | Switch from lucide-react to PrimeIcons |

## Package Changes

**Remove (20 packages):**
- All 11 `@radix-ui/react-*` packages
- `@tanstack/react-table`
- `class-variance-authority`, `clsx`, `tailwind-merge`
- `tailwindcss`, `autoprefixer`, `postcss`, `tailwindcss-animate`
- `react-hook-form`, `@hookform/resolvers`, `zod`
- `react-day-picker`
- `lucide-react`

**Add (2 packages):**
- `primereact` (v10.x)
- `primeicons`

**Keep unchanged:**
- react, react-dom, react-router-dom
- @tanstack/react-query
- @schedule-x/calendar, @schedule-x/theme-default
- date-fns, temporal-polyfill

## Theming & Styling

Replace `styles.css` (327 lines) with PrimeReact CSS imports in `main.tsx`:
```
primereact/resources/themes/arya-orange/theme.css
primereact/resources/primereact.min.css
primeicons/primeicons.css
```
New `app.css` (~30 lines): body defaults + Schedule-X theme overrides mapped to PrimeReact CSS variables.

**Delete:** tailwind.config.ts, postcss.config.js, components.json, src/components/ui/ (23 files), src/lib/utils.ts.

## Component Mapping

| shadcn | PrimeReact |
|---|---|
| Button | Button (severity/size props) |
| Input | InputText |
| PasswordInput | Password (toggleMask) |
| Textarea | Textarea |
| Label | FloatLabel wrapping or <label> |
| Select | Select |
| Switch | InputSwitch |
| Dialog / Modal | Dialog (header/footer/visible/onHide) |
| DropdownMenu | Menu (popup) |
| Tabs | TabView + TabPanel |
| DataTable (custom TanStack wrapper) | DataTable (built-in) |
| Badge | Badge (severity) |
| Alert | Message (severity) |
| Card | Card |
| Calendar (date picker) | DatePicker |
| Popover | OverlayPanel |
| Collapsible | Accordion or custom |
| Spinner | ProgressSpinner |
| EmptyState (custom) | Keep as simple custom component |
| Separator | Divider |

## Layout Migration

Every Tailwind utility class becomes:
1. Inline `style` prop for one-off layout
2. PrimeReact `pt-*` passthrough classes
3. Small CSS classes for repeated patterns

## Form Migration

Replace react-hook-form + zod with PrimeReact `useForm` + per-field validator functions. Each validator returns `undefined` when valid or an error string.

## DataTable Migration

Replace 248-line custom DataTable (TanStack Table wrapper) with PrimeReact DataTable. Column sorting, filtering, pagination, row selection, and column visibility all built-in.

## File Impact

**Delete (26 files):**
- tailwind.config.ts, postcss.config.js, components.json
- src/components/ui/ (23 files)
- src/lib/utils.ts

**New (1 file):**
- src/app.css (replaces styles.css)

**Modify (28 files):**
- src/main.tsx — CSS imports
- src/App.tsx — no logic changes
- src/components/AppLayout.tsx
- src/components/AppSidebar.tsx
- src/components/Modal.tsx — rewrite as PrimeReact Dialog wrapper or delete
- src/components/TenantBadge.tsx
- src/components/Spinner.tsx
- src/features/auth/LoginPage.tsx
- src/features/auth/ChangePasswordPage.tsx
- src/features/admin/AdminConsole.tsx
- src/features/admin/FeaturesPanel.tsx
- src/features/clients/ClientsWorkspace.tsx
- src/features/clients/ClientView.tsx
- src/features/calendar/AppointmentDetail.tsx
- src/features/calendar/CreateAppointmentForm.tsx
- src/features/scheduling/SchedulingPage.tsx
- src/features/scheduling/tabs/AppointmentsTab.tsx
- src/features/scheduling/tabs/ResourcesTab.tsx
- src/features/scheduling/tabs/ServicesTab.tsx
- src/features/staff/StaffPanel.tsx
- src/features/profile/ProfilePage.tsx
- src/routes/ForbiddenPage.tsx
- src/routes/RequireAuth.tsx — no change
- src/routes/RootRedirect.tsx — no change
- src/test-setup.ts — possible test utils update
- src/test-utils.tsx — remove cn dependency
- package.json — dependency swap
