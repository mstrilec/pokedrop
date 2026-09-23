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

/**
 * What `GET /cards/:id/price` answers.
 *
 * Every value field is nullable because a card that exists but has never been
 * price-synced is a 200 with nulls, not a 404. `priceUpdatedAt` being null IS
 * the indicator that the card has never been priced - a separate boolean would
 * be a second way of saying the same thing, and two sources of truth for one
 * fact is how they drift.
 *
 * A non-null `priceUpdatedAt` alongside null `usd`/`eur` is a distinct, later
 * state: the card was synced and the marketplace published no price that time,
 * which is different from never having been synced at all.
 *
 * The timestamp is absolute and never a computed age. This response is cached
 * for an hour, and a relative "updated 300 seconds ago" served from cache forty
 * minutes later is wrong by forty minutes - least accurate exactly when the data
 * is most stale, which is the case the field exists to expose.
 */
export const CardPriceSchema = z.object({
  cardId: CardIdSchema,
  usd: z.number().nonnegative().nullable(),
  eur: z.number().nonnegative().nullable(),
  priceUpdatedAt: z.coerce.date().nullable(),
});
export type CardPrice = z.infer<typeof CardPriceSchema>;

/**
 * One point on a sparkline.
 *
 * `capturedOn` is a plain `YYYY-MM-DD` string rather than a timestamp: it is the
 * materialised UTC day PD-48 added, and the axis a daily sparkline plots. An ISO
 * datetime here would invite a timezone question that this very column exists to
 * have already answered.
 *
 * `market` is NOT nullable, and that is the decision that a snapshot carrying no
 * market value is left out of the series entirely. A point with no value is not
 * a point, and admitting `null` here would contradict the rule that a gap is an
 * absent point.
 */
export const PricePointSchema = z.object({
  capturedOn: z.iso.date(),
  market: z.number().nonnegative(),
});
export type PricePoint = z.infer<typeof PricePointSchema>;

/**
 * `currency` is a constant of the source rather than a value read from a row,
 * because an empty series has no row to read it from, and a field that appears
 * only when data happens to exist is one a client cannot rely on.
 */
export const PriceSeriesSchema = z.object({
  currency: z.string().length(3),
  points: z.array(PricePointSchema),
});
export type PriceSeries = z.infer<typeof PriceSeriesSchema>;

/**
 * What `GET /cards/:id/price/history` answers.
 *
 * Both series are always present. A card with data from only one marketplace
 * still returns the other with an empty `points` array: an absent key would say
 * "this marketplace does not exist", where the thing being said is "this
 * marketplace has no data for this card in this window".
 */
export const PriceHistorySchema = z.object({
  cardId: CardIdSchema,
  windowDays: z.number().int().min(1).max(365),
  series: z.object({
    TCGPLAYER: PriceSeriesSchema,
    CARDMARKET: PriceSeriesSchema,
  }),
});
export type PriceHistory = z.infer<typeof PriceHistorySchema>;

/**
 * The window, defaulted and bounded. A year is the ceiling because the daily cap
 * makes that at most 730 points for one card, which is still one small response,
 * and because nothing in the product asks to look further back. Unbounded would
 * let one request ask for the whole of the fastest-growing table in the system.
 */
export const PriceHistoryQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
});
export type PriceHistoryQuery = z.infer<typeof PriceHistoryQuerySchema>;
