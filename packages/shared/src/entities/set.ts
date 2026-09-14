import { z } from 'zod';
import { SetIdSchema } from '../primitives/id.js';

/**
 * A card set, mirrored from the provider.
 *
 * docs/DataModel.md calls this entity `Set`. It is exported as `CardSet`
 * because a type named `Set` would shadow the global one for any consumer that
 * imports it, turning an ordinary `Set<string>` annotation into a type error.
 */
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
