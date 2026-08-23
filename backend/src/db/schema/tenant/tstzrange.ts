import { customType } from 'drizzle-orm/pg-core';

/**
 * Custom Drizzle type for PostgreSQL `tstzrange` (a range of timestamps with
 * time zone). Used by `appointment_resources.booked_range` to power the GiST
 * exclusion constraint that prevents double-booking.
 *
 * Values are exchanged as PG range literals, e.g.:
 *   [2026-07-10T14:00:00+00:00,2026-07-10T15:00:00+00:00)
 *
 * We store the lower bound inclusive `[` and upper bound exclusive `)`. The
 * service layer constructs the literal string from two Date objects; reads are
 * rare (the slot engine is deferred), so we return the raw string for now.
 */
export const tstzrange = customType<{
  data: string; // PG range literal, e.g. "[2026-...,2026-...)"
  driverData: string;
}>({
  dataType() {
    return 'tstzrange';
  },
});

/**
 * Build a PG tstzrange literal from two Dates: [start, end) —
 * lower-inclusive, upper-exclusive. This matches how the GiST `&&` (overlaps)
 * operator expects adjacent bookings to butt up without conflicting.
 */
export function rangeLiteral(start: Date, end: Date): string {
  // toISOString() yields e.g. 2026-07-10T14:00:00.000Z — PG accepts this in a
  // tstzrange literal.
  return `[${start.toISOString()},${end.toISOString()})`;
}
