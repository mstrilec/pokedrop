import { z } from 'zod';
import { TradeStatusSchema } from '../enums.js';
import { cursorPageOf, PaginationQuerySchema } from '../primitives/pagination.js';

const DaySchema = z.iso.date();

// `to` is inclusive; a range that ends before it starts names nothing.
const range = <T extends { from?: string; to?: string }>(query: T) =>
  query.from === undefined || query.to === undefined || query.from <= query.to;
const RANGE_MESSAGE = { message: '`from` must not be after `to`', path: ['from'] };

export const AdminTradeQuerySchema = z
  .object({
    status: TradeStatusSchema.optional(),
    user: z.string().min(1).max(64).optional(),
    from: DaySchema.optional(),
    to: DaySchema.optional(),
    cursor: z.string().min(1).max(512).optional(),
    pageSize: PaginationQuerySchema.shape.pageSize,
  })
  .refine(range, RANGE_MESSAGE);
export type AdminTradeQuery = z.infer<typeof AdminTradeQuerySchema>;

/** What `POST /admin/trades/:id/void` would answer, found by running it and rolling it back. */
export const VoidCheckSchema = z.discriminatedUnion('voidable', [
  z.object({ voidable: z.literal(true) }),
  z.object({ voidable: z.literal(false), code: z.string(), reason: z.string() }),
]);
export type VoidCheck = z.infer<typeof VoidCheckSchema>;

export const AUDIT_ENTITIES = ['Trade', 'User', 'PackTemplate', 'SyncJob', 'Provider'] as const;
export const AuditEntitySchema = z.enum(AUDIT_ENTITIES);
export type AuditEntity = z.infer<typeof AuditEntitySchema>;

/** `trade` matches every `trade.*` action; anything with a dot is one exact action. */
export const AUDIT_ACTION_GROUPS = ['trade', 'user', 'pack_template', 'sync'] as const;

export const AuditQuerySchema = z
  .object({
    actor: z.string().min(1).max(64).optional(),
    action: z
      .string()
      .regex(/^[a-z_]+(\.[a-z_]+)?$/)
      .optional(),
    entity: AuditEntitySchema.optional(),
    entityId: z.string().min(1).max(128).optional(),
    from: DaySchema.optional(),
    to: DaySchema.optional(),
    cursor: z.string().min(1).max(512).optional(),
    pageSize: z.coerce.number().int().min(1).max(100).default(50),
  })
  .refine(range, RANGE_MESSAGE)
  .refine((query) => query.entityId === undefined || query.entity !== undefined, {
    message: '`entityId` needs `entity`',
    path: ['entityId'],
  });
export type AuditQuery = z.infer<typeof AuditQuerySchema>;

export const AuditEntrySchema = z.object({
  id: z.string(),
  action: z.string(),
  entity: z.string(),
  entityId: z.string(),
  /** null: the system acted (the expiry job). */
  actor: z.object({ id: z.string(), displayName: z.string(), email: z.string() }).nullable(),
  /** Who or what the row is about, for its link: a user's name and email, a template's name. */
  subject: z.object({ label: z.string(), email: z.string().nullable() }).nullable(),
  meta: z.record(z.string(), z.unknown()),
  createdAt: z.coerce.date(),
});
export type AuditEntry = z.infer<typeof AuditEntrySchema>;

export const AuditPageSchema = cursorPageOf(AuditEntrySchema);
export type AuditPage = z.infer<typeof AuditPageSchema>;
