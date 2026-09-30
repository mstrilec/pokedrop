import {
  Circle,
  Cog,
  Droplet,
  Eye,
  Flame,
  FlameKindling,
  HandFist,
  Leaf,
  type LucideIcon,
  Moon,
  Sparkles,
  Zap,
} from 'lucide-react';

export const ENERGY_TYPES = [
  'Fire',
  'Water',
  'Grass',
  'Lightning',
  'Psychic',
  'Fighting',
  'Darkness',
  'Metal',
  'Dragon',
  'Fairy',
  'Colorless',
] as const;
export type EnergyType = (typeof ENERGY_TYPES)[number];

export interface EnergyStyle {
  label: EnergyType;
  icon: LucideIcon;
  text: string;
  /** For `bg-card-face`: pass as the `--energy` custom property. */
  face: string;
}

// Color never carries the type alone: render `icon` or `label` beside it.
export const ENERGY_STYLES: Record<EnergyType, EnergyStyle> = {
  Fire: { label: 'Fire', icon: Flame, text: 'text-energy-fire', face: 'var(--e-fire)' },
  Water: { label: 'Water', icon: Droplet, text: 'text-energy-water', face: 'var(--e-water)' },
  Grass: { label: 'Grass', icon: Leaf, text: 'text-energy-grass', face: 'var(--e-grass)' },
  Lightning: {
    label: 'Lightning',
    icon: Zap,
    text: 'text-energy-lightning',
    face: 'var(--e-lightning)',
  },
  Psychic: { label: 'Psychic', icon: Eye, text: 'text-energy-psychic', face: 'var(--e-psychic)' },
  Fighting: {
    label: 'Fighting',
    icon: HandFist,
    text: 'text-energy-fighting',
    face: 'var(--e-fighting)',
  },
  Darkness: {
    label: 'Darkness',
    icon: Moon,
    text: 'text-energy-darkness',
    face: 'var(--e-darkness)',
  },
  Metal: { label: 'Metal', icon: Cog, text: 'text-energy-metal', face: 'var(--e-metal)' },
  Dragon: {
    label: 'Dragon',
    icon: FlameKindling,
    text: 'text-energy-dragon',
    face: 'var(--e-dragon)',
  },
  Fairy: { label: 'Fairy', icon: Sparkles, text: 'text-energy-fairy', face: 'var(--e-fairy)' },
  Colorless: {
    label: 'Colorless',
    icon: Circle,
    text: 'text-energy-colorless',
    face: 'var(--e-colorless)',
  },
};

// Card types arrive as the provider's strings; anything unrecognised reads as Colorless.
export function energyStyle(type: string): EnergyStyle {
  return (ENERGY_TYPES as readonly string[]).includes(type)
    ? ENERGY_STYLES[type as EnergyType]
    : ENERGY_STYLES.Colorless;
}
