import { pgTable, uuid, timestamp, varchar, uniqueIndex } from 'drizzle-orm/pg-core';

/**
 * Tenant registry — lives in the GLOBAL database.
 *
 * One row per tenant. `subdomain` is what the request router resolves the
 * request to; `dbName` is the actual PostgreSQL database name on the tenant
 * server (derived from the subdomain at provisioning time).
 */
export const tenants = pgTable(
  'tenants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 120 }).notNull(),
    subdomain: varchar('subdomain', { length: 63 }).notNull(),
    dbName: varchar('db_name', { length: 128 }).notNull(),
    status: varchar('status', { length: 20 }).notNull().default('active'), // active | suspended
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    subdomainIdx: uniqueIndex('tenants_subdomain_idx').on(t.subdomain),
  }),
);

export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
