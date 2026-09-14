import { z } from 'zod';
import { AuditLogIdSchema, UserIdSchema } from '../primitives/id.js';

/** Admin and sensitive actions, written by PD-79. */
export const AuditLogSchema = z.object({
  id: AuditLogIdSchema,
  actorId: UserIdSchema,
  action: z.string().min(1),
  entity: z.string().min(1),
  entityId: z.string().min(1),
  meta: z.record(z.string(), z.unknown()),
  createdAt: z.coerce.date(),
});
export type AuditLog = z.infer<typeof AuditLogSchema>;
