## Convert all data tables to single-row-select data tables with grouped actions

### Overview
Convert 9 action-bearing tables to a consistent pattern: click a row to select it (visual highlight), all row actions grouped under a single `⋯` three-dot dropdown menu. 2 read-only/inline-edit tables (FeatureCatalog, ServiceRequirements) are excluded — no actions to group.

### Step 1: Create a reusable `DataTable` component
Create `frontend/src/components/ui/data-table.tsx`:
- Wraps shadcn `Table` components
- Props: `columns` (array of `{ key, label, className?, render? }`), `data` (array), `selectedId` / `onSelectId` (single selection state), `getRowId` (function to extract id from row), `emptyMessage`
- Renders: checkbox column (hidden if no `onSelectId`), data columns, actions column with three-dot `DropdownMenu`
- Actions column: `DropdownMenuTrigger` with `MoreHorizontal` icon → `DropdownMenuContent` with `DropdownMenuTriggerItem`s passed via `actions` render prop per row
- Selected row gets `bg-accent/50` background highlight, other rows default
- The `actions` prop is `(row: T) => ReactNode` — each table passes its own menu items

### Step 2: Migrate shadcn-Table tables (4 files, 5 tables)
**`ResourcesTab.tsx`** — 3 tables:
- Resources table: actions → dropdown with Edit (Pencil icon), Schedule (Calendar icon), Delete (Trash icon)
- Working Hours table: actions → dropdown with Edit, Delete
- Time Off table: actions → dropdown with Delete only

**`ServicesTab.tsx`** — 1 table:
- Services table: actions → dropdown with Edit, Requirements, Delete

**`ClientView.tsx`** — 1 table:
- Already has three-dot dropdown. Just add row selection highlight on click + `selectedId` state

**`AppointmentsTab.tsx`** — 1 table:
- Same as ClientView — already has dropdown, just add row selection

### Step 3: Migrate raw-HTML tables (4 files, 5 tables)
Convert from `<table className="table-spectrum">` to use the `DataTable` component:

**`ClientsWorkspace.tsx`** — Clients table:
- Actions → dropdown with Edit, Delete

**`AdminConsole.tsx`** — Tenants table:
- Actions → dropdown with Open (ExternalLink), Suspend/Activate toggle

**`FeaturesPanel.tsx`** — Tenant Flags table:
- Actions → dropdown with Toggle

**`StaffPanel.tsx`** — Staff table:
- Actions → dropdown with Edit, Reset Password, Deactivate/Activate/Delete (conditional)

### Files modified (8 total)
| File | Change |
|------|--------|
| `src/components/ui/data-table.tsx` | **Created** — reusable DataTable component |
| `src/features/scheduling/tabs/ResourcesTab.tsx` | Migrate 3 tables to DataTable |
| `src/features/scheduling/tabs/ServicesTab.tsx` | Migrate 1 table to DataTable |
| `src/features/scheduling/tabs/AppointmentsTab.tsx` | Add row selection to existing dropdown table |
| `src/features/clients/ClientView.tsx` | Add row selection to existing dropdown table |
| `src/features/clients/ClientsWorkspace.tsx` | Migrate to DataTable |
| `src/features/admin/AdminConsole.tsx` | Migrate to DataTable |
| `src/features/admin/FeaturesPanel.tsx` | Migrate tenant flags table to DataTable |
| `src/features/staff/StaffPanel.tsx` | Migrate to DataTable |

### What stays the same
- All data fetching / mutation logic — unchanged
- Column rendering logic — unchanged (just moved into `columns` array)
- Action handlers — unchanged (just moved into dropdown menu items)
- Styling — stays consistent with existing `table-spectrum` CSS
- FeatureCatalog read-only table and ServiceRequirements inline-edit table — untouched