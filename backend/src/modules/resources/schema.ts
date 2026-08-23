import { z } from 'zod';

export const createResourceBody = z.object({
  name: z.string().min(1).max(120),
  type: z.enum(['provider', 'room', 'equipment', 'chair']),
  linkedStaffId: z.string().uuid().optional(),
  color: z.string().max(20).optional(),
  notes: z.string().max(5000).optional(),
});

export const updateResourceBody = z.object({
  name: z.string().min(1).max(120).optional(),
  isActive: z.boolean().optional(),
  color: z.string().max(20).optional(),
  notes: z.string().max(5000).optional(),
});

export const resourceIdParam = z.object({ id: z.string().uuid() });
