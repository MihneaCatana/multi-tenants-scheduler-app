import { createContext } from 'react';

/**
 * Shape of the resolved per-tenant flag map held by `FlagsProvider`. Kept here
 * (rather than inside `FlagsProvider.tsx`) so both the provider component and
 * the hooks in `hooks.ts` can import the context instance without creating a
 * Fast Refresh "incompatible export" situation in the component file.
 */
export interface FlagsContextValue {
  flags: Record<string, boolean>;
  loading: boolean;
}

export const FlagsContext = createContext<FlagsContextValue | null>(null);
