import type { PackArt } from '@pokedrop/shared';

/** A Base Set card's art by its catalog id, `base1-4` → Charizard. */
export const baseSetImage = (id: string) =>
  `https://images.pokemontcg.io/base1/${id.split('-')[1]}.png`;

export const BASE_SET_LOGO = 'https://images.pokemontcg.io/base1/logo.png';
export const BASE_SET_PACK = 'Base Set Booster Pack';

// Asserted, not parsed: parsing would load zod for one constant.
export const BASE_SET_ART = {
  set: { id: 'base1', name: 'Base', series: 'Base', logoUrl: BASE_SET_LOGO },
  cover: {
    id: 'base1-4',
    name: 'Charizard',
    image: baseSetImage('base1-4'),
    type: 'Fire',
    rarity: 'Rare Holo',
  },
  coverIsDefault: true,
  imageUrl: null,
} as PackArt;
