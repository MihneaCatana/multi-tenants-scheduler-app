/**
 * Frontend mirror of the backend `FeatureFlag` enum. This is the code-side view
 * of the catalog; the DB owns definitions. `useFlag(FeatureFlag.X)` is the
 * typo-proof way to gate tenant UI. Add a flag here whenever you add one to the
 * backend `FLAG_CATALOG` + `FeatureFlag` enum.
 */
export const FeatureFlag = {
  RESERVATIONS: 'reservations',
  INVENTORY: 'inventory',
  POS: 'pos',
  APPOINTMENTS: 'appointments',
} as const;
// eslint-disable-next-line no-redeclare -- TypeScript declaration merging: const object + derived type
export type FeatureFlag = (typeof FeatureFlag)[keyof typeof FeatureFlag];
