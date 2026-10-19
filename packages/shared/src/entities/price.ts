import { z } from 'zod';
import { PriceSourceSchema } from '../enums.js';
import { CardIdSchema, PriceSnapshotIdSchema } from '../primitives/id.js';

export const PriceSnapshotSchema = z.object({
  id: PriceSnapshotIdSchema,
  cardId: CardIdSchema,
  source: PriceSourceSchema,
  currency: z.string().length(3),
  market: z.number().nonnegative().nullable(),
  low: z.number().nonnegative().nullable(),
  mid: z.number().nonnegative().nullable(),
  high: z.number().nonnegative().nullable(),
  capturedAt: z.coerce.date(),
});
export type PriceSnapshot = z.infer<typeof PriceSnapshotSchema>;

export const CardPriceSchema = z.object({
  cardId: CardIdSchema,
  usd: z.number().nonnegative().nullable(),
  eur: z.number().nonnegative().nullable(),
  priceUpdatedAt: z.coerce.date().nullable(),
});
export type CardPrice = z.infer<typeof CardPriceSchema>;

export const PricePointSchema = z.object({
  capturedOn: z.iso.date(),
  market: z.number().nonnegative(),
});
export type PricePoint = z.infer<typeof PricePointSchema>;

export const PriceSeriesSchema = z.object({
  currency: z.string().length(3),
  points: z.array(PricePointSchema),
});
export type PriceSeries = z.infer<typeof PriceSeriesSchema>;

export const PriceHistorySchema = z.object({
  cardId: CardIdSchema,
  windowDays: z.number().int().min(1).max(365),
  series: z.object({
    TCGPLAYER: PriceSeriesSchema,
    CARDMARKET: PriceSeriesSchema,
  }),
});
export type PriceHistory = z.infer<typeof PriceHistorySchema>;

export const PriceHistoryQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
});
export type PriceHistoryQuery = z.infer<typeof PriceHistoryQuerySchema>;

export const PriceRefreshResultSchema = CardPriceSchema.extend({
  queued: z.boolean(),
  retryAfterSeconds: z.number().int().nonnegative(),
});
export type PriceRefreshResult = z.infer<typeof PriceRefreshResultSchema>;
