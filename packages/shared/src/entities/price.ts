import { z } from 'zod';
import { PriceSourceSchema } from '../enums.js';
import { CardIdSchema, PriceSnapshotIdSchema } from '../primitives/id.js';

/**
 * One captured price point. Throttled to at most one per card per day, per
 * docs/DataModel.md — this is the fastest-growing table in the system.
 */
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
