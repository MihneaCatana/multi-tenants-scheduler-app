/**
 * Appointment lifecycle helpers.
 *
 * Mirrors the backend state machine in
 * backend/src/modules/scheduling/state-machine.ts. Used to proactively disable
 * illegal action buttons in the UI; the backend 409 INVALID_TRANSITION is the
 * authoritative backstop.
 */

import type { AppointmentStatus, AppointmentAction, ResourceType } from '../../lib/types';

/** Tone values accepted by the <Badge> component. */
type BadgeTone = 'neutral' | 'green' | 'amber' | 'red' | 'brand';

/**
 * Maps each appointment status to the actions that are legally available from
 * that status. Terminal statuses have empty arrays.
 *
 * `confirm` is excluded — it is unreachable in Phase 1 (staff booking creates
 * directly in `confirmed`; `requested` is reserved for future client
 * self-service).
 */
export const LEGAL_ACTIONS: Record<AppointmentStatus, AppointmentAction[]> = {
  requested: ['cancel'],
  confirmed: ['check_in', 'start', 'cancel', 'no_show', 'reschedule'],
  checked_in: ['start', 'cancel', 'no_show'],
  in_progress: ['complete'],
  completed: [],
  cancelled: [],
  no_show: [],
};

/** Maps each appointment status to a Badge tone for the status column. */
export const STATUS_BADGE_TONE: Record<AppointmentStatus, BadgeTone> = {
  requested: 'amber',
  confirmed: 'brand',
  checked_in: 'brand',
  in_progress: 'brand',
  completed: 'green',
  cancelled: 'neutral',
  no_show: 'neutral',
};

/**
 * All appointment statuses (ordered roughly by lifecycle progression).
 * Used to build the status filter dropdown.
 */
export const ALL_STATUSES: AppointmentStatus[] = [
  'confirmed',
  'checked_in',
  'in_progress',
  'completed',
  'requested',
  'cancelled',
  'no_show',
];

/**
 * Returns day-of-week labels (0 = Sunday, 6 = Saturday).
 * Used in the working-hours UI. Accepts a translation function.
 */
export function getDayLabels(t: (key: 'life_daySun' | 'life_dayMon' | 'life_dayTue' | 'life_dayWed' | 'life_dayThu' | 'life_dayFri' | 'life_daySat') => string): Record<number, string> {
  return {
    0: t('life_daySun'),
    1: t('life_dayMon'),
    2: t('life_dayTue'),
    3: t('life_dayWed'),
    4: t('life_dayThu'),
    5: t('life_dayFri'),
    6: t('life_daySat'),
  };
}

/**
 * Returns resource type labels. Accepts a translation function.
 */
export function getResourceTypeLabels(t: (key: 'life_typeProvider' | 'life_typeRoom' | 'life_typeEquipment' | 'life_typeChair') => string): Record<ResourceType, string> {
  return {
    provider: t('life_typeProvider'),
    room: t('life_typeRoom'),
    equipment: t('life_typeEquipment'),
    chair: t('life_typeChair'),
  };
}
