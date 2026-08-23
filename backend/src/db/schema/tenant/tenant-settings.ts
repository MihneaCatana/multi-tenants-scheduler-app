import { pgTable, varchar, timestamp } from 'drizzle-orm/pg-core';

/**
 * Tenant-level business configuration (key/value). Physically isolated per
 * tenant (lives in the tenant DB). Phase 1 carries only `timezone`
 * (e.g. 'Europe/Bucharest'); future phases may add booking-window defaults,
 * cancellation policy, etc.
 */
export const tenantSettings = pgTable('tenant_settings', {
  key: varchar('key', { length: 80 }).primaryKey(),
  value: varchar('value', { length: 255 }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type TenantSetting = typeof tenantSettings.$inferSelect;
export type NewTenantSetting = typeof tenantSettings.$inferInsert;
