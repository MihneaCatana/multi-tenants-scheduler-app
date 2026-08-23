import { describe, it, expect } from 'vitest';
import {
  TRANSITIONS,
  canTransition,
  assertCanTransition,
  type AppointmentAction,
} from './state-machine.js';
import type { AppointmentStatus } from '../../db/schema/tenant/appointments.js';

describe('state-machine', () => {
  // Legal transitions: for each status, each defined action leads to the
  // expected target status.
  const LEGAL: Array<{ from: AppointmentStatus; action: AppointmentAction; to: AppointmentStatus }> = [
    { from: 'requested', action: 'confirm', to: 'confirmed' },
    { from: 'requested', action: 'cancel', to: 'cancelled' },
    { from: 'confirmed', action: 'check_in', to: 'checked_in' },
    { from: 'confirmed', action: 'start', to: 'in_progress' },
    { from: 'confirmed', action: 'cancel', to: 'cancelled' },
    { from: 'confirmed', action: 'no_show', to: 'no_show' },
    { from: 'confirmed', action: 'reschedule', to: 'confirmed' },
    { from: 'checked_in', action: 'start', to: 'in_progress' },
    { from: 'checked_in', action: 'cancel', to: 'cancelled' },
    { from: 'checked_in', action: 'no_show', to: 'no_show' },
    { from: 'in_progress', action: 'complete', to: 'completed' },
  ];

  for (const { from, action, to } of LEGAL) {
    it(`allows ${from} --${action}--> ${to}`, () => {
      expect(canTransition(from, action)).toBe(true);
      expect(TRANSITIONS[from][action]).toBe(to);
    });
  }

  // Terminal statuses have no outgoing transitions.
  for (const terminal of ['completed', 'cancelled', 'no_show'] as AppointmentStatus[]) {
    it(`terminal status '${terminal}' has no outgoing transitions`, () => {
      expect(Object.keys(TRANSITIONS[terminal]).length).toBe(0);
    });
  }

  // Illegal transitions are rejected.
  const ILLEGAL: Array<{ from: AppointmentStatus; action: AppointmentAction }> = [
    { from: 'completed', action: 'check_in' },
    { from: 'cancelled', action: 'start' },
    { from: 'no_show', action: 'complete' },
    { from: 'confirmed', action: 'complete' }, // must go through in_progress
    { from: 'in_progress', action: 'cancel' }, // can't cancel mid-service
  ];

  for (const { from, action } of ILLEGAL) {
    it(`rejects ${from} --${action}-->`, () => {
      expect(canTransition(from, action)).toBe(false);
    });
  }

  it('assertCanTransition throws on illegal transition', () => {
    expect(() => assertCanTransition('completed', 'check_in')).toThrow();
  });

  it('assertCanTransition returns the target status on legal transition', () => {
    expect(assertCanTransition('confirmed', 'check_in')).toBe('checked_in');
  });
});
