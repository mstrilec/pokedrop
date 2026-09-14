import { z } from 'zod';
import { RoleSchema } from '../enums.js';
import { UserIdSchema } from '../primitives/id.js';

/**
 * A user as the owner sees themself.
 *
 * `passwordHash` from docs/DataModel.md is deliberately absent: it is storage,
 * not contract, and nothing in this package should make it expressible in a
 * response body.
 */
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

/**
 * A user as anyone else sees them. Email and balance are the owner's business;
 * `GET /users/:id` is public in docs/API.md.
 */
export const PublicUserSchema = UserSchema.omit({
  email: true,
  currency: true,
});
export type PublicUser = z.infer<typeof PublicUserSchema>;
