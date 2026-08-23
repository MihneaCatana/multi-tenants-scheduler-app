/**
 * Tenant DB schema barrel — imported by drizzle.config.tenant.ts and used to
 * build the typed Drizzle instance for each per-tenant DB at runtime.
 *
 * Every export here must be a table that is intended to exist in tenant DBs
 * only. Do NOT import anything from the global schema.
 *
 * Two physically separate identity populations:
 *  - `staff`    — the tenant's EMPLOYEES who can log in (login identities).
 *                 Always has passwordHash + role. `tenant_sessions` FKs here.
 *  - `clients`  — the tenant's CUSTOMERS (contacts/CRM). No password, no role,
 *                 cannot log in. Managed via /clients.
 * Splitting them means no query path can cross the two: a client can never
 * surface in a staff listing, and a credential can never leak via a client view.
 *
 * Scheduling tables (resources, services, working_hours, time_off,
 * appointments, appointment_resources, appointment_status_history) join to
 * `staff` and `clients` by id.
 */
import { staff } from './staff.js';
import { clients } from './clients.js';
import { tenantSessions } from './tenant-sessions.js';
import { tenantSettings } from './tenant-settings.js';
import { resources } from './resources.js';
import { services } from './services.js';
import { serviceResourceRequirements } from './service-resource-requirements.js';
import { workingHours } from './working-hours.js';
import { timeOff } from './time-off.js';
import { appointments } from './appointments.js';
import { appointmentResources } from './appointment-resources.js';
import { appointmentStatusHistory } from './appointment-status-history.js';
import { appointmentServices } from './appointment-services.js';

export * from './staff.js';
export * from './clients.js';
export * from './tenant-sessions.js';
export * from './tenant-settings.js';
export * from './resources.js';
export * from './services.js';
export * from './service-resource-requirements.js';
export * from './working-hours.js';
export * from './time-off.js';
export * from './appointments.js';
export * from './appointment-resources.js';
export * from './appointment-status-history.js';
export * from './appointment-services.js';

export { staff } from './staff.js';
export { clients } from './clients.js';
export { tenantSessions } from './tenant-sessions.js';
export { tenantSettings } from './tenant-settings.js';
export { resources } from './resources.js';
export { services } from './services.js';
export { serviceResourceRequirements } from './service-resource-requirements.js';
export { workingHours } from './working-hours.js';
export { timeOff } from './time-off.js';
export { appointments } from './appointments.js';
export { appointmentResources } from './appointment-resources.js';
export { appointmentStatusHistory } from './appointment-status-history.js';
export { appointmentServices } from './appointment-services.js';

export const tenantSchema = {
  staff,
  clients,
  tenantSessions,
  tenantSettings,
  resources,
  services,
  serviceResourceRequirements,
  workingHours,
  timeOff,
  appointments,
  appointmentResources,
  appointmentStatusHistory,
  appointmentServices,
} as const;
