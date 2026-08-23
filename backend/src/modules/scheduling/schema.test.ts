import { describe, it, expect } from 'vitest';
import { createAppointmentBody, patchAppointmentBody, appointmentIdParam } from './schema.js';

describe('createAppointmentBody', () => {
  it('accepts a service-backed appointment', () => {
    const parsed = createAppointmentBody.parse({
      resourceId: '123e4567-e89b-12d3-a456-426614174000',
      serviceIds: ['123e4567-e89b-12d3-a456-426614174001'],
      startAt: '2026-07-10T14:00:00.000Z',
    });
    expect(parsed.resourceId).toBe('123e4567-e89b-12d3-a456-426614174000');
  });

  it('requires durationMinutes when serviceIds is empty', () => {
    const ok = createAppointmentBody.safeParse({
      resourceId: '123e4567-e89b-12d3-a456-426614174000',
      startAt: '2026-07-10T14:00:00.000Z',
      durationMinutes: 60,
    });
    expect(ok.success).toBe(true);
  });

  it('rejects a service-less appointment without durationMinutes', () => {
    const bad = createAppointmentBody.safeParse({
      resourceId: '123e4567-e89b-12d3-a456-426614174000',
      startAt: '2026-07-10T14:00:00.000Z',
    });
    expect(bad.success).toBe(false);
  });

  it('rejects a startAt in the past', () => {
    const bad = createAppointmentBody.safeParse({
      resourceId: '123e4567-e89b-12d3-a456-426614174000',
      serviceIds: ['123e4567-e89b-12d3-a456-426614174001'],
      startAt: '2020-01-01T00:00:00.000Z',
    });
    expect(bad.success).toBe(false);
  });
});

describe('patchAppointmentBody', () => {
  it('accepts a cancel action with a reason', () => {
    const parsed = patchAppointmentBody.parse({ action: 'cancel', reason: 'Client called.' });
    expect(parsed.action).toBe('cancel');
  });

  it('accepts a reschedule action with startAt', () => {
    const parsed = patchAppointmentBody.parse({
      action: 'reschedule',
      startAt: '2026-08-01T10:00:00.000Z',
    });
    expect(parsed.action).toBe('reschedule');
  });

  it('rejects a reschedule action without startAt', () => {
    const bad = patchAppointmentBody.safeParse({ action: 'reschedule' });
    expect(bad.success).toBe(false);
  });

  it('rejects an unknown action', () => {
    const bad = patchAppointmentBody.safeParse({ action: 'teleport' });
    expect(bad.success).toBe(false);
  });
});

describe('appointmentIdParam', () => {
  it('accepts a uuid', () => {
    expect(appointmentIdParam.parse({ id: '123e4567-e89b-12d3-a456-426614174000' }).id).toBeTruthy();
  });
});
