import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  createResourceBody,
  updateResourceBody,
  resourceIdParam,
} from '../modules/resources/schema.js';
import {
  listResources,
  getResource,
  createResource,
  updateResource,
  deleteResource,
} from '../modules/resources/service.js';
import { auditLog } from '../lib/audit.js';

export const resourcesController = {
  async list(req: FastifyRequest, _reply: FastifyReply) {
    const type = (req.query as { type?: string }).type;
    const includeInactive =
      (req.query as { include_inactive?: string }).include_inactive === 'true';
    const rows = await listResources(req.tenantDb!, { type, includeInactive });
    return { resources: rows };
  },

  async getById(req: FastifyRequest, reply: FastifyReply) {
    const { id } = resourceIdParam.parse(req.params);
    const row = await getResource(req.tenantDb!, id);
    reply.send(row);
  },

  async create(req: FastifyRequest, reply: FastifyReply) {
    const input = createResourceBody.parse(req.body);
    const created = await createResource(req.tenantDb!, input);
    auditLog(req, {
      action: 'resource.create',
      target: { resource: 'resource', id: created.id },
      msg: 'Resource created.',
    });
    reply.status(201).send(created);
  },

  async update(req: FastifyRequest, reply: FastifyReply) {
    const { id } = resourceIdParam.parse(req.params);
    const set = updateResourceBody.parse(req.body);
    const updated = await updateResource(req.tenantDb!, id, set);
    auditLog(req, {
      action: 'resource.update',
      target: { resource: 'resource', id },
      msg: 'Resource updated.',
    });
    reply.send(updated);
  },

  async remove(req: FastifyRequest, reply: FastifyReply) {
    const { id } = resourceIdParam.parse(req.params);
    await deleteResource(req.tenantDb!, id);
    auditLog(req, {
      action: 'resource.delete',
      target: { resource: 'resource', id },
      msg: 'Resource soft-deleted.',
    });
    reply.status(204).send();
  },
};
