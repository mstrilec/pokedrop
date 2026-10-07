import type { RarityTier } from '../enums.js';

// The provider's rarity strings (44 in the mirror on 2026-10-04) folded into the five tiers.
// Order matters: "Hyper Rare" must reach Secret before "Rare" claims it.
const TIER_RULES: [RegExp, RarityTier][] = [
  [/secret|hyper|rainbow|special illustration|shiny ultra/i, 'Secret Rare'],
  [
    /ultra|double rare|illustration rare|\bex\b|\bgx\b|\bv(max|star)?\b|lv\.x|break|prime|prism|star|legend|radiant|amazing|\bace\b|shining|shiny|gallery|mega|black white|futuristic/i,
    'Ultra Rare',
  ],
  [/uncommon/i, 'Uncommon'],
  [/^common$/i, 'Common'],
];

export function rarityTier(rarity: string | null): RarityTier {
  if (!rarity) return 'Common';
  return TIER_RULES.find(([pattern]) => pattern.test(rarity))?.[1] ?? 'Rare';
}
