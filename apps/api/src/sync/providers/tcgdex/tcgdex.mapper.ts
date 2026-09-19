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
 * TCGdex writes `Pokemon`; the mirror holds `Pokémon`, which is what
 * pokemontcg.io publishes and what 17 464 existing rows already say. One
 * character, and without it the supertype facet grows a fourth value and
 * `?supertype=Pokémon` misses every row this provider wrote.
 *
 * An unrecognised category passes through unchanged rather than being dropped:
 * a new one is information, and inventing a mapping for it would be worse.
 */
const SUPERTYPE_BY_CATEGORY: Record<string, string> = {
  Pokemon: 'Pokémon',
  Trainer: 'Trainer',
  Energy: 'Energy',
};

/** TCGplayer print variants, best first - the same order the primary uses. */
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
 * The symbol URL TCGdex publishes does not resolve. It points at
 * `assets.tcgdex.net/univ/<serie>/<set>/symbol`, and that path answers 400 with
 * every extension and with none; the asset lives under the language prefix
 * instead. Verified across 8 sets: `univ` 0/8, `en` 8/8.
 *
 * This looks like a typo and is not. `SetDTOSchema.symbolUrl` is `z.url()`,
 * which a dead URL satisfies perfectly, so removing the rewrite writes 169 dead
 * image sources into the mirror without failing anything.
 */
function symbolUrl(symbol: string | undefined): string | null {
  return symbol === undefined ? null : `${symbol.replace('/univ/', '/en/')}.png`;
}

/** `Stage2` is one word upstream and two in the mirror. `Basic` is unchanged. */
function toSubtypes(stage: string | undefined): string[] {
  return stage === undefined ? [] : [stage.replace(/([^\d\s])(\d)/, '$1 $2')];
}

export function toSetDTO(raw: RawSet): SetDTO {
  return SetDTOSchema.parse({
    id: raw.id,
    name: raw.name,
    series: raw.serie.name,
    // Already ISO here, where pokemontcg.io sends `1999/01/09`. The two map to
    // the same instant to the millisecond - checked against both live payloads.
    releaseDate: new Date(raw.releaseDate),
    printedTotal: raw.cardCount.official,
    total: raw.cardCount.total,
    symbolUrl: symbolUrl(raw.symbol),
    logoUrl: raw.logo === undefined ? null : `${raw.logo}.png`,
  });
}

/**
 * `image` is required by the caller rather than defaulted here. `CardDTO`
 * declares `imageSmall` and `imageLarge` as non-nullable URLs, so a card with no
 * image cannot be represented at all - 1 749 of 23 736 are in that state. The
 * client filters them into `CardPage.skipped`, which is the same thing the
 * primary's client does with a card that fails to parse.
 */
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
    // TCGdex publishes a count, not a cost. Expanding it is not invention:
    // retreat cost is colourless by the rules of the game.
    retreatCost: Array.from({ length: raw.retreat ?? 0 }, () => 'Colorless'),
    weaknesses: raw.weaknesses ?? [],
    resistances: raw.resistances ?? [],
    attacks: (raw.attacks ?? []).map((attack) => ({
      name: attack.name,
      cost: attack.cost ?? [],
      // Not published. `cost.length` is the definition of the field.
      convertedEnergyCost: (attack.cost ?? []).length,
      damage: attack.damage === undefined ? '' : String(attack.damage),
      // AttackSchema declares text and damage as non-nullable strings, so an
      // attack with no printed effect has nowhere to put a null. The empty
      // string is the shared contract speaking, not this mapper being careless.
      text: attack.effect ?? '',
    })),
    abilities: (raw.abilities ?? []).map((ability) => ({
      name: ability.name,
      text: ability.effect ?? '',
      type: ability.type ?? '',
    })),
    // Booleans upstream, strings in the contract. `unlimited` is omitted rather
    // than invented - TCGdex does not publish it, and a guess here would read
    // as data.
    legalities:
      raw.legal === undefined
        ? {}
        : {
            standard: raw.legal.standard ? 'Legal' : 'Illegal',
            expanded: raw.legal.expanded ? 'Legal' : 'Illegal',
          },
    nationalPokedexNumbers: raw.dexId ?? [],
    imageSmall: `${raw.image}/low.webp`,
    imageLarge: `${raw.image}/high.webp`,
    // This provider is the stronger source for both. pokemontcg.io publishes
    // neither, so all 20 670 existing rows carry null.
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
        // The same approximation the primary's mapper makes and for the same
        // reason: Cardmarket publishes no median, and a trend is the closest
        // thing it has. M4 may prefer to widen PriceDTO instead.
        mid: asNumber(cm.trend),
        high: null,
        capturedAt,
      }),
    );
  }

  return prices;
}
