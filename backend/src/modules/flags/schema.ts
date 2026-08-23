import { z } from 'zod';

export const flagOverride = z.object({
  key: z.string().min(1).max(63),
  enabled: z.boolean(),
});

export const updateTenantFlagsBody = z.object({
  flags: z.array(flagOverride).min(1).max(100),
});

export type UpdateTenantFlagsBody = z.infer<typeof updateTenantFlagsBody>;

export const tenantIdParam = z.object({ id: z.string().uuid() });
