import {
  CardDTOSchema,
  PriceDTOSchema,
  SetDTOSchema,
  type CardDTO,
  type PriceDTO,
  type SetDTO,
} from '../provider.dto.js';
import type { RawCard, RawSet } from './tcgdex.schema.js';

/**
 * TCGdex writes `Pokemon`; the mirror holds `Pokémon`. Without this the supertype facet grows a
 * fourth value and `?supertype=Pokémon` misses every row this provider wrote.
 */
const SUPERTYPE_BY_CATEGORY: Record<string, string> = {
  Pokemon: 'Pokémon',
  Trainer: 'Trainer',
  Energy: 'Energy',
};

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

/**
 * Not a typo: the `univ` symbol URL TCGdex publishes does not resolve, the `en` one does.
 * `z.url()` accepts a dead URL, so removing this fails nothing and breaks 169 set symbols.
 */
function symbolUrl(symbol: string | undefined): string | null {
  return symbol === undefined ? null : `${symbol.replace('/univ/', '/en/')}.png`;
}

function toSubtypes(stage: string | undefined): string[] {
  return stage === undefined ? [] : [stage.replace(/([^\d\s])(\d)/, '$1 $2')];
}

export function toSetDTO(raw: RawSet): SetDTO {
  return SetDTOSchema.parse({
    id: raw.id,
    name: raw.name,
    series: raw.serie.name,
    releaseDate: new Date(raw.releaseDate),
    printedTotal: raw.cardCount.official,
    total: raw.cardCount.total,
    symbolUrl: symbolUrl(raw.symbol),
    logoUrl: raw.logo === undefined ? null : `${raw.logo}.png`,
  });
}

export function toCardDTO(raw: RawCard & { image: string }): CardDTO {
  const thirdParty = (raw.variants_detailed ?? [])
    .map((variant) => variant.thirdParty)
    .find((party) => party?.tcgplayer !== undefined || party?.cardmarket !== undefined);

  return CardDTOSchema.parse({
    id: raw.id,
    setId: raw.set.id,
    name: raw.name,
    supertype: SUPERTYPE_BY_CATEGORY[raw.category] ?? raw.category,
    subtypes: toSubtypes(raw.stage),
    hp: raw.hp ?? null,
    types: raw.types ?? [],
    rarity: raw.rarity ?? null,
    retreatCost: Array.from({ length: raw.retreat ?? 0 }, () => 'Colorless'),
    weaknesses: (raw.weaknesses ?? []).map((w) => ({ type: w.type, value: w.value ?? '' })),
    resistances: (raw.resistances ?? []).map((r) => ({ type: r.type, value: r.value ?? '' })),
    attacks: (raw.attacks ?? []).map((attack) => ({
      name: attack.name,
      cost: attack.cost ?? [],
      convertedEnergyCost: (attack.cost ?? []).length,
      damage: attack.damage === undefined ? '' : String(attack.damage),
      text: attack.effect ?? '',
    })),
    abilities: (raw.abilities ?? []).map((ability) => ({
      name: ability.name,
      text: ability.effect ?? '',
      type: ability.type ?? '',
    })),
    legalities:
      raw.legal === undefined
        ? {}
        : {
            standard: raw.legal.standard ? 'Legal' : 'Illegal',
            expanded: raw.legal.expanded ? 'Legal' : 'Illegal',
          },
    nationalPokedexNumbers: raw.dexId ?? [],
    evolvesFrom: raw.evolveFrom || null,
    imageSmall: `${raw.image}/low.webp`,
    imageLarge: `${raw.image}/high.webp`,
    tcgplayerId: thirdParty?.tcgplayer === undefined ? null : String(thirdParty.tcgplayer),
    cardmarketId: thirdParty?.cardmarket === undefined ? null : String(thirdParty.cardmarket),
  });
}

export function toPriceDTOs(raw: RawCard, capturedAt: Date): PriceDTO[] {
  const prices: PriceDTO[] = [];

  const tcg = raw.pricing?.tcgplayer;
  if (tcg) {
    const variant = TCGPLAYER_VARIANTS.find((name) => tcg[name] !== undefined);
    const block = variant === undefined ? undefined : (tcg[variant] as Record<string, unknown>);

    if (block) {
      prices.push(
        PriceDTOSchema.parse({
          cardId: raw.id,
          source: 'TCGPLAYER',
          currency: 'USD',
          market: asNumber(block.marketPrice),
          low: asNumber(block.lowPrice),
          mid: asNumber(block.midPrice),
          high: asNumber(block.highPrice),
          capturedAt,
        }),
      );
    }
  }

  const cm = raw.pricing?.cardmarket;
  if (cm) {
    prices.push(
      PriceDTOSchema.parse({
        cardId: raw.id,
        source: 'CARDMARKET',
        currency: 'EUR',
        market: asNumber(cm.avg),
        low: asNumber(cm.low),
        mid: asNumber(cm.trend),
        high: null,
        capturedAt,
      }),
    );
  }

  return prices;
}
