import { z } from 'zod';

const email = z.string().email().max(254).transform((v) => v.toLowerCase().trim());
const password = z.string().min(8).max(128);

export const loginBody = z.object({
  email,
  password,
});

export const refreshBody = z.object({
  // Optional — refresh may come from the cookie instead of the body.
  refreshToken: z.string().min(1).optional(),
});

export const changePasswordBody = z.object({
  currentPassword: z.string().min(1),
  newPassword: password,
});

export const provisionOwnerBody = z.object({
  email,
  password,
  firstName: z.string().min(1).max(80).optional(),
  lastName: z.string().min(1).max(80).optional(),
});

export type LoginBody = z.infer<typeof loginBody>;
export type RefreshBody = z.infer<typeof refreshBody>;
export type ChangePasswordBody = z.infer<typeof changePasswordBody>;
