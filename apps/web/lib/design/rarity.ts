import type { RarityTier } from '@pokedrop/shared';

export interface RarityStyle {
  label: RarityTier;
  text: string;
  chip: string;
  emphasis: string | null;
  /** The tier's color as a CSS value, for borders and glows drawn outside utilities. */
  color: string;
}

// Color never carries the tier alone: render `label` wherever these classes are used.
export const RARITY_STYLES: Record<RarityTier, RarityStyle> = {
  Common: {
    color: 'var(--c-com)',
    label: 'Common',
    text: 'text-rarity-common',
    chip: 'bg-rarity-common-tint border-rarity-common-border text-rarity-common',
    emphasis: null,
  },
  Uncommon: {
    color: 'var(--c-unc)',
    label: 'Uncommon',
    text: 'text-rarity-uncommon',
    chip: 'bg-rarity-uncommon-tint border-rarity-uncommon-border text-rarity-uncommon',
    emphasis: null,
  },
  Rare: {
    color: 'var(--c-rare)',
    label: 'Rare',
    text: 'text-rarity-rare',
    chip: 'bg-rarity-rare-tint border-rarity-rare-border text-rarity-rare',
    emphasis: null,
  },
  'Ultra Rare': {
    color: 'var(--c-ultra)',
    label: 'Ultra Rare',
    text: 'text-rarity-ultra',
    chip: 'bg-rarity-ultra-tint border-rarity-ultra-border text-rarity-ultra',
    emphasis: 'border-rarity-ultra-edge shadow-glow-ultra',
  },
  'Secret Rare': {
    color: 'var(--c-secret)',
    label: 'Secret Rare',
    text: 'text-rarity-secret',
    chip: 'bg-rarity-secret-tint border-rarity-secret-border text-rarity-secret',
    emphasis: 'border-rarity-secret-edge shadow-glow-secret',
  },
};

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

export function isHighRarity(tier: RarityTier): boolean {
  return tier === 'Ultra Rare' || tier === 'Secret Rare';
}
