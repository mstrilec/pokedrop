import {
  CardDTOSchema,
  PriceDTOSchema,
  SetDTOSchema,
  type CardDTO,
  type PriceDTO,
  type SetDTO,
} from '../provider.dto.js';
import type { RawCard, RawSet } from './pokemon-tcg.schema.js';

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
    evolvesFrom: raw.evolvesFrom || null,
    imageSmall: raw.images.small,
    imageLarge: raw.images.large,
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
        mid: asNumber(cm.trendPrice),
        high: null,
        capturedAt,
      }),
    );
  }

  return prices;
}
