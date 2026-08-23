import { eq, and, isNull, sql, inArray } from 'drizzle-orm';
import type { TenantDb } from '../../db/tenant-pool.js';
import {
  appointments,
  type AppointmentStatus,
} from '../../db/schema/tenant/appointments.js';
import { appointmentResources } from '../../db/schema/tenant/appointment-resources.js';
import { appointmentStatusHistory } from '../../db/schema/tenant/appointment-status-history.js';
import { appointmentServices } from '../../db/schema/tenant/appointment-services.js';
import { resources } from '../../db/schema/tenant/resources.js';
import { services } from '../../db/schema/tenant/services.js';
import { clients } from '../../db/schema/tenant/clients.js';
import { rangeLiteral } from '../../db/schema/tenant/tstzrange.js';
import {
  resourceNotFound,
  serviceNotFound,
  appointmentConflict,
  invalidBooking,
  appointmentNotFound,
  clientNotFound,
} from '../../lib/errors.js';
import type { CreateAppointmentInput } from './schema.js';
import { assertCanTransition, type AppointmentAction } from './state-machine.js';

/**
 * A resource the appointment will reserve, with the window it occupies
 * (including service buffers).
 */
interface BookedResource {
  resourceId: string;
  role: string;
  rangeStart: Date;
  rangeEnd: Date;
}

interface ConflictDetail {
  resourceId: string;
  resourceName: string;
  resourceType: string;
  conflictAppointmentId: string;
  conflictStart: Date;
  conflictEnd: Date;
}

/**
 * Find appointments that conflict with any of the given (resourceId, window)
 * pairs — i.e. overlapping active appointment_resources rows. Returns the
 * conflict details for a 409 APPOINTMENT_CONFLICT response, or null if clean.
 */
export async function findConflicts(
  db: TenantDb,
  booked: BookedResource[],
): Promise<ConflictDetail[] | null> {
  const conflicts: ConflictDetail[] = [];
  for (const b of booked) {
    // Overlap query: same resource, deleted_at IS NULL, booked_range && [start,end)
    const overlapping = await db
      .select({
        appointmentId: appointmentResources.appointmentId,
        resourceId: appointmentResources.resourceId,
        resourceName: resources.name,
        resourceType: resources.type,
        apptStart: appointments.startAt,
        apptEnd: appointments.endAt,
      })
      .from(appointmentResources)
      .innerJoin(resources, eq(appointmentResources.resourceId, resources.id))
      .innerJoin(appointments, eq(appointmentResources.appointmentId, appointments.id))
      .where(
        and(
          eq(appointmentResources.resourceId, b.resourceId),
          isNull(appointmentResources.deletedAt),
          sql`${appointmentResources.bookedRange} && tstzrange(${b.rangeStart}, ${b.rangeEnd}, '[)')`,
        ),
      );
    for (const row of overlapping) {
      conflicts.push({
        resourceId: row.resourceId,
        resourceName: row.resourceName,
        resourceType: row.resourceType,
        conflictAppointmentId: row.appointmentId,
        conflictStart: row.apptStart,
        conflictEnd: row.apptEnd,
      });
    }
  }
  return conflicts.length > 0 ? conflicts : null;
}

/**
 * Create an appointment in `confirmed` status. Resolves the service (if any) for
 * duration + buffers, validates the resources, friendly-conflict-checks, then
 * inserts — the GiST constraint is the race-proof backstop. One transaction.
 */
export async function createAppointment(
  db: TenantDb,
  input: CreateAppointmentInput,
  actorStaffId: string,
): Promise<{ id: string }> {
  return await db.transaction(async (tx) => {
    // 1. Resolve services → total duration + buffers
    let durationMinutes: number;
    let bufferBefore = 0;
    let bufferAfter = 0;

    if (input.serviceIds.length > 0) {
      // Validate all services exist
      const svcRows = await tx
        .select()
        .from(services)
        .where(
          and(
            inArray(services.id, input.serviceIds),
            isNull(services.deletedAt),
          ),
        );
      if (svcRows.length !== input.serviceIds.length) throw serviceNotFound();

      // Sum durations; buffers from first (bufferBefore) and last (bufferAfter) service
      durationMinutes = input.durationMinutes ?? svcRows.reduce((sum, s) => sum + s.durationMinutes, 0);
      bufferBefore = svcRows[0]?.bufferBeforeMinutes ?? 0;
      bufferAfter = svcRows[svcRows.length - 1]?.bufferAfterMinutes ?? 0;
    } else {
      durationMinutes = input.durationMinutes!;
    }

    // 2. Resolve the requested resource set
    const resourceIds = new Set<string>([input.resourceId]);
    if (input.additionalResourceIds) {
      for (const rid of input.additionalResourceIds) resourceIds.add(rid);
    }

    // 3. Validate each resource: exists, active, not soft-deleted
    const resourceRows = await tx
      .select()
      .from(resources)
      .where(and(inArray(resources.id, [...resourceIds]), isNull(resources.deletedAt)));
    if (resourceRows.length !== resourceIds.size) throw resourceNotFound();
    for (const r of resourceRows) {
      if (!r.isActive) throw invalidBooking(`Resource '${r.name}' is inactive.`);
    }

    // 4. Validate client if provided
    if (input.clientId) {
      const [c] = await tx
        .select()
        .from(clients)
        .where(and(eq(clients.id, input.clientId), isNull(clients.deletedAt)))
        .limit(1);
      if (!c) throw clientNotFound();
    }

    // 5. Compute end_at + per-resource booked window
    const startAt = new Date(input.startAt);
    const endAt = new Date(startAt.getTime() + durationMinutes * 60_000);

    const booked: BookedResource[] = [...resourceIds].map((rid) => ({
      resourceId: rid,
      role: rid === input.resourceId ? 'primary' : 'additional',
      rangeStart: new Date(startAt.getTime() - bufferBefore * 60_000),
      rangeEnd: new Date(endAt.getTime() + bufferAfter * 60_000),
    }));

    // 6. Friendly pre-check: name the conflicting resource(s) for a good error
    const conflicts = await findConflicts(tx, booked);
    if (conflicts) throw appointmentConflict({ conflicting_resources: conflicts });

    // 7. INSERT appointment
    const [appt] = await tx
      .insert(appointments)
      .values({
        clientId: input.clientId,
        primaryResourceId: input.resourceId,
        startAt,
        endAt,
        status: 'confirmed',
        summary: input.summary,
        notes: input.notes,
        createdByStaffId: actorStaffId,
      })
      .returning();

    // 8. INSERT appointment_resources (GiST constraint rejects overlaps here)
    await tx.insert(appointmentResources).values(
      booked.map((b) => ({
        appointmentId: appt!.id,
        resourceId: b.resourceId,
        bookedRange: rangeLiteral(b.rangeStart, b.rangeEnd),
        role: b.role,
      })),
    );

    // 9. INSERT appointment_services junction rows
    if (input.serviceIds.length > 0) {
      await tx.insert(appointmentServices).values(
        input.serviceIds.map((serviceId, idx) => ({
          appointmentId: appt!.id,
          serviceId,
          sortIndex: idx,
        })),
      );
    }

    // 10. INSERT initial status history
    await tx.insert(appointmentStatusHistory).values({
      appointmentId: appt!.id,
      fromStatus: null,
      toStatus: 'confirmed',
      changedByStaffId: actorStaffId,
    });

    return { id: appt!.id };
  });
}

/**
 * Reschedule: move an appointment to a new start time. Same service, recomputed
 * window. Within one transaction: soft-delete old appointment_resources FIRST
 * (avoids self-conflict), pre-check, insert new rows, update header, log history.
 */
export async function rescheduleAppointment(
  db: TenantDb,
  id: string,
  newStartAt: string,
  actorStaffId: string,
  overrideDurationMinutes?: number,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [appt] = await tx
      .select()
      .from(appointments)
      .where(and(eq(appointments.id, id), isNull(appointments.deletedAt)))
      .limit(1);
    if (!appt) throw appointmentNotFound();

    assertCanTransition(appt.status, 'reschedule');

    // Recompute window from junction table services (or manual duration if no services)
    let durationMinutes = 60;
    let bufferBefore = 0;
    let bufferAfter = 0;

    const apptServices = await tx
      .select()
      .from(appointmentServices)
      .where(eq(appointmentServices.appointmentId, id))
      .orderBy(appointmentServices.sortIndex);

    if (apptServices.length > 0) {
      const svcIds = apptServices.map((as) => as.serviceId);
      const svcRows = await tx
        .select()
        .from(services)
        .where(inArray(services.id, svcIds));
      if (svcRows.length > 0) {
        durationMinutes = overrideDurationMinutes ?? svcRows.reduce((sum, s) => sum + s.durationMinutes, 0);
        bufferBefore = svcRows[0]?.bufferBeforeMinutes ?? 0;
        bufferAfter = svcRows[svcRows.length - 1]?.bufferAfterMinutes ?? 0;
      }
    } else if (overrideDurationMinutes) {
      durationMinutes = overrideDurationMinutes;
    } else {
      // Fallback: derive from existing start/end
      durationMinutes = Math.round((appt.endAt.getTime() - appt.startAt.getTime()) / 60_000);
    }

    const startAt = new Date(newStartAt);
    const endAt = new Date(startAt.getTime() + durationMinutes * 60_000);

    // Load existing resource assignments so we re-book the same set
    const existing = await tx
      .select()
      .from(appointmentResources)
      .where(
        and(
          eq(appointmentResources.appointmentId, id),
          isNull(appointmentResources.deletedAt),
        ),
      );

    const booked: BookedResource[] = existing.map((e) => ({
      resourceId: e.resourceId,
      role: e.role,
      rangeStart: new Date(startAt.getTime() - bufferBefore * 60_000),
      rangeEnd: new Date(endAt.getTime() + bufferAfter * 60_000),
    }));

    // Soft-delete old rows FIRST so they don't conflict with the new ones
    await tx
      .update(appointmentResources)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(appointmentResources.appointmentId, id),
          isNull(appointmentResources.deletedAt),
        ),
      );

    // Friendly pre-check on the new window
    const conflicts = await findConflicts(tx, booked);
    if (conflicts) throw appointmentConflict({ conflicting_resources: conflicts });

    // Insert new rows
    await tx.insert(appointmentResources).values(
      booked.map((b) => ({
        appointmentId: id,
        resourceId: b.resourceId,
        bookedRange: rangeLiteral(b.rangeStart, b.rangeEnd),
        role: b.role,
      })),
    );

    // Update header
    await tx
      .update(appointments)
      .set({ startAt, endAt, updatedAt: new Date() })
      .where(eq(appointments.id, id));

    // History: reschedule keeps the same status; log the time change
    await tx.insert(appointmentStatusHistory).values({
      appointmentId: id,
      fromStatus: appt.status,
      toStatus: appt.status,
      changedByStaffId: actorStaffId,
      note: `Rescheduled to ${startAt.toISOString()}`,
    });
  });
}

/**
 * Transition an appointment's status per the state machine. For cancel/no_show,
 * soft-delete the appointment_resources rows so the slot frees up under the
 * partial GiST constraint. One transaction.
 */
export async function transitionStatus(
  db: TenantDb,
  id: string,
  action: AppointmentAction,
  actorStaffId: string,
  options: { note?: string; reason?: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [appt] = await tx
      .select()
      .from(appointments)
      .where(and(eq(appointments.id, id), isNull(appointments.deletedAt)))
      .limit(1);
    if (!appt) throw appointmentNotFound();

    const toStatus = assertCanTransition(appt.status, action) as AppointmentStatus;

    // Cancel/no_show free the slot: soft-delete the resource rows
    if (action === 'cancel' || action === 'no_show') {
      await tx
        .update(appointmentResources)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(appointmentResources.appointmentId, id),
            isNull(appointmentResources.deletedAt),
          ),
        );
    }

    await tx
      .update(appointments)
      .set({
        status: toStatus,
        cancellationReason: action === 'cancel' ? (options.reason ?? null) : undefined,
        updatedAt: new Date(),
      })
      .where(eq(appointments.id, id));

    await tx.insert(appointmentStatusHistory).values({
      appointmentId: id,
      fromStatus: appt.status,
      toStatus,
      changedByStaffId: actorStaffId,
      note: options.note,
    });
  });
}

/**
 * List appointments with filters. Read-only; uses the appointment header times
 * for display (not the range column). Supports pagination via limit/offset.
 */
export async function listAppointments(
  db: TenantDb,
  filters: {
    from?: string;
    to?: string;
    resourceId?: string;
    clientId?: string;
    status?: string;
    limit?: number;
    offset?: number;
  },
): Promise<{ appointments: typeof appointments.$inferSelect[]; total: number }> {
  const conditions = [isNull(appointments.deletedAt)];
  if (filters.from) conditions.push(sql`${appointments.startAt} >= ${new Date(filters.from)}`);
  if (filters.to) conditions.push(sql`${appointments.startAt} < ${new Date(filters.to)}`);
  if (filters.resourceId) conditions.push(eq(appointments.primaryResourceId, filters.resourceId));
  if (filters.clientId) conditions.push(eq(appointments.clientId, filters.clientId));
  if (filters.status) conditions.push(eq(appointments.status, filters.status as AppointmentStatus));

  const whereClause = and(...conditions);

  const limit = Math.min(Math.max(filters.limit ?? 25, 1), 500);
  const offset = Math.max(filters.offset ?? 0, 0);

  const [countResult, rows] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)` })
      .from(appointments)
      .where(whereClause),
    db
      .select()
      .from(appointments)
      .where(whereClause)
      .orderBy(appointments.startAt)
      .limit(limit)
      .offset(offset),
  ]);

  // Fetch serviceIds for the returned appointments
  const apptIds = rows.map((r) => r.id);
  let serviceIdMap: Record<string, string[]> = {};
  if (apptIds.length > 0) {
    const svcRows = await db
      .select({
        appointmentId: appointmentServices.appointmentId,
        serviceId: appointmentServices.serviceId,
      })
      .from(appointmentServices)
      .where(inArray(appointmentServices.appointmentId, apptIds))
      .orderBy(appointmentServices.sortIndex);
    for (const row of svcRows) {
      const aid = row.appointmentId!;
      if (!serviceIdMap[aid]) serviceIdMap[aid] = [];
      serviceIdMap[aid].push(row.serviceId);
    }
  }

  return { appointments: rows.map((r) => ({ ...r, serviceIds: serviceIdMap[r.id] ?? [] })), total: Number(countResult[0]?.count ?? 0) };
}
