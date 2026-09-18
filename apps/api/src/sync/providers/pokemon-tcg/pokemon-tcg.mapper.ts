import {
  CardDTOSchema,
  PriceDTOSchema,
  SetDTOSchema,
  type CardDTO,
  type PriceDTO,
  type SetDTO,
} from '../provider.dto.js';
import type { RawCard, RawSet } from './pokemon-tcg.schema.js';

/**
 * Print variants, best first. A card that exists as both an ordinary and a
 * holofoil print reports the ordinary price, because that is the one most
 * holders have.
 */
const TCGPLAYER_VARIANTS = [
  'normal',
  'holofoil',
  'reverseHolofoil',
  '1stEditionHolofoil',
  'unlimitedHolofoil',
] as const;

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

/** `1999/01/09`, not `1999-01-09`. */
function parseReleaseDate(value: string): Date {
  return new Date(value.replace(/\//g, '-'));
}

export function toSetDTO(raw: RawSet): SetDTO {
  return SetDTOSchema.parse({
    id: raw.id,
    name: raw.name,
    series: raw.series,
    releaseDate: parseReleaseDate(raw.releaseDate),
    // `printedTotal` is absent on the newest set in the catalog. `total`
    // includes secret rares so the two differ, but it is never absent, and it
    // beats 0 - which would make PD-54's set completion read as 0%.
    printedTotal: raw.printedTotal ?? raw.total,
    total: raw.total,
    symbolUrl: raw.images?.symbol ?? null,
    logoUrl: raw.images?.logo ?? null,
  });
}

export function toCardDTO(raw: RawCard): CardDTO {
  const hp = raw.hp === undefined ? null : Number.parseInt(raw.hp, 10);

  return CardDTOSchema.parse({
    id: raw.id,
    setId: raw.set.id,
    name: raw.name,
    supertype: raw.supertype,
    subtypes: raw.subtypes ?? [],
    // Upstream sends "140". A card whose hp is not a number at all - some
    // Trainer cards - becomes null rather than NaN.
    hp: hp === null || Number.isNaN(hp) ? null : hp,
    types: raw.types ?? [],
    rarity: raw.rarity ?? null,
    retreatCost: raw.retreatCost ?? [],
    weaknesses: raw.weaknesses ?? [],
    resistances: raw.resistances ?? [],
    attacks: (raw.attacks ?? []).map((attack) => ({
      name: attack.name,
      cost: attack.cost ?? [],
      convertedEnergyCost: attack.convertedEnergyCost ?? (attack.cost ?? []).length,
      damage: attack.damage ?? '',
      text: attack.text ?? '',
    })),
    abilities: (raw.abilities ?? []).map((ability) => ({
      name: ability.name,
      text: ability.text ?? '',
      type: ability.type ?? '',
    })),
    legalities: raw.legalities ?? {},
    nationalPokedexNumbers: raw.nationalPokedexNumbers ?? [],
    imageSmall: raw.images.small,
    imageLarge: raw.images.large,
    // This provider publishes no TCGplayer or Cardmarket identifier - the union
    // of keys across 245 price objects is url, updatedAt and prices. TCGdex
    // does, so PD-40 fills these and this one cannot.
    tcgplayerId: null,
    cardmarketId: null,
  });
}

export function toPriceDTOs(raw: RawCard, capturedAt: Date): PriceDTO[] {
  const prices: PriceDTO[] = [];

  const tcg = raw.tcgplayer?.prices;
  if (tcg) {
    const variant = TCGPLAYER_VARIANTS.find((name) => tcg[name] !== undefined);
    const block = variant === undefined ? undefined : (tcg[variant] as Record<string, unknown>);

    if (block) {
      prices.push(
        PriceDTOSchema.parse({
          cardId: raw.id,
          source: 'TCGPLAYER',
          currency: 'USD',
          market: asNumber(block.market),
          low: asNumber(block.low),
          mid: asNumber(block.mid),
          high: asNumber(block.high),
          capturedAt,
        }),
      );
    }
  }

  const cm = raw.cardmarket?.prices;
  if (cm) {
    prices.push(
      PriceDTOSchema.parse({
        cardId: raw.id,
        source: 'CARDMARKET',
        currency: 'EUR',
        market: asNumber(cm.averageSellPrice),
        low: asNumber(cm.lowPrice),
        // Cardmarket publishes no median. `trendPrice` is the closest thing it
        // has, and it is a trend rather than a middle - the loosest link in this
        // mapping. M4 may prefer to widen PriceDTO instead of keeping it.
        mid: asNumber(cm.trendPrice),
        high: null,
        capturedAt,
      }),
    );
  }

  return prices;
}
