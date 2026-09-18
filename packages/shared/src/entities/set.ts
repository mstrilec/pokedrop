import { z } from 'zod';
import { SetIdSchema } from '../primitives/id.js';

export const CardSetSchema = z.object({
  id: SetIdSchema,
  name: z.string().min(1),
  series: z.string().min(1),
  releaseDate: z.coerce.date(),
  printedTotal: z.number().int().min(0),
  total: z.number().int().min(0),
  symbolUrl: z.url().nullable(),
  logoUrl: z.url().nullable(),
});
export type CardSet = z.infer<typeof CardSetSchema>;
