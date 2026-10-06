import { ladderOf, type Rung, type SlotConfig } from '@pokedrop/shared';
import type { Rng } from './pack-rng.js';

export type CardPool = ReadonlyMap<string, readonly string[]>;
export type PulledCard = { cardId: string; rarity: string };
export type Fallback = { slot: number; rolled: string; used: string };
export type GeneratedPack = { cards: PulledCard[]; fallbacks: Fallback[] };

export class EmptySlotError extends Error {
  constructor(readonly slot: number) {
    super(`Slot ${slot} has no cards in any of its rarities`);
    this.name = 'EmptySlotError';
  }
}

export function generatePack(slotConfig: SlotConfig, pool: CardPool, rng: Rng): GeneratedPack {
  const cards: PulledCard[] = [];
  const fallbacks: Fallback[] = [];

  for (const [slot, config] of slotConfig.slots.entries()) {
    const ladder = ladderOf(config.weights);
    const total = ladder.reduce((sum, rung) => sum + rung.weight, 0);

    for (let n = 0; n < config.count; n += 1) {
      const rolled = roll(ladder, rng.int(total));
      const found = resolve(ladder, rolled.index, pool);
      if (found === null) {
        throw new EmptySlotError(slot);
      }
      if (found.rarity !== rolled.rarity) {
        fallbacks.push({ slot, rolled: rolled.rarity, used: found.rarity });
      }
      cards.push({ cardId: pick(found.bucket, rng), rarity: found.rarity });
    }
  }

  return { cards, fallbacks };
}

function roll(ladder: readonly Rung[], r: number): { index: number; rarity: string } {
  let cumulative = 0;
  for (const [index, rung] of ladder.entries()) {
    cumulative += rung.weight;
    if (r < cumulative) {
      return { index, rarity: rung.rarity };
    }
  }
  throw new RangeError(`Roll ${r} is beyond the slot's weight total ${cumulative}`);
}

// Down the ladder towards more common rarities first, then up to the nearest
// rarer one: a rarer card only when no commoner card exists.
function resolve(
  ladder: readonly Rung[],
  rolled: number,
  pool: CardPool,
): { rarity: string; bucket: readonly string[] } | null {
  const order = [...ladder.slice(0, rolled + 1).reverse(), ...ladder.slice(rolled + 1)];
  for (const rung of order) {
    const bucket = pool.get(rung.rarity);
    if (bucket !== undefined && bucket.length > 0) {
      return { rarity: rung.rarity, bucket };
    }
  }
  return null;
}

function pick(bucket: readonly string[], rng: Rng): string {
  const cardId = bucket[rng.int(bucket.length)];
  if (cardId === undefined) {
    throw new RangeError('Picked outside a non-empty bucket');
  }
  return cardId;
}
