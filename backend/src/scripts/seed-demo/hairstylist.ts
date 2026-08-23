/**
 * Demo seed — Hair Salon / Barber
 *
 * Usage:
 *   pnpm seed:demo:salon -- --subdomain acme --password yourpassword
 *
 * Optional:
 *   --url       Backend URL (default http://localhost:3000)
 *   --email     Login email (default owner@<subdomain>.com)
 *
 * Seeds: 3 providers, 3 chairs, 2 equipment, 7 services,
 *        12 clients, ~20 appointments across the current week.
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
const SUBDOMAIN = 'salon'; // default subdomain fallback

// ---------------------------------------------------------------------------
//  Seed data
// ---------------------------------------------------------------------------

const RESOURCES = [
  { name: 'Ana Dumitrescu', type: 'provider' as const },
  { name: 'Bianca Vasile', type: 'provider' as const },
  { name: 'Cristi Nistor', type: 'provider' as const },
  { name: 'Station 1', type: 'chair' as const },
  { name: 'Station 2', type: 'chair' as const },
  { name: 'Station 3', type: 'chair' as const },
  { name: 'Washing Area 1', type: 'equipment' as const },
  { name: 'Washing Area 2', type: 'equipment' as const },
];

const SERVICES = [
  { name: "Women's Haircut", durationMinutes: 60, bufferBefore: 0, bufferAfter: 10, price: 80 },
  { name: "Men's Haircut", durationMinutes: 30, bufferBefore: 0, bufferAfter: 5, price: 50 },
  { name: 'Hair Coloring', durationMinutes: 90, bufferBefore: 15, bufferAfter: 15, price: 180 },
  { name: 'Blow Dry / Styling', durationMinutes: 30, bufferBefore: 0, bufferAfter: 5, price: 45 },
  { name: 'Beard Trim', durationMinutes: 15, bufferBefore: 0, bufferAfter: 0, price: 25 },
  { name: 'Deep Conditioning Treatment', durationMinutes: 45, bufferBefore: 0, bufferAfter: 10, price: 70 },
  { name: 'Balayage', durationMinutes: 120, bufferBefore: 15, bufferAfter: 15, price: 250 },
];

const CLIENTS = [
  { name: 'Maria Ionescu', email: 'maria.ionescu@email.com', phone: '+40 722 333 111', notes: '' },
  { name: 'Elena Popa', email: 'elena.popa@email.com', phone: '', notes: 'Loyal customer — prefers Ana' },
  { name: 'Andreea Dumitrescu', email: 'andreea.d@email.com', phone: '+40 733 444 222', notes: '' },
  { name: 'Marius Vasile', email: 'marius.v@email.com', phone: '', notes: '' },
  { name: 'Ioana Marin', email: 'ioana.marin@email.com', phone: '+40 744 555 333', notes: 'Sensitive scalp' },
  { name: 'Cristina Nistor', email: 'cristina.n@email.com', phone: '', notes: '' },
  { name: 'Dragos Georgescu', email: 'dragos.g@email.com', phone: '+40 755 666 444', notes: 'Regular every 3 weeks' },
  { name: 'Alexandra Stan', email: 'alex.stan@email.com', phone: '', notes: '' },
  { name: 'Bogdan Farcas', email: 'bogdan.f@email.com', phone: '+40 766 777 555', notes: '' },
  { name: 'Raluca Barbu', email: 'raluca.barbu@email.com', phone: '', notes: 'Walk-in' },
  { name: 'Tudor Moraru', email: 'tudor.m@email.com', phone: '+40 777 888 666', notes: '' },
  { name: 'Diana Cristea', email: 'diana.c@email.com', phone: '', notes: 'Prefers evening slots' },
];

interface ApptDef {
  clientIdx: number;
  resourceIdx: number;
  serviceIdx: number;
  day: number;
  hour: number;
  minute: number;
  transitions: Array<{ action: string; note?: string; reason?: string }>;
}

const APPOINTMENTS: ApptDef[] = [
  // Monday — 4 completed
  { clientIdx: 0, resourceIdx: 0, serviceIdx: 0, day: 0, hour: 9, minute: 0, transitions: [{ action: 'check_in', note: 'Client arrived' }, { action: 'start' }, { action: 'complete' }] },
  { clientIdx: 1, resourceIdx: 0, serviceIdx: 2, day: 0, hour: 10, minute: 0, transitions: [{ action: 'check_in', note: 'Client arrived' }, { action: 'start' }, { action: 'complete' }] },
  { clientIdx: 3, resourceIdx: 2, serviceIdx: 1, day: 0, hour: 11, minute: 0, transitions: [{ action: 'check_in', note: 'Client arrived' }, { action: 'start' }, { action: 'complete' }] },
  { clientIdx: 4, resourceIdx: 1, serviceIdx: 5, day: 0, hour: 14, minute: 0, transitions: [{ action: 'check_in', note: 'Client arrived' }, { action: 'start' }, { action: 'complete' }] },

  // Tuesday — 4 completed, 1 cancelled
  { clientIdx: 2, resourceIdx: 0, serviceIdx: 6, day: 1, hour: 9, minute: 0, transitions: [{ action: 'check_in', note: 'Client arrived' }, { action: 'start' }, { action: 'complete' }] },
  { clientIdx: 5, resourceIdx: 1, serviceIdx: 3, day: 1, hour: 10, minute: 0, transitions: [{ action: 'check_in', note: 'Client arrived' }, { action: 'start' }, { action: 'complete' }] },
  { clientIdx: 6, resourceIdx: 2, serviceIdx: 1, day: 1, hour: 11, minute: 0, transitions: [{ action: 'check_in', note: 'Client arrived' }, { action: 'start' }, { action: 'complete' }] },
  { clientIdx: 7, resourceIdx: 0, serviceIdx: 0, day: 1, hour: 14, minute: 0, transitions: [{ action: 'cancel', reason: 'Client rescheduled' }] },
  { clientIdx: 8, resourceIdx: 1, serviceIdx: 4, day: 1, hour: 15, minute: 0, transitions: [{ action: 'check_in', note: 'Client arrived' }, { action: 'start' }, { action: 'complete' }] },

  // Wednesday — 3 completed, 1 in_progress, 1 confirmed
  { clientIdx: 9, resourceIdx: 2, serviceIdx: 1, day: 2, hour: 9, minute: 0, transitions: [{ action: 'check_in', note: 'Client arrived' }, { action: 'start' }, { action: 'complete' }] },
  { clientIdx: 0, resourceIdx: 0, serviceIdx: 3, day: 2, hour: 10, minute: 0, transitions: [{ action: 'check_in', note: 'Client arrived' }, { action: 'start' }, { action: 'complete' }] },
  { clientIdx: 10, resourceIdx: 1, serviceIdx: 0, day: 2, hour: 11, minute: 0, transitions: [{ action: 'check_in', note: 'Client arrived' }, { action: 'start' }] },
  { clientIdx: 11, resourceIdx: 2, serviceIdx: 5, day: 2, hour: 14, minute: 0, transitions: [{ action: 'check_in', note: 'Client arrived' }, { action: 'start' }] },
  { clientIdx: 1, resourceIdx: 0, serviceIdx: 0, day: 2, hour: 16, minute: 0, transitions: [] },

  // Thursday — 3 completed, 2 confirmed
  { clientIdx: 3, resourceIdx: 1, serviceIdx: 2, day: 3, hour: 9, minute: 0, transitions: [{ action: 'check_in', note: 'Client arrived' }, { action: 'start' }, { action: 'complete' }] },
  { clientIdx: 4, resourceIdx: 0, serviceIdx: 5, day: 3, hour: 10, minute: 0, transitions: [{ action: 'check_in', note: 'Client arrived' }, { action: 'start' }, { action: 'complete' }] },
  { clientIdx: 5, resourceIdx: 2, serviceIdx: 1, day: 3, hour: 11, minute: 0, transitions: [{ action: 'check_in', note: 'Client arrived' }, { action: 'start' }, { action: 'complete' }] },
  { clientIdx: 6, resourceIdx: 0, serviceIdx: 0, day: 3, hour: 14, minute: 0, transitions: [] },
  { clientIdx: 7, resourceIdx: 1, serviceIdx: 4, day: 3, hour: 15, minute: 0, transitions: [] },

  // Friday — 2 completed, 3 confirmed (busy day)
  { clientIdx: 8, resourceIdx: 2, serviceIdx: 1, day: 4, hour: 9, minute: 0, transitions: [{ action: 'check_in', note: 'Client arrived' }, { action: 'start' }, { action: 'complete' }] },
  { clientIdx: 9, resourceIdx: 0, serviceIdx: 6, day: 4, hour: 9, minute: 0, transitions: [{ action: 'check_in', note: 'Client arrived' }, { action: 'start' }, { action: 'complete' }] },
  { clientIdx: 2, resourceIdx: 1, serviceIdx: 0, day: 4, hour: 13, minute: 0, transitions: [] },
  { clientIdx: 10, resourceIdx: 0, serviceIdx: 3, day: 4, hour: 14, minute: 0, transitions: [] },
  { clientIdx: 11, resourceIdx: 2, serviceIdx: 2, day: 4, hour: 15, minute: 0, transitions: [] },
];

// ---------------------------------------------------------------------------
//  Main
// ---------------------------------------------------------------------------

async function main() {
  const config = parseConfig(argv);

  console.log(`💇 Seeding demo data for "${SUBDOMAIN}" (Hair Salon)…\n`);

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
    const startAt = dateAt(a.hour, a.minute, monOff + a.day);

    const apptId = await createAppointment(config, {
      clientId: clientIds[a.clientIdx]!,
      resourceId: resourceIds[a.resourceIdx]!,
      serviceIds: [serviceIds[a.serviceIdx]!],
      startAt,
      durationMinutes: svc.durationMinutes,
    });

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
