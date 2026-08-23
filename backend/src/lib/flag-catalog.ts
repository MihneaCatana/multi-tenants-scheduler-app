import { eq, inArray } from 'drizzle-orm';
import { globalDb } from '../db/client.js';
import { features } from '../db/schema/global/features.js';
import { FeatureFlag } from './flags.js';

/**
 * The code-defined feature-flag catalog — the SOLE authority for what flags
 * exist. At boot, `syncFlagCatalog` mirrors this into the `features` table:
 * insert new, update drifted label/description/enabled, delete removed (cascading
 * their tenant overrides). No runtime endpoint mutates `features`.
 *
 * Keys MUST match `FeatureFlag` members (asserted in `assertCatalogConsistency`).
 */
export const FLAG_CATALOG = [
  {
    key: FeatureFlag.RESERVATIONS,
    label: 'Table Reservations',
    description: 'Let guests book tables; manage reservation slots and capacity.',
    enabled: false,
  },
  {
    key: FeatureFlag.INVENTORY,
    label: 'Inventory',
    description: 'Track stock levels, SKUs, and supplier reorder points.',
    enabled: false,
  },
  {
    key: FeatureFlag.POS,
    label: 'Point of Sale',
    description: 'Ring up sales, take payments, and print receipts.',
    enabled: false,
  },
  {
    key: FeatureFlag.APPOINTMENTS,
    label: 'Appointments',
    description: 'Book and manage appointments with multi-resource scheduling.',
    enabled: false,
  },
] as const;

export interface CatalogEntry {
  key: string;
  label: string;
  description: string;
  enabled: boolean;
}

/** Ensure every `FeatureFlag` enum member has a catalog entry and vice-versa. */
function assertCatalogConsistency(): void {
  const enumKeys = new Set<string>(Object.values(FeatureFlag));
  const catalogKeys = new Set<string>(FLAG_CATALOG.map((f) => f.key));
  const missing = [...enumKeys].filter((k) => !catalogKeys.has(k));
  const extra = [...catalogKeys].filter((k) => !enumKeys.has(k));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `FLAG_CATALOG / FeatureFlag mismatch — missing in catalog: [${missing.join(', ')}], ` +
        `in catalog but not enum: [${extra.join(', ')}].`,
    );
  }
}

/**
 * Mirror `FLAG_CATALOG` into the `features` table. Idempotent; safe to run on
 * every boot. Runs in the order: delete-removed → insert-new → update-drifted,
 * within a single transaction so a partial sync never leaves the catalog half-
 * applied.
 *
 * Returns a summary of what changed (handy for the startup log).
 */
export async function syncFlagCatalog(): Promise<{ inserted: number; updated: number; deleted: number }> {
  assertCatalogConsistency();

  return await globalDb.transaction(async (tx) => {
    const existing = await tx.select().from(features);

    const catalogKeys: string[] = FLAG_CATALOG.map((f) => f.key);
    const existingByKey = new Map(existing.map((f) => [f.key, f]));

    // 1. Delete flags no longer in the catalog. The cascade FK on
    //    tenant_features removes their overrides automatically.
    const removed = existing.filter((f) => !catalogKeys.includes(f.key));
    if (removed.length > 0) {
      await tx
        .delete(features)
        .where(
          inArray(
            features.key,
            removed.map((f) => f.key),
          ),
        );
    }

    // 2 + 3. Insert new + update drifted.
    let inserted = 0;
    let updated = 0;
    for (const entry of FLAG_CATALOG) {
      const row = existingByKey.get(entry.key);
      if (!row) {
        await tx.insert(features).values({
          key: entry.key,
          label: entry.label,
          description: entry.description,
          enabled: entry.enabled,
        });
        inserted++;
      } else if (
        row.label !== entry.label ||
        row.description !== entry.description ||
        row.enabled !== entry.enabled
      ) {
        await tx
          .update(features)
          .set({ label: entry.label, description: entry.description, enabled: entry.enabled, updatedAt: new Date() })
          .where(eq(features.id, row.id));
        updated++;
      }
    }

    return { inserted, updated, deleted: removed.length };
  });
}
