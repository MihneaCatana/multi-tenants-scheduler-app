import type { AppointmentStatus } from '../../db/schema/tenant/appointments.js';
import { invalidTransition } from '../../lib/errors.js';

/**
 * The set of actions an appointment can undergo. Each maps to one or more legal
 * transitions in TRANSITIONS below.
 */
export type AppointmentAction =
  | 'confirm'
  | 'check_in'
  | 'start'
  | 'complete'
  | 'cancel'
  | 'no_show'
  | 'reschedule';

/**
 * The legal transition graph: { [fromStatus]: { [action]: toStatus } }.
 *
 * This is the SINGLE source of truth for "can this appointment move from X to
 * Y" — no scattered if-statements elsewhere. `requested` is included for
 * forward-compat (client self-booking, phase 5) but is not reachable from staff
 * booking in phase 1 (staff booking creates directly in `confirmed`).
 *
 * Terminal statuses (completed, cancelled, no_show) have empty maps — no
 * outgoing transitions, no automatic revive.
 */
export const TRANSITIONS: Record<AppointmentStatus, Partial<Record<AppointmentAction, AppointmentStatus>>> = {
  requested: { confirm: 'confirmed', cancel: 'cancelled' },
  confirmed: {
    check_in: 'checked_in',
    start: 'in_progress',
    cancel: 'cancelled',
    no_show: 'no_show',
    reschedule: 'confirmed',
  },
  checked_in: { start: 'in_progress', cancel: 'cancelled', no_show: 'no_show' },
  in_progress: { complete: 'completed' },
  completed: {},
  cancelled: {},
  no_show: {},
};

/** Can the appointment in status `from` perform `action`? */
export function canTransition(from: AppointmentStatus, action: AppointmentAction): boolean {
  return action in TRANSITIONS[from];
}

/**
 * Assert the transition is legal and return the target status. Throws 409
 * INVALID_TRANSITION otherwise — a stable error code the frontend can map.
 */
export function assertCanTransition(from: AppointmentStatus, action: AppointmentAction): AppointmentStatus {
  const to = TRANSITIONS[from][action];
  if (!to) {
    throw invalidTransition(from, action);
  }
  return to;
}
