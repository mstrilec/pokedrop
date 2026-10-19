import type { SlotConfig } from '../entities/pack.js';

export type Rung = { rarity: string; weight: number };

/** Computed, never read from key order: jsonb stores object keys in its own order. */
export function ladderOf(weights: Record<string, number>): Rung[] {
  return Object.entries(weights)
    .filter(([, weight]) => weight > 0)
    .map(([rarity, weight]) => ({ rarity, weight }))
    .sort((a, b) => b.weight - a.weight || compare(a.rarity, b.rarity));
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export type SlotOdds = { count: number; odds: { rarity: string; share: number }[] };

export function slotOdds(slots: SlotConfig['slots']): SlotOdds[] {
  return slots.map((slot) => {
    const ladder = ladderOf(slot.weights);
    const total = ladder.reduce((sum, rung) => sum + rung.weight, 0);
    return {
      count: slot.count,
      odds: ladder.map((rung) => ({ rarity: rung.rarity, share: rung.weight / total })),
    };
  });
}

export type PackRate = {
  rarity: string;
  expected: number;
  atLeastOne: number;
};

export function packRates(slots: SlotConfig['slots']): PackRate[] {
  const byRarity = new Map<string, { expected: number; miss: number }>();
  for (const slot of slotOdds(slots)) {
    for (const { rarity, share } of slot.odds) {
      const rate = byRarity.get(rarity) ?? { expected: 0, miss: 1 };
      rate.expected += slot.count * share;
      rate.miss *= (1 - share) ** slot.count;
      byRarity.set(rarity, rate);
    }
  }
  return [...byRarity.entries()]
    .map(([rarity, rate]) => ({ rarity, expected: rate.expected, atLeastOne: 1 - rate.miss }))
    .sort((a, b) => b.expected - a.expected || compare(a.rarity, b.rarity));
}
