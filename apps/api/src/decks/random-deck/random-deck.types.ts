import type { BasicEnergyType, DeckFormat, RandomDeckShortfall } from '@pokedrop/shared';

export type PoolCard = {
  id: string;
  name: string;
  supertype: string;
  subtypes: string[];
  types: string[];
  evolvesFrom: string | null;
  available: number;
};

export type GenerateOptions = {
  format: DeckFormat;
  types: BasicEnergyType[];
  deckSize: number;
};

export type Shortfall = RandomDeckShortfall;

export type GenerateResult =
  | { result: 'deck'; types: BasicEnergyType[]; cards: { cardId: string; count: number }[] }
  | Shortfall;
