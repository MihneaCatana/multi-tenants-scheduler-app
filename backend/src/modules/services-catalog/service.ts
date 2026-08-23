import { eq, and, isNull } from 'drizzle-orm';
import type { TenantDb } from '../../db/tenant-pool.js';
import { services } from '../../db/schema/tenant/services.js';
import { serviceResourceRequirements } from '../../db/schema/tenant/service-resource-requirements.js';
import { appointmentServices } from '../../db/schema/tenant/appointment-services.js';
import type { ResourceType } from '../../db/schema/tenant/resources.js';
import { serviceNotFound, serviceHasFutureAppointments } from '../../lib/errors.js';

export async function listServices(
  db: TenantDb,
  opts: { category?: string; includeInactive?: boolean },
) {
  const conditions = [isNull(services.deletedAt)];
  if (opts.category) conditions.push(eq(services.category, opts.category));
  if (!opts.includeInactive) conditions.push(eq(services.isActive, true));
  return await db.select().from(services).where(and(...conditions)).orderBy(services.name);
}

export async function getService(db: TenantDb, id: string) {
  const [row] = await db
    .select()
    .from(services)
    .where(and(eq(services.id, id), isNull(services.deletedAt)))
    .limit(1);
  if (!row) throw serviceNotFound();
  return row;
}

export async function createService(
  db: TenantDb,
  input: {
    name: string;
    description?: string;
    category?: string;
    durationMinutes: number;
    bufferBeforeMinutes?: number;
    bufferAfterMinutes?: number;
    price?: number;
  },
) {
  const [created] = await db
    .insert(services)
    .values({
      name: input.name,
      description: input.description,
      category: input.category,
      durationMinutes: input.durationMinutes,
      bufferBeforeMinutes: input.bufferBeforeMinutes ?? 0,
      bufferAfterMinutes: input.bufferAfterMinutes ?? 0,
      price: input.price != null ? String(input.price) : null,
    })
    .returning();
  return created!;
}

export async function updateService(db: TenantDb, id: string, set: Record<string, unknown>) {
  const [updated] = await db
    .update(services)
    .set({ ...set, updatedAt: new Date() })
    .where(and(eq(services.id, id), isNull(services.deletedAt)))
    .returning();
  if (!updated) throw serviceNotFound();
  return updated;
}

export async function deleteService(db: TenantDb, id: string) {
  // Guard: reject if referenced by any appointment via junction table
  const refs = await db
    .select({ appointmentId: appointmentServices.appointmentId })
    .from(appointmentServices)
    .where(eq(appointmentServices.serviceId, id));
  if (refs.length > 0) throw serviceHasFutureAppointments(refs.length);

  await db
    .update(services)
    .set({ deletedAt: new Date(), updatedAt: new Date(), isActive: false })
    .where(and(eq(services.id, id), isNull(services.deletedAt)));
}

/** Full-replace the resource requirements for a service. */
export async function replaceRequirements(
  db: TenantDb,
  serviceId: string,
  reqs: Array<{ resourceType: ResourceType; quantity: number; isRequired: boolean }>,
) {
  await getService(db, serviceId); // throws if not found
  await db
    .delete(serviceResourceRequirements)
    .where(eq(serviceResourceRequirements.serviceId, serviceId));
  if (reqs.length > 0) {
    await db.insert(serviceResourceRequirements).values(
      reqs.map((r) => ({
        serviceId,
        resourceType: r.resourceType,
        quantity: r.quantity,
        isRequired: r.isRequired,
      })),
    );
  }
  return await db
    .select()
    .from(serviceResourceRequirements)
    .where(eq(serviceResourceRequirements.serviceId, serviceId));
}

export async function listRequirements(db: TenantDb, serviceId: string) {
  await getService(db, serviceId);
  return await db
    .select()
    .from(serviceResourceRequirements)
    .where(eq(serviceResourceRequirements.serviceId, serviceId));
}
