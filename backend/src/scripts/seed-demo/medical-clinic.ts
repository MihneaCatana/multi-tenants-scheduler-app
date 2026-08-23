/**
 * Demo seed — Medical / Dental Clinic
 *
 * Usage:
 *   pnpm seed:demo:clinic -- --subdomain acme --password yourpassword
 *
 * Optional:
 *   --url       Backend URL (default http://localhost:3000)
 *   --email     Login email (default owner@<subdomain>.com)
 *
 * Seeds: 3 providers, 3 rooms, 1 equipment, 6 services,
 *        15 clients, ~25 appointments across the current week.
 */
import {
  parseConfig,
  login,
  listActiveStaff,
  createClient,
  createResource,
  createService,
  createAppointment,
  patchAppointment,
  mondayOffset,
  dateAt,
} from './helpers.js';

// ---------------------------------------------------------------------------
//  Config
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const SUBDOMAIN = 'clinic'; // default subdomain fallback

// ---------------------------------------------------------------------------
//  Seed data
// ---------------------------------------------------------------------------

const RESOURCES = [
  { name: 'Dr. Elena Popescu', type: 'provider' as const },
  { name: 'Dr. Andrei Marinescu', type: 'provider' as const },
  { name: 'Dr. Maria Ionescu', type: 'provider' as const },
  { name: 'Consultation Room 1', type: 'room' as const },
  { name: 'Consultation Room 2', type: 'room' as const },
  { name: 'X-Ray Room', type: 'room' as const },
  { name: 'Portable Ultrasound', type: 'equipment' as const },
];

const SERVICES = [
  { name: 'General Consultation', durationMinutes: 30, bufferBefore: 0, bufferAfter: 0, price: 150 },
  { name: 'Dental Cleaning', durationMinutes: 45, bufferBefore: 0, bufferAfter: 15, price: 250 },
  { name: 'X-Ray Examination', durationMinutes: 20, bufferBefore: 0, bufferAfter: 5, price: 120 },
  { name: 'Ultrasound Scan', durationMinutes: 25, bufferBefore: 5, bufferAfter: 5, price: 200 },
  { name: 'Follow-up Visit', durationMinutes: 15, bufferBefore: 0, bufferAfter: 0, price: 80 },
  { name: 'Emergency Consultation', durationMinutes: 60, bufferBefore: 0, bufferAfter: 0, price: 300 },
];

const CLIENTS = [
  { name: 'Ioana Georgescu', email: 'ioana.georgescu@email.com', phone: '+40 722 111 222', notes: 'Allergic to penicillin' },
  { name: 'Mihai Radu', email: 'mihai.radu@email.com', phone: '+40 733 222 333', notes: '' },
  { name: 'Catalina Popa', email: 'catalina.popa@email.com', phone: '', notes: 'Prefers Dr. Popescu' },
  { name: 'Alexandru Dima', email: 'alex.dima@email.com', phone: '+40 744 333 444', notes: '' },
  { name: 'Elena Stanescu', email: 'elena.stanescu@email.com', phone: '', notes: 'Diabetic — monitor during procedures' },
  { name: 'Bogdan Munteanu', email: 'bogdan.m@email.com', phone: '+40 755 444 555', notes: '' },
  { name: 'Laura Farcas', email: 'laura.farcas@email.com', phone: '', notes: 'Follow-up required after surgery' },
  { name: 'Andrei Nicolae', email: 'andrei.nicolae@email.com', phone: '+40 766 555 666', notes: '' },
  { name: 'Simona Barbu', email: 'simona.barbu@email.com', phone: '', notes: 'Pregnant — no X-rays' },
  { name: 'Cosmin Tudor', email: 'cosmin.tudor@email.com', phone: '+40 777 666 777', notes: 'Prefers morning slots' },
  { name: 'Diana Moraru', email: 'diana.moraru@email.com', phone: '', notes: '' },
  { name: 'Florin Cristea', email: 'florin.cristea@email.com', phone: '+40 788 777 888', notes: '' },
  { name: 'Adriana Ion', email: 'adriana.ion@email.com', phone: '', notes: 'Orthodontic treatment ongoing' },
  { name: 'Gabriel Marin', email: 'gabriel.marin@email.com', phone: '+40 799 888 999', notes: '' },
  { name: 'Ruxandra Dobre', email: 'ruxandra.dobre@email.com', phone: '', notes: 'Walk-in patient' },
];

/**
 * Appointment template — week offsets are relative to the Monday of the current week.
 * Past appointments get status transitions replayed; future ones stay as 'confirmed'.
 */
interface ApptDef {
  clientIdx: number;
  resourceIdx: number;
  serviceIdx: number;
  weekOffset: number;  // 0 = this week, -1 = last week, +1 = next week, etc.
  day: number;         // 0=Mon … 4=Fri
  hour: number;
  minute: number;
  transitions: Array<{ action: string; note?: string; reason?: string }>;
}

const APPOINTMENTS: ApptDef[] = [
  // ---- 2 weeks ago (all completed / cancelled / no-show) ----
  { clientIdx: 0,  resourceIdx: 0, serviceIdx: 0, weekOffset: -2, day: 0, hour: 8,  minute: 0,  transitions: [{ action: 'check_in', note: 'Patient arrived' }, { action: 'start' }, { action: 'complete' }] },
  { clientIdx: 1,  resourceIdx: 1, serviceIdx: 1, weekOffset: -2, day: 0, hour: 9,  minute: 0,  transitions: [{ action: 'check_in', note: 'Patient arrived' }, { action: 'start' }, { action: 'complete' }] },
  { clientIdx: 3,  resourceIdx: 2, serviceIdx: 0, weekOffset: -2, day: 1, hour: 10, minute: 0,  transitions: [{ action: 'check_in', note: 'Patient arrived' }, { action: 'start' }, { action: 'complete' }] },
  { clientIdx: 5,  resourceIdx: 1, serviceIdx: 2, weekOffset: -2, day: 1, hour: 14, minute: 0,  transitions: [{ action: 'cancel', reason: 'Patient rescheduled' }] },
  { clientIdx: 4,  resourceIdx: 0, serviceIdx: 3, weekOffset: -2, day: 2, hour: 8,  minute: 30, transitions: [{ action: 'check_in', note: 'Patient arrived' }, { action: 'start' }, { action: 'complete' }] },
  { clientIdx: 7,  resourceIdx: 2, serviceIdx: 5, weekOffset: -2, day: 3, hour: 9,  minute: 0,  transitions: [{ action: 'no_show', note: 'Patient did not arrive' }] },
  { clientIdx: 8,  resourceIdx: 0, serviceIdx: 0, weekOffset: -2, day: 3, hour: 11, minute: 0,  transitions: [{ action: 'check_in', note: 'Patient arrived' }, { action: 'start' }, { action: 'complete' }] },
  { clientIdx: 2,  resourceIdx: 1, serviceIdx: 4, weekOffset: -2, day: 4, hour: 8,  minute: 0,  transitions: [{ action: 'check_in', note: 'Patient arrived' }, { action: 'start' }, { action: 'complete' }] },
  { clientIdx: 10, resourceIdx: 2, serviceIdx: 3, weekOffset: -2, day: 4, hour: 14, minute: 0,  transitions: [{ action: 'check_in', note: 'Patient arrived' }, { action: 'start' }, { action: 'complete' }] },

  // ---- last week (mix of completed, in_progress, no-show) ----
  { clientIdx: 6,  resourceIdx: 0, serviceIdx: 4, weekOffset: -1, day: 0, hour: 8,  minute: 0,  transitions: [{ action: 'check_in', note: 'Patient arrived' }, { action: 'start' }, { action: 'complete' }] },
  { clientIdx: 9,  resourceIdx: 2, serviceIdx: 1, weekOffset: -1, day: 0, hour: 10, minute: 0,  transitions: [{ action: 'check_in', note: 'Patient arrived' }, { action: 'start' }, { action: 'complete' }] },
  { clientIdx: 11, resourceIdx: 1, serviceIdx: 0, weekOffset: -1, day: 1, hour: 9,  minute: 30, transitions: [{ action: 'check_in', note: 'Patient arrived' }, { action: 'start' }, { action: 'complete' }] },
  { clientIdx: 12, resourceIdx: 0, serviceIdx: 2, weekOffset: -1, day: 1, hour: 11, minute: 0,  transitions: [{ action: 'check_in', note: 'Patient arrived' }, { action: 'start' }, { action: 'complete' }] },
  { clientIdx: 0,  resourceIdx: 2, serviceIdx: 3, weekOffset: -1, day: 2, hour: 8,  minute: 0,  transitions: [{ action: 'check_in', note: 'Patient arrived' }, { action: 'start' }, { action: 'complete' }] },
  { clientIdx: 3,  resourceIdx: 1, serviceIdx: 0, weekOffset: -1, day: 2, hour: 10, minute: 0,  transitions: [{ action: 'no_show', note: 'Patient did not arrive' }] },
  { clientIdx: 13, resourceIdx: 0, serviceIdx: 1, weekOffset: -1, day: 3, hour: 9,  minute: 0,  transitions: [{ action: 'check_in', note: 'Patient arrived' }, { action: 'start' }] },
  { clientIdx: 14, resourceIdx: 2, serviceIdx: 4, weekOffset: -1, day: 3, hour: 11, minute: 0,  transitions: [{ action: 'check_in', note: 'Patient arrived' }, { action: 'start' }] },
  { clientIdx: 1,  resourceIdx: 0, serviceIdx: 5, weekOffset: -1, day: 4, hour: 8,  minute: 0,  transitions: [{ action: 'check_in', note: 'Patient arrived' }, { action: 'start' }, { action: 'complete' }] },
  { clientIdx: 5,  resourceIdx: 1, serviceIdx: 1, weekOffset: -1, day: 4, hour: 14, minute: 0,  transitions: [{ action: 'cancel', reason: 'Patient rescheduled' }] },

  // ---- this week (mix — past days completed, today/future confirmed or in_progress) ----
  { clientIdx: 4,  resourceIdx: 1, serviceIdx: 3, weekOffset: 0, day: 0, hour: 8,  minute: 30, transitions: [{ action: 'check_in', note: 'Patient arrived' }, { action: 'start' }, { action: 'complete' }] },
  { clientIdx: 6,  resourceIdx: 0, serviceIdx: 4, weekOffset: 0, day: 0, hour: 10, minute: 0,  transitions: [{ action: 'check_in', note: 'Patient arrived' }, { action: 'start' }, { action: 'complete' }] },
  { clientIdx: 8,  resourceIdx: 2, serviceIdx: 0, weekOffset: 0, day: 1, hour: 9,  minute: 0,  transitions: [{ action: 'check_in', note: 'Patient arrived' }, { action: 'start' }, { action: 'complete' }] },
  { clientIdx: 10, resourceIdx: 1, serviceIdx: 3, weekOffset: 0, day: 1, hour: 14, minute: 0,  transitions: [{ action: 'check_in', note: 'Patient arrived' }, { action: 'start' }] },
  { clientIdx: 2,  resourceIdx: 0, serviceIdx: 0, weekOffset: 0, day: 2, hour: 10, minute: 0,  transitions: [] },
  { clientIdx: 7,  resourceIdx: 2, serviceIdx: 1, weekOffset: 0, day: 2, hour: 14, minute: 0,  transitions: [] },
  { clientIdx: 12, resourceIdx: 1, serviceIdx: 4, weekOffset: 0, day: 3, hour: 9,  minute: 0,  transitions: [] },
  { clientIdx: 9,  resourceIdx: 0, serviceIdx: 5, weekOffset: 0, day: 4, hour: 10, minute: 0,  transitions: [] },
  { clientIdx: 14, resourceIdx: 2, serviceIdx: 2, weekOffset: 0, day: 4, hour: 15, minute: 0,  transitions: [] },

  // ---- next week (all confirmed / upcoming) ----
  { clientIdx: 0,  resourceIdx: 0, serviceIdx: 4, weekOffset: 1, day: 0, hour: 8,  minute: 0,  transitions: [] },
  { clientIdx: 3,  resourceIdx: 2, serviceIdx: 0, weekOffset: 1, day: 0, hour: 10, minute: 0,  transitions: [] },
  { clientIdx: 5,  resourceIdx: 1, serviceIdx: 1, weekOffset: 1, day: 1, hour: 9,  minute: 0,  transitions: [] },
  { clientIdx: 11, resourceIdx: 0, serviceIdx: 2, weekOffset: 1, day: 1, hour: 11, minute: 0,  transitions: [] },
  { clientIdx: 1,  resourceIdx: 2, serviceIdx: 3, weekOffset: 1, day: 2, hour: 8,  minute: 30, transitions: [] },
  { clientIdx: 8,  resourceIdx: 0, serviceIdx: 0, weekOffset: 1, day: 2, hour: 14, minute: 0,  transitions: [] },
  { clientIdx: 13, resourceIdx: 1, serviceIdx: 5, weekOffset: 1, day: 3, hour: 9,  minute: 0,  transitions: [] },
  { clientIdx: 6,  resourceIdx: 2, serviceIdx: 1, weekOffset: 1, day: 3, hour: 15, minute: 30, transitions: [] },
  { clientIdx: 10, resourceIdx: 0, serviceIdx: 4, weekOffset: 1, day: 4, hour: 8,  minute: 0,  transitions: [] },
  { clientIdx: 4,  resourceIdx: 1, serviceIdx: 3, weekOffset: 1, day: 4, hour: 14, minute: 0,  transitions: [] },

  // ---- 2 weeks ahead (all confirmed) ----
  { clientIdx: 2,  resourceIdx: 0, serviceIdx: 0, weekOffset: 2, day: 0, hour: 9,  minute: 0,  transitions: [] },
  { clientIdx: 7,  resourceIdx: 1, serviceIdx: 1, weekOffset: 2, day: 1, hour: 10, minute: 0,  transitions: [] },
  { clientIdx: 12, resourceIdx: 2, serviceIdx: 4, weekOffset: 2, day: 2, hour: 8,  minute: 0,  transitions: [] },
  { clientIdx: 9,  resourceIdx: 0, serviceIdx: 2, weekOffset: 2, day: 3, hour: 11, minute: 0,  transitions: [] },
  { clientIdx: 3,  resourceIdx: 1, serviceIdx: 5, weekOffset: 2, day: 4, hour: 14, minute: 0,  transitions: [] },
];

// ---------------------------------------------------------------------------
//  Main
// ---------------------------------------------------------------------------

async function main() {
  const config = parseConfig(argv);

  console.log(`🌿 Seeding demo data for "${SUBDOMAIN}" (Medical Clinic)…\n`);

  await login(config);

  const monOff = mondayOffset();

  // --- Clients ---
  const clientIds: string[] = [];
  for (const c of CLIENTS) {
    const id = await createClient(config, {
      name: c.name,
      email: c.email,
      phone: c.phone || undefined,
      notes: c.notes || undefined,
    });
    clientIds.push(id);
  }
  console.log(`  ✓ ${clientIds.length} clients`);

  // --- Resources ---
  const staffList = await listActiveStaff(config);
  const providerCount = RESOURCES.filter((r) => r.type === 'provider').length;
  if (staffList.length < providerCount) {
    console.log(`  ⚠ Only ${staffList.length} staff member(s) found — cycling for ${providerCount} providers`);
  }
  let staffIdx = 0;
  const resourceIds: string[] = [];
  for (const r of RESOURCES) {
    const id = await createResource(config, {
      name: r.name,
      type: r.type,
      linkedStaffId: r.type === 'provider' ? staffList[staffIdx % staffList.length]!.id : undefined,
    });
    if (r.type === 'provider') staffIdx++;
    resourceIds.push(id);
  }
  console.log(`  ✓ ${resourceIds.length} resources`);

  // --- Services ---
  const serviceIds: string[] = [];
  for (const s of SERVICES) {
    const id = await createService(config, {
      name: s.name,
      durationMinutes: s.durationMinutes,
      bufferBeforeMinutes: s.bufferBefore,
      bufferAfterMinutes: s.bufferAfter,
      price: s.price,
    });
    serviceIds.push(id);
  }
  console.log(`  ✓ ${serviceIds.length} services`);

  // --- Appointments ---
  for (const a of APPOINTMENTS) {
    const svc = SERVICES[a.serviceIdx]!;
    const startAt = dateAt(a.hour, a.minute, monOff + a.weekOffset * 7 + a.day);

    const apptId = await createAppointment(config, {
      clientId: clientIds[a.clientIdx]!,
      resourceId: resourceIds[a.resourceIdx]!,
      serviceIds: [serviceIds[a.serviceIdx]!],
      startAt,
      durationMinutes: svc.durationMinutes,
    });

    // Replay status transitions
    for (const t of a.transitions) {
      await patchAppointment(config, apptId, t);
    }
  }
  console.log(`  ✓ ${APPOINTMENTS.length} appointments`);

  console.log('\n✅ Demo data seeded successfully.');
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
