import { z } from 'zod';
import { AuditLogIdSchema, UserIdSchema } from '../primitives/id.js';

/**
 * Admin and sensitive actions.
 *
 * `actorId` is nullable because not every audited action has a human behind
 * it — the trade-expiry job cancels trades on its own. Null therefore means
 * "the system", and the database keeps that distinct from "a user who was
 * later removed": the foreign key is Restrict, so a delete can never quietly
 * turn someone's actions into system actions.
 */
export const AuditLogSchema = z.object({
  id: AuditLogIdSchema,
  actorId: UserIdSchema.nullable(),
  action: z.string().min(1),
  entity: z.string().min(1),
  entityId: z.string().min(1),
  meta: z.record(z.string(), z.unknown()),
  createdAt: z.coerce.date(),
});
export type AuditLog = z.infer<typeof AuditLogSchema>;
