import { eq, and, isNull } from 'drizzle-orm';
import type { TenantDb } from '../../db/tenant-pool.js';
import { workingHours } from '../../db/schema/tenant/working-hours.js';
import { timeOff } from '../../db/schema/tenant/time-off.js';
import { scheduleEntryNotFound } from '../../lib/errors.js';

// --- Working hours ---

export async function listWorkingHours(db: TenantDb, resourceId: string) {
  return await db
    .select()
    .from(workingHours)
    .where(and(eq(workingHours.resourceId, resourceId), isNull(workingHours.deletedAt)))
    .orderBy(workingHours.dayOfWeek, workingHours.startTime);
}

export async function createWorkingHour(db: TenantDb, resourceId: string, input: Record<string, unknown>) {
  const [created] = await db
    .insert(workingHours)
    .values({
      resourceId,
      dayOfWeek: input.dayOfWeek as number,
      startTime: input.startTime as string,
      endTime: input.endTime as string,
      validFrom: input.validFrom as string,
      validTo: input.validTo as string | undefined,
    })
    .returning();
  return created!;
}

export async function updateWorkingHour(db: TenantDb, id: string, set: Record<string, unknown>) {
  const [updated] = await db
    .update(workingHours)
    .set({ ...set, updatedAt: new Date() })
    .where(and(eq(workingHours.id, id), isNull(workingHours.deletedAt)))
    .returning();
  if (!updated) throw scheduleEntryNotFound();
  return updated;
}

export async function deleteWorkingHour(db: TenantDb, id: string) {
  const [row] = await db
    .update(workingHours)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(workingHours.id, id), isNull(workingHours.deletedAt)))
    .returning({ id: workingHours.id });
  if (!row) throw scheduleEntryNotFound();
}

// --- Time off ---

export async function listTimeOff(db: TenantDb, resourceId: string) {
  return await db
    .select()
    .from(timeOff)
    .where(and(eq(timeOff.resourceId, resourceId), isNull(timeOff.deletedAt)))
    .orderBy(timeOff.startAt);
}

export async function createTimeOff(db: TenantDb, resourceId: string, input: Record<string, unknown>) {
  const [created] = await db
    .insert(timeOff)
    .values({
      resourceId,
      startAt: new Date(input.startAt as string),
      endAt: new Date(input.endAt as string),
      reason: input.reason as string | undefined,
    })
    .returning();
  return created!;
}

export async function deleteTimeOff(db: TenantDb, id: string) {
  const [row] = await db
    .update(timeOff)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(timeOff.id, id), isNull(timeOff.deletedAt)))
    .returning({ id: timeOff.id });
  if (!row) throw scheduleEntryNotFound();
}
