import type { AppConfig } from '../../config/index.js';
import type { CardDTO, PriceDTO, SetDTO } from './provider.dto.js';
import type { ProviderItemError } from './provider.errors.js';

/**
 * The providers the sync layer knows about.
 *
 * Inferred from the configuration rather than declared beside it, so the enum
 * in env.schema.ts is the single place a provider is named. A second
 * declaration here could drift from the first, and the drift would only show up
 * as a registry miss at boot.
 */
export type CardSourceName = AppConfig['providers']['active'];

export interface FetchCardsParams {
  /** Absent means the whole catalog. PD-42 batches per set. */
  setId?: string;
  page: number;
  pageSize: number;
}

/**
 * One page of cards, rather than the flat array the ticket's signature implies.
 *
 * PD-42 has to resume after a crash and PD-39 has to page across the full
 * catalog; neither is possible if a provider hides pagination behind an array.
 * A provider that loops internally holds an entire catalog in memory before
 * returning anything, and a crash halfway leaves nothing to resume from,
 * because no caller ever saw a page boundary. Returning a page puts the loop in
 * the processor — the only layer that can persist where it got to.
 */
export interface CardPage {
  items: CardDTO[];
  /** Items that failed to parse. Non-fatal by design; see provider.errors.ts. */
  skipped: ProviderItemError[];
  page: number;
  pageSize: number;
  /** Matching cards across every page, not the length of `items`. */
  total: number;
  hasMore: boolean;
}

/**
 * The seam. Everything the application knows about an external card API.
 *
 * `fetchSets` keeps a flat return: 176 sets is one small response, and
 * paginating it would be ceremony with no resume point worth saving.
 *
 * `fetchPrices` is declared here although M4 is its first caller — the ticket
 * requires this interface to be sufficient for price sync as well as catalog
 * sync. Both providers embed prices inside the card payload, so the honest
 * implementation fetches those cards and projects the price blocks out.
 */
export interface CardSourceProvider {
  readonly name: CardSourceName;
  fetchSets(): Promise<SetDTO[]>;
  fetchCards(params: FetchCardsParams): Promise<CardPage>;
  fetchPrices(cardIds: string[]): Promise<PriceDTO[]>;
}

export type CardSourceRegistry = ReadonlyMap<CardSourceName, CardSourceProvider>;

/** The provider named by configuration. What M3 and M4 consumers inject. */
export const CARD_SOURCE_PROVIDER = Symbol('CARD_SOURCE_PROVIDER');

/**
 * Every registered provider, by name.
 *
 * Present from the start although PD-43 is its only consumer: introducing it
 * later would mean editing every call site that had injected the single token,
 * and it costs three lines here.
 */
export const CARD_SOURCE_REGISTRY = Symbol('CARD_SOURCE_REGISTRY');
