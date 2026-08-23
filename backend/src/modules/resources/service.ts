import { eq, and, isNull, inArray } from 'drizzle-orm';
import type { TenantDb } from '../../db/tenant-pool.js';
import { resources, type ResourceType } from '../../db/schema/tenant/resources.js';
import { appointmentResources } from '../../db/schema/tenant/appointment-resources.js';
import { appointments, ACTIVE_STATUSES } from '../../db/schema/tenant/appointments.js';
import { staff } from '../../db/schema/tenant/staff.js';
import {
  resourceNotFound,
  resourceHasActiveBookings,
  invalidBooking,
} from '../../lib/errors.js';

export async function listResources(
  db: TenantDb,
  opts: { type?: string; includeInactive?: boolean },
) {
  const conditions = [isNull(resources.deletedAt)];
  if (opts.type) conditions.push(eq(resources.type, opts.type as ResourceType));
  if (!opts.includeInactive) conditions.push(eq(resources.isActive, true));
  return await db.select().from(resources).where(and(...conditions)).orderBy(resources.name);
}

export async function getResource(db: TenantDb, id: string) {
  const [row] = await db
    .select()
    .from(resources)
    .where(and(eq(resources.id, id), isNull(resources.deletedAt)))
    .limit(1);
  if (!row) throw resourceNotFound();
  return row;
}

export async function createResource(
  db: TenantDb,
  input: {
    name: string;
    type: string;
    linkedStaffId?: string;
    color?: string;
    notes?: string;
  },
) {
  // type='provider' requires a valid linkedStaffId; other types forbid it
  if (input.type === 'provider') {
    if (!input.linkedStaffId) throw invalidBooking('A provider resource requires linkedStaffId.');
    const [s] = await db
      .select()
      .from(staff)
      .where(and(eq(staff.id, input.linkedStaffId), eq(staff.active, true), isNull(staff.deletedAt)))
      .limit(1);
    if (!s) throw invalidBooking('linkedStaffId does not reference an active staff member.');
  } else if (input.linkedStaffId) {
    throw invalidBooking('Only provider resources may have a linkedStaffId.');
  }
  const [created] = await db
    .insert(resources)
    .values({
      name: input.name,
      type: input.type as ResourceType,
      linkedStaffId: input.linkedStaffId,
      color: input.color,
      notes: input.notes,
    })
    .returning();
  return created!;
}

export async function updateResource(
  db: TenantDb,
  id: string,
  set: Partial<{ name: string; isActive: boolean; color: string; notes: string }>,
) {
  const [updated] = await db
    .update(resources)
    .set({ ...set, updatedAt: new Date() })
    .where(and(eq(resources.id, id), isNull(resources.deletedAt)))
    .returning();
  if (!updated) throw resourceNotFound();
  return updated;
}

export async function deleteResource(db: TenantDb, id: string) {
  // Guard: reject if any non-terminal appointment references this resource
  const activeBookings = await db
    .select({ id: appointmentResources.id })
    .from(appointmentResources)
    .innerJoin(appointments, eq(appointmentResources.appointmentId, appointments.id))
    .where(
      and(
        eq(appointmentResources.resourceId, id),
        isNull(appointmentResources.deletedAt),
        inArray(appointments.status, ACTIVE_STATUSES),
      ),
    );
  if (activeBookings.length > 0) throw resourceHasActiveBookings(activeBookings.length);

  const [softDeleted] = await db
    .update(resources)
    .set({ deletedAt: new Date(), updatedAt: new Date(), isActive: false })
    .where(and(eq(resources.id, id), isNull(resources.deletedAt)))
    .returning({ id: resources.id });
  if (!softDeleted) throw resourceNotFound();
}
