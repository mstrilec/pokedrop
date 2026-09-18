import { z } from 'zod';
import { RoleSchema } from '../enums.js';
import { UserIdSchema } from '../primitives/id.js';

export const UserSchema = z.object({
  id: UserIdSchema,
  email: z.email(),
  displayName: z.string().min(1).max(64),
  avatarUrl: z.url().nullable(),
  role: RoleSchema,
  currency: z.number().int().min(0),
  createdAt: z.coerce.date(),
});
export type User = z.infer<typeof UserSchema>;

export const PublicUserSchema = UserSchema.omit({
  email: true,
  currency: true,
});
export type PublicUser = z.infer<typeof PublicUserSchema>;
