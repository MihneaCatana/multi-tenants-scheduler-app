import { z } from 'zod';

const uuid = z.string().uuid();
const futureTimestamp = z.string().datetime().refine((s) => new Date(s) > new Date(), {
  message: 'startAt must be in the future.',
});

const timestamp = z.string().datetime();

/**
 * POST /v1/appointments body.
 *
 * `resourceId` (primary) is always required. `serviceIds` is an optional array
 * (custom appointments have none). `durationMinutes` overrides the summed
 * service duration when both are provided. When no services are selected,
 * `durationMinutes` is required.
 */
export const createAppointmentBody = z
  .object({
    clientId: uuid.optional(),
    serviceIds: z.array(uuid).optional().default([]),
    resourceId: uuid,
    additionalResourceIds: z.array(uuid).optional(),
    startAt: timestamp,
    durationMinutes: z.number().int().positive().optional(),
    summary: z.string().max(200).optional(),
    notes: z.string().max(5000).optional(),
  })
  .refine((b) => b.serviceIds.length > 0 || b.durationMinutes !== undefined, {
    message: 'durationMinutes is required when no services are selected.',
    path: ['durationMinutes'],
  });

/**
 * PATCH /v1/appointments/:id body — discriminated union on `action`.
 * One endpoint, one auth guard, dispatch in the controller.
 */
export const patchAppointmentBody = z.discriminatedUnion('action', [
  z.object({ action: z.literal('cancel'), reason: z.string().max(200).optional() }),
  z.object({ action: z.literal('check_in'), note: z.string().max(500).optional() }),
  z.object({ action: z.literal('start'), note: z.string().max(500).optional() }),
  z.object({ action: z.literal('complete'), note: z.string().max(500).optional() }),
  z.object({ action: z.literal('no_show'), note: z.string().max(500).optional() }),
  z.object({ action: z.literal('reschedule'), startAt: futureTimestamp, durationMinutes: z.number().int().positive().optional() }),
]);

export const appointmentIdParam = z.object({ id: uuid });

export type CreateAppointmentInput = z.infer<typeof createAppointmentBody>;
export type PatchAppointmentInput = z.infer<typeof patchAppointmentBody>;
