import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { and, eq, isNull } from 'drizzle-orm';
import { clients } from '../db/schema/tenant/clients.js';
import { clientNotFound } from '../lib/errors.js';
import { auditLog } from '../lib/audit.js';

/**
 * Clients CRUD — the tenant's CUSTOMERS (contacts/CRM records) over the tenant's
 * OWN `clients` table. Every handler uses `req.tenantDb`, so it can ONLY ever
 * touch the calling tenant's rows; cross-tenant access is not possible.
 *
 * Clients are physically separate from `staff` (login identities): a client has
 * no password and no role and CANNOT log in. `name` is split into first/last on
 * create to match the `clients` columns; on read we recombine so the response
 * keeps the legacy `{ name }` shape.
 */

const createClientBody = z.object({
  name: z.string().min(1).max(160),
  email: z.string().email().max(254).optional(),
  phone: z.string().max(40).optional(),
  notes: z.string().max(5000).optional(),
});

const updateClientBody = createClientBody.partial();

const clientIdParam = z.object({ id: z.string().uuid() });

/** Combine first/last into a single name for the legacy response shape. */
function fullName(firstName: string | null, lastName: string | null): string {
  return [firstName, lastName].filter(Boolean).join(' ') || '';
}

function toClientRow(c: typeof clients.$inferSelect) {
  return {
    id: c.id,
    name: fullName(c.firstName, c.lastName),
    email: c.email,
    phone: c.phone,
    notes: c.notes,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

function splitName(name: string): { firstName: string; lastName: string } {
  const parts = name.trim().split(/\s+/);
  return {
    firstName: parts[0] ?? '',
    lastName: parts.slice(1).join(' '),
  };
}

export const clientsController = {
  async list(req: FastifyRequest, _reply: FastifyReply) {
    const rows = await req.tenantDb!
      .select().from(clients)
      .where(isNull(clients.deletedAt))
      .orderBy(clients.createdAt);
    return { clients: rows.map(toClientRow) };
  },

  async getById(req: FastifyRequest, reply: FastifyReply) {
    const { id } = clientIdParam.parse(req.params);
    const [row] = await req.tenantDb!.select().from(clients)
      .where(and(eq(clients.id, id), isNull(clients.deletedAt)))
      .limit(1);
    if (!row) throw clientNotFound();
    reply.send(toClientRow(row));
  },

  async create(req: FastifyRequest, reply: FastifyReply) {
    const input = createClientBody.parse(req.body);
    const { firstName, lastName } = splitName(input.name);
    const [created] = await req.tenantDb!
      .insert(clients)
      .values({
        firstName,
        lastName,
        email: input.email ?? input.name, // email is NOT NULL on clients; fall back to name.
        phone: input.phone,
        notes: input.notes,
      })
      .returning();
    auditLog(req, {
      action: 'client.create',
      target: { resource: 'client', id: created!.id },
      msg: 'Client created.',
    });
    reply.status(201).send(toClientRow(created!));
  },

  async update(req: FastifyRequest, reply: FastifyReply) {
    const { id } = clientIdParam.parse(req.params);
    const input = updateClientBody.parse(req.body);
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (input.name !== undefined) {
      const { firstName, lastName } = splitName(input.name);
      set.firstName = firstName;
      set.lastName = lastName;
    }
    if (input.email !== undefined) set.email = input.email;
    if (input.phone !== undefined) set.phone = input.phone;
    if (input.notes !== undefined) set.notes = input.notes;

    const [updated] = await req.tenantDb!
      .update(clients)
      .set(set)
      .where(and(eq(clients.id, id), isNull(clients.deletedAt)))
      .returning();
    if (!updated) throw clientNotFound();
    auditLog(req, {
      action: 'client.update',
      target: { resource: 'client', id },
      msg: 'Client updated.',
    });
    reply.send(toClientRow(updated));
  },

  async remove(req: FastifyRequest, reply: FastifyReply) {
    const { id } = clientIdParam.parse(req.params);
    const [softDeleted] = await req.tenantDb!
      .update(clients)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(clients.id, id), isNull(clients.deletedAt)))
      .returning({ id: clients.id });
    if (!softDeleted) throw clientNotFound();
    auditLog(req, {
      action: 'client.delete',
      target: { resource: 'client', id },
      msg: 'Client soft-deleted.',
    });
    reply.status(204).send();
  },
};
