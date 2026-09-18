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
