/**
 * Demo seed — Delivery / Logistics Hub
 *
 * Usage:
 *   pnpm seed:demo:logistics -- --subdomain acme --password yourpassword
 *
 * Optional:
 *   --url       Backend URL (default http://localhost:3000)
 *   --email     Login email (default owner@<subdomain>.com)
 *
 * Seeds: 3 courier teams, 2 warehouse bays, 2 vans, 1 sorting station,
 *        6 services, 10 clients (businesses), ~18 appointments across the week.
 */
import {
  parseConfig,
  login,
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
const SUBDOMAIN = 'logistics'; // default subdomain fallback

// ---------------------------------------------------------------------------
//  Seed data
// ---------------------------------------------------------------------------

const RESOURCES = [
  { name: 'Courier Team A — Downtown', type: 'equipment' as const, notes: 'Covers central business district' },
  { name: 'Courier Team B — Suburban', type: 'equipment' as const, notes: 'Residential and industrial zones' },
  { name: 'Courier Team C — Express', type: 'equipment' as const, notes: 'Same-day and urgent deliveries' },
  { name: 'Warehouse Bay 1', type: 'room' as const, notes: 'Loading dock — north' },
  { name: 'Warehouse Bay 2', type: 'room' as const, notes: 'Loading dock — south' },
  { name: 'Delivery Van 1', type: 'equipment' as const, notes: 'Mercedes Sprinter — large cargo' },
  { name: 'Delivery Van 2', type: 'equipment' as const, notes: 'Ford Transit — medium cargo' },
  { name: 'Sorting Station', type: 'equipment' as const, notes: 'Central parcel sorting' },
];

const SERVICES = [
  { name: 'Standard Delivery', durationMinutes: 120, bufferBefore: 0, bufferAfter: 15, price: 35 },
  { name: 'Express Delivery', durationMinutes: 60, bufferBefore: 0, bufferAfter: 10, price: 65 },
  { name: 'Same-Day Pickup', durationMinutes: 90, bufferBefore: 0, bufferAfter: 15, price: 50 },
  { name: 'Bulk Shipment Loading', durationMinutes: 180, bufferBefore: 30, bufferAfter: 30, price: 150 },
  { name: 'Returns Processing', durationMinutes: 45, bufferBefore: 0, bufferAfter: 0, price: 20 },
  { name: 'Scheduled Pickup', durationMinutes: 30, bufferBefore: 0, bufferAfter: 5, price: 25 },
];

const CLIENTS = [
  { name: 'TechCorp SRL', email: 'logistics@techcorp.ro', phone: '+40 21 333 4444', notes: 'Enterprise client — priority SLA' },
  { name: 'FreshFood Distribution', email: 'orders@freshfood.ro', phone: '+40 21 555 6666', notes: 'Perishable goods — time-sensitive' },
  { name: 'MedLife Pharmacy', email: 'supply@medlife.ro', phone: '+40 21 777 8888', notes: 'Medical supplies — handle with care' },
  { name: 'AutoParts Express', email: 'warehouse@autoparts.ro', phone: '+40 21 999 0000', notes: 'Heavy items — use loading bay' },
  { name: 'BookWorld SRL', email: 'shipping@bookworld.ro', phone: '', notes: 'Regular weekly shipments' },
  { name: 'GreenGarden Nursery', email: 'orders@greengarden.ro', phone: '+40 21 111 2222', notes: 'Seasonal plants — fragile' },
  { name: 'OfficeMax Romania', email: 'logistics@officemax.ro', phone: '', notes: 'Office supplies and furniture' },
  { name: 'FashionHub SRL', email: 'warehouse@fashionhub.ro', phone: '+40 21 444 5555', notes: 'Clothing — no bulky items' },
  { name: 'HomeDepot Romania', email: 'delivery@homedepot.ro', phone: '', notes: 'Building materials — heavy' },
  { name: 'PetShop Network', email: 'supply@petshop.ro', phone: '+40 21 666 7777', notes: 'Pet food and accessories' },
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
  { clientIdx: 0, resourceIdx: 0, serviceIdx: 0, day: 0, hour: 6, minute: 0, transitions: [{ action: 'start', note: 'Dispatched' }, { action: 'complete', note: 'Delivered' }] },
  { clientIdx: 1, resourceIdx: 1, serviceIdx: 2, day: 0, hour: 7, minute: 0, transitions: [{ action: 'start', note: 'Dispatched' }, { action: 'complete', note: 'Delivered' }] },
  { clientIdx: 3, resourceIdx: 3, serviceIdx: 3, day: 0, hour: 8, minute: 0, transitions: [{ action: 'start', note: 'Dispatched' }, { action: 'complete', note: 'Delivered' }] },
  { clientIdx: 5, resourceIdx: 2, serviceIdx: 1, day: 0, hour: 10, minute: 0, transitions: [{ action: 'start', note: 'Dispatched' }, { action: 'complete', note: 'Delivered' }] },

  // Tuesday — 3 completed, 1 cancelled, 1 no-show
  { clientIdx: 2, resourceIdx: 0, serviceIdx: 0, day: 1, hour: 6, minute: 0, transitions: [{ action: 'start', note: 'Dispatched' }, { action: 'complete', note: 'Delivered' }] },
  { clientIdx: 4, resourceIdx: 5, serviceIdx: 0, day: 1, hour: 7, minute: 0, transitions: [{ action: 'start', note: 'Dispatched' }, { action: 'complete', note: 'Delivered' }] },
  { clientIdx: 6, resourceIdx: 1, serviceIdx: 2, day: 1, hour: 9, minute: 0, transitions: [{ action: 'cancel', reason: 'Client changed delivery date' }] },
  { clientIdx: 7, resourceIdx: 2, serviceIdx: 1, day: 1, hour: 11, minute: 0, transitions: [{ action: 'start', note: 'Dispatched' }, { action: 'complete', note: 'Delivered' }] },
  { clientIdx: 8, resourceIdx: 0, serviceIdx: 4, day: 1, hour: 14, minute: 0, transitions: [{ action: 'no_show', note: 'Client did not show' }] },

  // Wednesday — 3 completed, 1 confirmed
  { clientIdx: 9, resourceIdx: 6, serviceIdx: 5, day: 2, hour: 7, minute: 0, transitions: [{ action: 'start', note: 'Dispatched' }, { action: 'complete', note: 'Delivered' }] },
  { clientIdx: 0, resourceIdx: 1, serviceIdx: 0, day: 2, hour: 8, minute: 0, transitions: [{ action: 'start', note: 'Dispatched' }, { action: 'complete', note: 'Delivered' }] },
  { clientIdx: 3, resourceIdx: 4, serviceIdx: 3, day: 2, hour: 9, minute: 0, transitions: [{ action: 'start', note: 'Dispatched' }, { action: 'complete', note: 'Delivered' }] },
  { clientIdx: 1, resourceIdx: 0, serviceIdx: 2, day: 2, hour: 14, minute: 0, transitions: [] },

  // Thursday — 2 completed, 2 in_progress, 1 confirmed
  { clientIdx: 5, resourceIdx: 2, serviceIdx: 1, day: 3, hour: 6, minute: 0, transitions: [{ action: 'start', note: 'Dispatched' }, { action: 'complete', note: 'Delivered' }] },
  { clientIdx: 7, resourceIdx: 5, serviceIdx: 0, day: 3, hour: 7, minute: 0, transitions: [{ action: 'start', note: 'Dispatched' }] },
  { clientIdx: 2, resourceIdx: 1, serviceIdx: 2, day: 3, hour: 8, minute: 0, transitions: [{ action: 'start', note: 'Dispatched' }] },
  { clientIdx: 6, resourceIdx: 0, serviceIdx: 4, day: 3, hour: 10, minute: 0, transitions: [{ action: 'start', note: 'Dispatched' }] },
  { clientIdx: 4, resourceIdx: 6, serviceIdx: 5, day: 3, hour: 14, minute: 0, transitions: [] },

  // Friday — 3 completed, 2 confirmed (busy logistics day)
  { clientIdx: 8, resourceIdx: 1, serviceIdx: 0, day: 4, hour: 6, minute: 0, transitions: [{ action: 'start', note: 'Dispatched' }, { action: 'complete', note: 'Delivered' }] },
  { clientIdx: 9, resourceIdx: 5, serviceIdx: 2, day: 4, hour: 7, minute: 0, transitions: [{ action: 'start', note: 'Dispatched' }, { action: 'complete', note: 'Delivered' }] },
  { clientIdx: 0, resourceIdx: 4, serviceIdx: 3, day: 4, hour: 8, minute: 0, transitions: [{ action: 'start', note: 'Dispatched' }, { action: 'complete', note: 'Delivered' }] },
  { clientIdx: 1, resourceIdx: 0, serviceIdx: 1, day: 4, hour: 13, minute: 0, transitions: [] },
  { clientIdx: 3, resourceIdx: 6, serviceIdx: 5, day: 4, hour: 15, minute: 0, transitions: [] },
];

// ---------------------------------------------------------------------------
//  Main
// ---------------------------------------------------------------------------

async function main() {
  const config = parseConfig(argv);

  console.log(`🚛 Seeding demo data for "${SUBDOMAIN}" (Logistics Hub)…\n`);

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
  const resourceIds: string[] = [];
  for (const r of RESOURCES) {
    const id = await createResource(config, {
      name: r.name,
      type: r.type,
      notes: r.notes,
    });
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
