import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  createWorkingHourBody,
  updateWorkingHourBody,
  createTimeOffBody,
  resourceIdParam,
  workingHourIdParam,
  timeOffIdParam,
  timezoneBody,
} from '../modules/availability/schema.js';
import {
  listWorkingHours,
  createWorkingHour,
  updateWorkingHour,
  deleteWorkingHour,
  listTimeOff,
  createTimeOff,
  deleteTimeOff,
} from '../modules/availability/service.js';
import { getTenantTimezone, setTenantTimezone } from '../modules/availability/timezone.js';
import { auditLog } from '../lib/audit.js';

export const availabilityController = {
  // Working hours
  async listWorkingHours(req: FastifyRequest, reply: FastifyReply) {
    const { id } = resourceIdParam.parse(req.params);
    const rows = await listWorkingHours(req.tenantDb!, id);
    reply.send({ workingHours: rows });
  },
  async createWorkingHour(req: FastifyRequest, reply: FastifyReply) {
    const { id } = resourceIdParam.parse(req.params);
    const input = createWorkingHourBody.parse(req.body);
    const created = await createWorkingHour(req.tenantDb!, id, input);
    auditLog(req, {
      action: 'working_hours.create',
      target: { resource: 'resource', id },
      msg: 'Working hours block added.',
    });
    reply.status(201).send(created);
  },
  async updateWorkingHour(req: FastifyRequest, reply: FastifyReply) {
    const { id } = workingHourIdParam.parse(req.params);
    const set = updateWorkingHourBody.parse(req.body);
    reply.send(await updateWorkingHour(req.tenantDb!, id, set));
  },
  async deleteWorkingHour(req: FastifyRequest, reply: FastifyReply) {
    const { id } = workingHourIdParam.parse(req.params);
    await deleteWorkingHour(req.tenantDb!, id);
    auditLog(req, {
      action: 'working_hours.delete',
      target: { resource: 'working_hours', id },
      msg: 'Working hours block removed.',
    });
    reply.status(204).send();
  },

  // Time off
  async listTimeOff(req: FastifyRequest, reply: FastifyReply) {
    const { id } = resourceIdParam.parse(req.params);
    const rows = await listTimeOff(req.tenantDb!, id);
    reply.send({ timeOff: rows });
  },
  async createTimeOff(req: FastifyRequest, reply: FastifyReply) {
    const { id } = resourceIdParam.parse(req.params);
    const input = createTimeOffBody.parse(req.body);
    const created = await createTimeOff(req.tenantDb!, id, input);
    auditLog(req, {
      action: 'time_off.create',
      target: { resource: 'resource', id },
      msg: 'Time off added.',
    });
    reply.status(201).send(created);
  },
  async deleteTimeOff(req: FastifyRequest, reply: FastifyReply) {
    const { id } = timeOffIdParam.parse(req.params);
    await deleteTimeOff(req.tenantDb!, id);
    auditLog(req, {
      action: 'time_off.delete',
      target: { resource: 'time_off', id },
      msg: 'Time off removed.',
    });
    reply.status(204).send();
  },

  // Tenant timezone
  async getTimezone(req: FastifyRequest, reply: FastifyReply) {
    const tz = await getTenantTimezone(req.tenantDb!);
    reply.send({ timezone: tz });
  },
  async setTimezone(req: FastifyRequest, reply: FastifyReply) {
    const { timezone } = timezoneBody.parse(req.body);
    await setTenantTimezone(req.tenantDb!, timezone);
    auditLog(req, {
      action: 'tenant_settings.timezone_set',
      msg: 'Tenant timezone updated.',
      extra: { timezone },
    });
    reply.send({ timezone });
  },
};
