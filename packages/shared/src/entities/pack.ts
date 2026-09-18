import { z } from 'zod';
import { RaritySchema } from '../enums.js';
import {
  CardIdSchema,
  PackOpeningIdSchema,
  PackTemplateIdSchema,
  UserIdSchema,
} from '../primitives/id.js';

export const PackSlotSchema = z.object({
  weights: z.record(RaritySchema, z.number().nonnegative()),
});
export type PackSlot = z.infer<typeof PackSlotSchema>;

export const PackTemplateSchema = z.object({
  id: PackTemplateIdSchema,
  name: z.string().min(1),
  setFilter: z.record(z.string(), z.unknown()),
  cost: z.number().int().min(0),
  slotConfig: z.array(PackSlotSchema),
  active: z.boolean(),
});
export type PackTemplate = z.infer<typeof PackTemplateSchema>;

export const PackOpeningCardSchema = z.object({
  cardId: CardIdSchema,
  rarity: RaritySchema.nullable(),
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
