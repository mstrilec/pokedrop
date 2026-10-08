import type { BasicEnergyType, DeckFormat, RandomDeckShortfall } from '@pokedrop/shared';

export type PoolCard = {
  id: string;
  name: string;
  supertype: string;
  subtypes: string[];
  types: string[];
  evolvesFrom: string | null;
  /** Copies the deck may use: available copies for Owned only, Infinity for Any card. */
  available: number;
};

export type GenerateOptions = {
  format: DeckFormat;
  /** Empty: pick one or two at random among the generatable types that fit. */
  types: BasicEnergyType[];
  deckSize: number;
};

export type Shortfall = RandomDeckShortfall;

export type GenerateResult =
  | { result: 'deck'; types: BasicEnergyType[]; cards: { cardId: string; count: number }[] }
  | Shortfall;
