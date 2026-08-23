import { z } from 'zod';

const staffIdParam = z.object({ id: z.string().uuid() });

const listStaffQuery = z.object({
  status: z.enum(['active', 'inactive']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

// role may only be set to a tenant role (never platform_admin).
const roleUpdate = z.enum(['tenant_admin', 'tenant_user']);

const updateStaffBody = z.object({
  firstName: z.string().min(1).max(80).optional(),
  lastName: z.string().min(1).max(80).optional(),
  role: roleUpdate.optional(),
});

const updateStatusBody = z.object({
  active: z.boolean(),
});

const createStaffBody = z.object({
  email: z.string().email().max(254).transform((v) => v.toLowerCase().trim()),
  password: z.string().min(8).max(128),
  firstName: z.string().min(1).max(80).optional(),
  lastName: z.string().min(1).max(80).optional(),
});

export {
  staffIdParam,
  listStaffQuery,
  updateStaffBody,
  updateStatusBody,
  createStaffBody,
};
export type UpdateStaffBody = z.infer<typeof updateStaffBody>;
export type UpdateStatusBody = z.infer<typeof updateStatusBody>;
export type CreateStaffBody = z.infer<typeof createStaffBody>;
