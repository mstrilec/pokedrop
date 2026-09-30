import type { RarityTier } from '@pokedrop/shared';

export interface RarityStyle {
  label: RarityTier;
  text: string;
  chip: string;
  emphasis: string | null;
}

// Color never carries the tier alone: render `label` wherever these classes are used.
export const RARITY_STYLES: Record<RarityTier, RarityStyle> = {
  Common: {
    label: 'Common',
    text: 'text-rarity-common',
    chip: 'bg-rarity-common-tint border-rarity-common-border text-rarity-common',
    emphasis: null,
  },
  Uncommon: {
    label: 'Uncommon',
    text: 'text-rarity-uncommon',
    chip: 'bg-rarity-uncommon-tint border-rarity-uncommon-border text-rarity-uncommon',
    emphasis: null,
  },
  Rare: {
    label: 'Rare',
    text: 'text-rarity-rare',
    chip: 'bg-rarity-rare-tint border-rarity-rare-border text-rarity-rare',
    emphasis: null,
  },
  'Ultra Rare': {
    label: 'Ultra Rare',
    text: 'text-rarity-ultra',
    chip: 'bg-rarity-ultra-tint border-rarity-ultra-border text-rarity-ultra',
    emphasis: 'border-rarity-ultra-edge shadow-glow-ultra',
  },
  'Secret Rare': {
    label: 'Secret Rare',
    text: 'text-rarity-secret',
    chip: 'bg-rarity-secret-tint border-rarity-secret-border text-rarity-secret',
    emphasis: 'border-rarity-secret-edge shadow-glow-secret',
  },
};
