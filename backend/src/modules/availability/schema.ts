import { z } from 'zod';

export const createWorkingHourBody = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  startTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/), // HH:mm or HH:mm:ss
  endTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // YYYY-MM-DD
  validTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const updateWorkingHourBody = createWorkingHourBody.partial();

export const createTimeOffBody = z.object({
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  reason: z.string().max(200).optional(),
});

export const resourceIdParam = z.object({ id: z.string().uuid() });
export const workingHourIdParam = z.object({ id: z.string().uuid() });
export const timeOffIdParam = z.object({ id: z.string().uuid() });
export const timezoneBody = z.object({ timezone: z.string().min(2).max(50) });
