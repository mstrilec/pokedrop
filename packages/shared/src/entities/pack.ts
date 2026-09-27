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
