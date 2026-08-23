import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { DB_AVAILABLE, getTestDb, seedResource, seedService, cleanup, ensureTestStaff, TEST_STAFF_ID } from '../../test/db-helpers.js';
import { createAppointment, rescheduleAppointment, transitionStatus } from './service.js';

// Skip the whole suite when no DB is reachable (CI without docker, etc.).
const suite = DB_AVAILABLE ? describe : describe.skip;

suite('scheduling service (real DB)', () => {
  const db = getTestDb();
  const FUTURE = new Date(Date.now() + 7 * 86_400_000).toISOString(); // +7 days

  beforeAll(async () => {
    await ensureTestStaff(db);
  });

  afterEach(async () => {
    await cleanup(db);
  });

  it('rejects a double-booking on the same resource', async () => {
    const chair = await seedResource(db, { type: 'chair', name: 'Test-Chair-Double' });
    const svc = await seedService(db, { durationMinutes: 60 });
    await createAppointment(
      db,
      { resourceId: chair.id, serviceIds: [svc.id], startAt: FUTURE },
      TEST_STAFF_ID,
    );
    await expect(
      createAppointment(
        db,
        { resourceId: chair.id, serviceIds: [svc.id], startAt: FUTURE },
        TEST_STAFF_ID,
      ),
    ).rejects.toMatchObject({ code: 'APPOINTMENT_CONFLICT' });
  });

  it('allows concurrent bookings on different resources at the same time', async () => {
    const room1 = await seedResource(db, { type: 'room', name: 'Test-Room-1' });
    const room2 = await seedResource(db, { type: 'room', name: 'Test-Room-2' });
    const svc = await seedService(db, { durationMinutes: 60 });
    await createAppointment(
      db,
      { resourceId: room1.id, serviceIds: [svc.id], startAt: FUTURE },
      TEST_STAFF_ID,
    );
    await expect(
      createAppointment(
        db,
        { resourceId: room2.id, serviceIds: [svc.id], startAt: FUTURE },
        TEST_STAFF_ID,
      ),
    ).resolves.toBeTruthy();
  });

  it('extends the booked window by the service buffer', async () => {
    const chair = await seedResource(db, { type: 'chair', name: 'Test-Chair-Buf' });
    const svc = await seedService(db, { durationMinutes: 60, bufferBefore: 15, bufferAfter: 15 });
    const start = new Date(Date.now() + 8 * 86_400_000);
    await createAppointment(
      db,
      { resourceId: chair.id, serviceIds: [svc.id], startAt: start.toISOString() },
      TEST_STAFF_ID,
    );
    // A booking starting 5 min after end (within the 15-min buffer) must conflict
    const tooEarly = new Date(start.getTime() + 65 * 60_000).toISOString();
    await expect(
      createAppointment(
        db,
        { resourceId: chair.id, serviceIds: [svc.id], startAt: tooEarly },
        TEST_STAFF_ID,
      ),
    ).rejects.toMatchObject({ code: 'APPOINTMENT_CONFLICT' });
    // One starting at end + buffer-after + buffer-before (both buffers apply to
    // the gap between adjacent bookings) is fine.
    const ok = new Date(start.getTime() + 90 * 60_000).toISOString();
    await expect(
      createAppointment(
        db,
        { resourceId: chair.id, serviceIds: [svc.id], startAt: ok },
        TEST_STAFF_ID,
      ),
    ).resolves.toBeTruthy();
  });

  it('walks the lifecycle and writes history', async () => {
    const r = await seedResource(db, { type: 'provider', name: 'Test-Dr-X' });
    const svc = await seedService(db, { durationMinutes: 30 });
    const { id } = await createAppointment(
      db,
      { resourceId: r.id, serviceIds: [svc.id], startAt: FUTURE },
      TEST_STAFF_ID,
    );
    await transitionStatus(db, id, 'check_in', TEST_STAFF_ID, {});
    await transitionStatus(db, id, 'start', TEST_STAFF_ID, {});
    await transitionStatus(db, id, 'complete', TEST_STAFF_ID, {});
    // Illegal: completed -> check_in
    await expect(transitionStatus(db, id, 'check_in', TEST_STAFF_ID, {})).rejects.toMatchObject({
      code: 'INVALID_TRANSITION',
    });
  });

  it('cancel frees the slot for rebooking', async () => {
    const r = await seedResource(db, { type: 'room', name: 'Test-Room-Z' });
    const svc = await seedService(db, { durationMinutes: 60 });
    const { id } = await createAppointment(
      db,
      { resourceId: r.id, serviceIds: [svc.id], startAt: FUTURE },
      TEST_STAFF_ID,
    );
    await transitionStatus(db, id, 'cancel', TEST_STAFF_ID, { reason: 'No-show caller' });
    // Same window should now be bookable
    await expect(
      createAppointment(
        db,
        { resourceId: r.id, serviceIds: [svc.id], startAt: FUTURE },
        TEST_STAFF_ID,
      ),
    ).resolves.toBeTruthy();
  });

  it('reschedule moves the appointment and frees the old window', async () => {
    const r = await seedResource(db, { type: 'provider', name: 'Test-Dr-Y' });
    const svc = await seedService(db, { durationMinutes: 60 });
    const start = new Date(Date.now() + 9 * 86_400_000);
    const { id } = await createAppointment(
      db,
      { resourceId: r.id, serviceIds: [svc.id], startAt: start.toISOString() },
      TEST_STAFF_ID,
    );
    const moved = new Date(start.getTime() + 2 * 86_400_000).toISOString(); // +2 days
    await rescheduleAppointment(db, id, moved, TEST_STAFF_ID);
    // Old window is now free
    await expect(
      createAppointment(
        db,
        { resourceId: r.id, serviceIds: [svc.id], startAt: start.toISOString() },
        TEST_STAFF_ID,
      ),
    ).resolves.toBeTruthy();
  });
});
