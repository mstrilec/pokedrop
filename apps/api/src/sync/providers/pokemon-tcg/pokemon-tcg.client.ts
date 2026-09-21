import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../../config/index.js';
import type {
  CardPage,
  CardSourceName,
  CardSourceProvider,
  FetchCardsParams,
} from '../card-source-provider.js';
import type { CardDTO, PriceDTO, SetDTO } from '../provider.dto.js';
import { ProviderContractError, type ProviderItemError } from '../provider.errors.js';
import { RequestBudgetService } from '../request-budget.service.js';
import { getJson, type PokemonTcgHttpOptions } from './http.js';
import { toCardDTO, toPriceDTOs, toSetDTO } from './pokemon-tcg.mapper.js';
import { ListEnvelopeSchema, RawCardSchema, RawSetSchema } from './pokemon-tcg.schema.js';

const SETS_PAGE_SIZE = 250;
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_ATTEMPTS = 5;

@Injectable()
export class PokemonTcgClient implements CardSourceProvider {
  readonly name: CardSourceName = 'pokemontcg';

  private readonly http: PokemonTcgHttpOptions;

  constructor(@Inject(APP_CONFIG) config: AppConfig, budget: RequestBudgetService) {
    this.http = {
      baseUrl: config.providers.pokemonTcgBaseUrl,
      apiKey: config.providers.pokemonTcgApiKey,
      timeoutMs: REQUEST_TIMEOUT_MS,
      maxAttempts: MAX_ATTEMPTS,
      onRequest: () => budget.record(this.name),
    };
  }

  /**
   * One call. 176 sets fit in a single page, and paginating would be ceremony
   * with no resume point worth saving.
   */
  async fetchSets(): Promise<SetDTO[]> {
    const envelope = this.parseEnvelope(
      await getJson('/sets', { pageSize: SETS_PAGE_SIZE }, this.http),
      '/sets',
    );

    const sets: SetDTO[] = [];
    for (const item of envelope.data) {
      const parsed = RawSetSchema.safeParse(item);
      if (parsed.success) {
        sets.push(toSetDTO(parsed.data));
      }
    }

    return sets;
  }

  async fetchCards(params: FetchCardsParams): Promise<CardPage> {
    const envelope = this.parseEnvelope(
      await getJson(
        '/cards',
        {
          page: params.page,
          pageSize: params.pageSize,
          // The provider's own query syntax. Absent means the whole catalog.
          q: params.setId === undefined ? undefined : `set.id:${params.setId}`,
        },
        this.http,
      ),
      '/cards',
    );

    const items: CardDTO[] = [];
    const skipped: ProviderItemError[] = [];

    for (const item of envelope.data) {
      const parsed = RawCardSchema.safeParse(item);

      if (parsed.success) {
        items.push(toCardDTO(parsed.data));
        continue;
      }

      // One bad card does not discard the 249 beside it. PD-42 counts these
      // into SyncRun.failed and finishes the run as PARTIAL.
      skipped.push({
        provider: this.name,
        itemId: this.idOf(item),
        message: parsed.error.issues[0]?.message ?? 'did not match the card schema',
      });
    }

    return {
      items,
      skipped,
      page: envelope.page,
      pageSize: envelope.pageSize,
      total: envelope.totalCount,
      hasMore: envelope.page * envelope.pageSize < envelope.totalCount,
    };
  }

  /**
   * Prices are embedded in the card object, so this fetches those cards and
   * projects the price blocks out. M4 is the first caller.
   */
  async fetchPrices(cardIds: string[]): Promise<PriceDTO[]> {
    if (cardIds.length === 0) {
      return [];
    }

    const capturedAt = new Date();
    const query = cardIds.map((id) => `id:${id}`).join(' OR ');
    const envelope = this.parseEnvelope(
      await getJson('/cards', { q: query, pageSize: cardIds.length }, this.http),
      '/cards',
    );

    const prices: PriceDTO[] = [];
    for (const item of envelope.data) {
      const parsed = RawCardSchema.safeParse(item);
      if (parsed.success) {
        prices.push(...toPriceDTOs(parsed.data, capturedAt));
      }
    }

    return prices;
  }

  private parseEnvelope(payload: unknown, path: string) {
    const envelope = ListEnvelopeSchema.safeParse(payload);

    if (!envelope.success) {
      throw new ProviderContractError(this.name, `${path} did not return the documented envelope`, {
        cause: envelope.error,
      });
    }

    return envelope.data;
  }

  private idOf(item: unknown): string | null {
    if (typeof item === 'object' && item !== null && 'id' in item) {
      // `'id' in item` already narrows it; an assertion here would be a no-op.
      const { id } = item;
      return typeof id === 'string' ? id : null;
    }

    return null;
  }
}
