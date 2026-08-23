## Plan: Client Page — Financial Summary + Charts

### Context
- No payment/invoice tables exist. Prices live on `services.price` (nullable, numeric(10,2)).
- Appointments link to services via `appointment_services` junction table.
- The client's "amount to pay" = sum of linked service prices per appointment.
- Backend list endpoint already supports `?clientId=` filter and returns `serviceIds` per appointment.
- No chart library installed yet — will add **Recharts**.

### Changes

#### 1. Install Recharts
- `pnpm add recharts` in the frontend

#### 2. Frontend — Client View (`ClientView.tsx`)
Add a new section between client info and appointment history with:

**Summary Cards (4 cards in a row):**
- **Total Spent** — sum of service prices across all non-cancelled appointments
- **Appointments Completed** — count of completed appointments
- **Average per Appointment** — total spent / completed count
- **Upcoming** — count of confirmed/checked_in appointments

These are computed client-side from the existing appointment list + services map (already fetched). No new backend endpoint needed — the appointment list already returns `serviceIds`, and `servicesMap` is already loaded.

**Appointment Status Donut Chart:**
- Recharts `PieChart` with `Pie` + `Cell` + `Tooltip` + `Legend`
- Segments: completed, cancelled, no_show, confirmed/checked_in/in_progress grouped as "active"
- Colors from the existing design tokens (`--primary`, `--destructive`, `--warning`, `--success`, etc.)
- Wrapped in a Card component

#### 3. i18n — Add translation keys
- `client_financialSummary`, `client_totalSpent`, `client_appointmentsCompleted`, `client_avgPerAppointment`, `client_upcoming`, `client_statusBreakdown`
- Both English and Romanian

#### 4. No backend changes needed
The existing `GET /v1/appointments?clientId=<id>` + `GET /v1/services` endpoints already return all data needed. Prices are on services, appointment statuses are on appointments — we compute everything client-side.