import { useContext } from 'react';
import { FlagsContext } from './context';
import type { FeatureFlag } from '../../lib/flags';

/**
 * Read one flag. Returns `false` until flags load and for unknown keys. Always
 * pass a `FeatureFlag.*` member — never a raw string — so call sites are
 * typo-checked.
 *
 * Lives in its own module (not in `FlagsProvider.tsx`) so that the provider
 * file exports only a React component — this keeps vite-plugin-react Fast
 * Refresh happy (a component-exporting file may not also export hooks).
 */
export function useFlag(flag: FeatureFlag): boolean {
  const ctx = useContext(FlagsContext);
  if (!ctx) return false;
  return ctx.flags[flag] === true;
}

/** True until the initial flag fetch resolves (use to gate first paint). */
export function useFlagsLoading(): boolean {
  const ctx = useContext(FlagsContext);
  return ctx?.loading ?? true;
}
