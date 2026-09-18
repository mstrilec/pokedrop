import type { AppConfig } from '../../config/index.js';
import type { CardDTO, PriceDTO, SetDTO } from './provider.dto.js';
import type { ProviderItemError } from './provider.errors.js';

export type CardSourceName = AppConfig['providers']['active'];

export interface FetchCardsParams {
  setId?: string;
  page: number;
  pageSize: number;
}

export interface CardPage {
  items: CardDTO[];

  skipped: ProviderItemError[];
  page: number;
  pageSize: number;

  total: number;
  hasMore: boolean;
}

export interface CardSourceProvider {
  readonly name: CardSourceName;
  fetchSets(): Promise<SetDTO[]>;
  fetchCards(params: FetchCardsParams): Promise<CardPage>;
  fetchPrices(cardIds: string[]): Promise<PriceDTO[]>;
}

export type CardSourceRegistry = ReadonlyMap<CardSourceName, CardSourceProvider>;

export const CARD_SOURCE_PROVIDER = Symbol('CARD_SOURCE_PROVIDER');

export const CARD_SOURCE_REGISTRY = Symbol('CARD_SOURCE_REGISTRY');
