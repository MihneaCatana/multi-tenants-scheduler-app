import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  createServiceBody,
  updateServiceBody,
  serviceIdParam,
  requirementsBody,
} from '../modules/services-catalog/schema.js';
import {
  listServices,
  getService,
  createService,
  updateService,
  deleteService,
  replaceRequirements,
  listRequirements,
} from '../modules/services-catalog/service.js';
import { auditLog } from '../lib/audit.js';

export const servicesController = {
  async list(req: FastifyRequest, _reply: FastifyReply) {
    const category = (req.query as { category?: string }).category;
    const includeInactive =
      (req.query as { include_inactive?: string }).include_inactive === 'true';
    const rows = await listServices(req.tenantDb!, { category, includeInactive });
    return { services: rows };
  },

  async getById(req: FastifyRequest, reply: FastifyReply) {
    const { id } = serviceIdParam.parse(req.params);
    reply.send(await getService(req.tenantDb!, id));
  },

  async create(req: FastifyRequest, reply: FastifyReply) {
    const input = createServiceBody.parse(req.body);
    const created = await createService(req.tenantDb!, input);
    auditLog(req, {
      action: 'service.create',
      target: { resource: 'service', id: created.id },
      msg: 'Service created.',
    });
    reply.status(201).send(created);
  },

  async update(req: FastifyRequest, reply: FastifyReply) {
    const { id } = serviceIdParam.parse(req.params);
    const set = updateServiceBody.parse(req.body);
    const updated = await updateService(req.tenantDb!, id, set);
    auditLog(req, {
      action: 'service.update',
      target: { resource: 'service', id },
      msg: 'Service updated.',
    });
    reply.send(updated);
  },

  async remove(req: FastifyRequest, reply: FastifyReply) {
    const { id } = serviceIdParam.parse(req.params);
    await deleteService(req.tenantDb!, id);
    auditLog(req, {
      action: 'service.delete',
      target: { resource: 'service', id },
      msg: 'Service soft-deleted.',
    });
    reply.status(204).send();
  },

  async listRequirements(req: FastifyRequest, reply: FastifyReply) {
    const { id } = serviceIdParam.parse(req.params);
    const rows = await listRequirements(req.tenantDb!, id);
    reply.send({ requirements: rows });
  },

  async replaceRequirements(req: FastifyRequest, reply: FastifyReply) {
    const { id } = serviceIdParam.parse(req.params);
    const reqs = requirementsBody.parse(req.body);
    const rows = await replaceRequirements(req.tenantDb!, id, reqs);
    auditLog(req, {
      action: 'service.requirements_replace',
      target: { resource: 'service', id },
      msg: 'Service requirements replaced.',
      extra: { count: rows.length },
    });
    reply.send({ requirements: rows });
  },
};
