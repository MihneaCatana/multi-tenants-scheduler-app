import { z } from 'zod';

export const createServiceBody = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(5000).optional(),
  category: z.string().max(80).optional(),
  durationMinutes: z.number().int().positive(),
  bufferBeforeMinutes: z.number().int().min(0).default(0).optional(),
  bufferAfterMinutes: z.number().int().min(0).default(0).optional(),
  price: z.number().nonnegative().optional(),
});

export const updateServiceBody = createServiceBody.partial();

export const serviceIdParam = z.object({ id: z.string().uuid() });

export const requirementsBody = z
  .array(
    z.object({
      resourceType: z.enum(['provider', 'room', 'equipment', 'chair']),
      quantity: z.number().int().positive().default(1),
      isRequired: z.boolean().default(true),
    }),
  )
  .default([]);
