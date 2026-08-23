import type { FastifyReply, FastifyRequest } from 'fastify';
import { eq, and, isNull } from 'drizzle-orm';
import { appointments } from '../db/schema/tenant/appointments.js';
import { appointmentResources } from '../db/schema/tenant/appointment-resources.js';
import { appointmentServices } from '../db/schema/tenant/appointment-services.js';
import { appointmentStatusHistory } from '../db/schema/tenant/appointment-status-history.js';
import { appointmentNotFound } from '../lib/errors.js';
import { auditLog } from '../lib/audit.js';
import {
  createAppointmentBody,
  patchAppointmentBody,
  appointmentIdParam,
} from '../modules/scheduling/schema.js';
import {
  createAppointment,
  rescheduleAppointment,
  transitionStatus,
  listAppointments,
} from '../modules/scheduling/service.js';

export const appointmentsController = {
  async list(req: FastifyRequest, _reply: FastifyReply) {
    const q = req.query as Record<string, string | undefined>;
    const limit = q.limit ? Number(q.limit) : undefined;
    const offset = q.offset ? Number(q.offset) : undefined;
    const { appointments, total } = await listAppointments(req.tenantDb!, {
      from: q.from,
      to: q.to,
      resourceId: q.resourceId,
      clientId: q.clientId,
      status: q.status,
      limit,
      offset,
    });
    return { appointments, total };
  },

  async getById(req: FastifyRequest, reply: FastifyReply) {
    const { id } = appointmentIdParam.parse(req.params);
    const [row] = await req
      .tenantDb!.select()
      .from(appointments)
      .where(and(eq(appointments.id, id), isNull(appointments.deletedAt)))
      .limit(1);
    if (!row) throw appointmentNotFound();
    const resourcesRows = await req
      .tenantDb!.select()
      .from(appointmentResources)
      .where(
        and(eq(appointmentResources.appointmentId, id), isNull(appointmentResources.deletedAt)),
      );
    const svcRows = await req
      .tenantDb!.select({
        serviceId: appointmentServices.serviceId,
      })
      .from(appointmentServices)
      .where(eq(appointmentServices.appointmentId, id))
      .orderBy(appointmentServices.sortIndex);
    const serviceIds = svcRows.map((r) => r.serviceId);
    reply.send({ ...row, resources: resourcesRows, serviceIds });
  },

  async create(req: FastifyRequest, reply: FastifyReply) {
    const input = createAppointmentBody.parse(req.body);
    const actorStaffId = req.userClaims!.sub;
    const { id } = await createAppointment(req.tenantDb!, input, actorStaffId);
    auditLog(req, {
      action: 'appointment.create',
      target: { resource: 'appointment', id },
      msg: 'Appointment created.',
    });
    reply.status(201).send({ id });
  },

  async patch(req: FastifyRequest, reply: FastifyReply) {
    const { id } = appointmentIdParam.parse(req.params);
    const input = patchAppointmentBody.parse(req.body);
    const actorStaffId = req.userClaims!.sub;

    if (input.action === 'reschedule') {
      await rescheduleAppointment(req.tenantDb!, id, input.startAt, actorStaffId, input.durationMinutes);
      auditLog(req, {
        action: 'appointment.reschedule',
        target: { resource: 'appointment', id },
        msg: 'Appointment rescheduled.',
      });
    } else {
      const opts =
        input.action === 'cancel'
          ? { reason: input.reason }
          : { note: input.note };
      await transitionStatus(req.tenantDb!, id, input.action, actorStaffId, opts);
      auditLog(req, {
        action: `appointment.${input.action}`,
        target: { resource: 'appointment', id },
        msg: `Appointment ${input.action}.`,
      });
    }
    reply.status(204).send();
  },

  async history(req: FastifyRequest, reply: FastifyReply) {
    const { id } = appointmentIdParam.parse(req.params);
    const rows = await req
      .tenantDb!.select()
      .from(appointmentStatusHistory)
      .where(eq(appointmentStatusHistory.appointmentId, id))
      .orderBy(appointmentStatusHistory.createdAt);
    reply.send({ history: rows });
  },
};
