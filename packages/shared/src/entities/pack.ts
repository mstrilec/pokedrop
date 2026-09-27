import { z } from 'zod';
import { RaritySchema } from '../enums.js';
import { InventoryCardSchema } from './inventory.js';
import {
  CardIdSchema,
  PackOpeningIdSchema,
  PackTemplateIdSchema,
  SetIdSchema,
  UserIdSchema,
} from '../primitives/id.js';
import { PaginationQuerySchema, cursorPageOf } from '../primitives/pagination.js';

export const MAX_CARDS_PER_PACK = 20;

export const SetFilterSchema = z.strictObject({
  setIds: z.array(SetIdSchema).min(1).max(50),
});
export type SetFilter = z.infer<typeof SetFilterSchema>;

export const PackSlotSchema = z
  .strictObject({
    count: z.number().int().min(1).max(MAX_CARDS_PER_PACK),
    weights: z.record(RaritySchema, z.number().int().min(0).max(1_000_000)),
  })
  .refine((slot) => Object.values(slot.weights).some((weight) => weight > 0), {
    message: 'A slot needs at least one rarity with a positive weight',
    path: ['weights'],
  });
export type PackSlot = z.infer<typeof PackSlotSchema>;

export const SlotConfigSchema = z
  .strictObject({
    slots: z.array(PackSlotSchema).min(1).max(10),
  })
  .refine(
    (config) => config.slots.reduce((sum, slot) => sum + slot.count, 0) <= MAX_CARDS_PER_PACK,
    { message: `A pack holds at most ${MAX_CARDS_PER_PACK} cards`, path: ['slots'] },
  );
export type SlotConfig = z.infer<typeof SlotConfigSchema>;

export const PackTemplateSchema = z.object({
  id: PackTemplateIdSchema,
  name: z.string().min(1),
  setFilter: SetFilterSchema,
  cost: z.number().int().min(0),
  slotConfig: SlotConfigSchema,
  active: z.boolean(),
});
export type PackTemplate = z.infer<typeof PackTemplateSchema>;

export const CreatePackTemplateSchema = z.strictObject({
  name: z.string().trim().min(1).max(100),
  setFilter: SetFilterSchema,
  cost: z.number().int().min(0).max(1_000_000),
  slotConfig: SlotConfigSchema,
  active: z.boolean().default(true),
});
export type CreatePackTemplate = z.infer<typeof CreatePackTemplateSchema>;

export const UpdatePackTemplateSchema = CreatePackTemplateSchema.partial()
  .omit({ active: true })
  .extend({ active: z.boolean().optional() })
  .refine((patch) => Object.keys(patch).length > 0, { message: 'Nothing to update' });
export type UpdatePackTemplate = z.infer<typeof UpdatePackTemplateSchema>;

export const PackOpeningCardSchema = z.object({
  cardId: CardIdSchema,
  rarity: RaritySchema,
  position: z.number().int().min(0),
});
export type PackOpeningCard = z.infer<typeof PackOpeningCardSchema>;

export const PackOpeningSchema = z.object({
  id: PackOpeningIdSchema,
  userId: UserIdSchema,
  templateId: PackTemplateIdSchema,
  openId: z.uuid(),
  cards: z.array(PackOpeningCardSchema),
  createdAt: z.coerce.date(),
});
export type PackOpening = z.infer<typeof PackOpeningSchema>;

export const OpenPackRequestSchema = z.object({
  openId: z.uuid(),
});
export type OpenPackRequest = z.infer<typeof OpenPackRequestSchema>;

/** What `POST /packs/:templateId/open` answers, for a new opening and a replay alike. */
export const PackOpenResultSchema = z.object({
  openingId: PackOpeningIdSchema,
  openId: z.uuid(),
  templateId: PackTemplateIdSchema,
  createdAt: z.coerce.date(),
  balance: z.number().int().min(0),
  cards: z.array(PackOpeningCardSchema.extend({ card: InventoryCardSchema })),
});
export type PackOpenResult = z.infer<typeof PackOpenResultSchema>;

/**
 * What the confirm dialog shows, derived from `slotConfig` by the ladder rule
 * the generator uses: odds ordered from the most common rarity to the rarest,
 * and a slot's most common rarity is its floor.
 */
export const PackTemplateContentsSchema = z.object({
  cardCount: z.number().int().min(1),
  slots: z.array(
    z.object({
      count: z.number().int().min(1),
      odds: z.array(z.object({ rarity: RaritySchema, percent: z.number().min(0).max(100) })),
    }),
  ),
});
export type PackTemplateContents = z.infer<typeof PackTemplateContentsSchema>;

/** A template as `GET /packs/templates` shows it to a member. */
export const PackTemplateViewSchema = PackTemplateSchema.extend({
  contents: PackTemplateContentsSchema,
  guarantee: z.string().min(1),
});
export type PackTemplateView = z.infer<typeof PackTemplateViewSchema>;

export const PackHistoryQuerySchema = z.object({
  cursor: z.string().min(1).max(512).optional(),
  pageSize: PaginationQuerySchema.shape.pageSize,
});
export type PackHistoryQuery = z.infer<typeof PackHistoryQuerySchema>;

/** `openId` is any string here: openings that predate PD-58 were not keyed by a UUID. */
export const PackHistoryEntrySchema = z.object({
  openingId: PackOpeningIdSchema,
  openId: z.string().min(1),
  templateId: PackTemplateIdSchema,
  templateName: z.string(),
  createdAt: z.coerce.date(),
  cards: z.array(PackOpeningCardSchema.extend({ card: InventoryCardSchema })),
});
export type PackHistoryEntry = z.infer<typeof PackHistoryEntrySchema>;

export const PackHistoryPageSchema = cursorPageOf(PackHistoryEntrySchema);
export type PackHistoryPage = z.infer<typeof PackHistoryPageSchema>;
