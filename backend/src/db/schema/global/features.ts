import { pgTable, uuid, varchar, text, boolean, timestamp, primaryKey, foreignKey, uniqueIndex } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';

/**
 * Feature-flag CATALOG. One row per flag. This table is a pure mirror of the
 * code-defined `FLAG_CATALOG` (see src/lib/flag-catalog.ts): the only writer is
 * the boot-time `syncFlagCatalog`, which inserts new flags, updates drifted
 * label/description/enabled, and deletes flags removed from the catalog (the
 * cascade FK on `tenant_features` removes their overrides). No runtime endpoint
 * mutates this table.
 */
export const features = pgTable(
  'features',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    key: varchar('key', { length: 63 }).notNull(),
    label: varchar('label', { length: 120 }).notNull(),
    description: text('description').notNull().default(''),
    enabled: boolean('enabled').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    keyIdx: uniqueIndex('features_key_idx').on(t.key),
  }),
);

/**
 * Per-tenant feature-flag OVERRIDES (the junction). A row here is a tenant's
 * explicit on/off for a flag; absence of a row means "inherit the catalog
 * default". Both FKs cascade: deleting a tenant or a feature removes its
 * overrides automatically.
 */
export const tenantFeatures = pgTable(
  'tenant_features',
  {
    tenantId: uuid('tenant_id').notNull(),
    featureId: uuid('feature_id').notNull(),
    enabled: boolean('enabled').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.tenantId, t.featureId] }),
    tenantFk: foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete('cascade'),
    featureFk: foreignKey({ columns: [t.featureId], foreignColumns: [features.id] }).onDelete('cascade'),
  }),
);

export type Feature = typeof features.$inferSelect;
export type NewFeature = typeof features.$inferInsert;
export type TenantFeature = typeof tenantFeatures.$inferSelect;
export type NewTenantFeature = typeof tenantFeatures.$inferInsert;
