import { z } from 'zod';
import { NotificationIdSchema, UserIdSchema } from '../primitives/id.js';

/** `readAt` is null until the user opens it. */
export const NotificationSchema = z.object({
  id: NotificationIdSchema,
  userId: UserIdSchema,
  type: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
  readAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
});
export type Notification = z.infer<typeof NotificationSchema>;
