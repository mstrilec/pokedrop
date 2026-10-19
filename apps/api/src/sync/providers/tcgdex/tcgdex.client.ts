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
import { getJson, type TcgdexHttpOptions } from './http.js';
import { toCardDTO, toPriceDTOs, toSetDTO } from './tcgdex.mapper.js';
import {
  RawCardBriefListSchema,
  RawCardSchema,
  RawSetBriefListSchema,
  RawSetSchema,
  type RawCardBrief,
} from './tcgdex.schema.js';

const REQUEST_TIMEOUT_MS = 20_000;
const MAX_ATTEMPTS = 3;

const HYDRATION_CONCURRENCY = 8;

const LANGUAGE = 'en';

const INDEX_TTL_MS = 3_600_000;

interface CardIndex {
  briefs: RawCardBrief[];
  fetchedAt: number;
}

@Injectable()
export class TcgdexClient implements CardSourceProvider {
  readonly name: CardSourceName = 'tcgdex';

  private readonly http: TcgdexHttpOptions;

  private index: CardIndex | null = null;

  private indexInFlight: Promise<CardIndex> | null = null;

  constructor(@Inject(APP_CONFIG) config: AppConfig, budget: RequestBudgetService) {
    this.http = {
      baseUrl: config.providers.tcgdexBaseUrl,
      language: LANGUAGE,
      timeoutMs: REQUEST_TIMEOUT_MS,
      maxAttempts: MAX_ATTEMPTS,
      onRequest: () => budget.record(this.name),
    };
  }

  async fetchSets(): Promise<SetDTO[]> {
    const briefs = RawSetBriefListSchema.safeParse(await this.get('/sets'));

    if (!briefs.success) {
      throw new ProviderContractError(this.name, '/sets did not return an array of sets', {
        cause: briefs.error,
      });
    }

    const sets: SetDTO[] = [];
    for (const brief of briefs.data) {
      const payload = await this.get(`/sets/${encodeURIComponent(brief.id)}`);
      const parsed = RawSetSchema.safeParse(payload);
      if (parsed.success) {
        sets.push(toSetDTO(parsed.data));
      }
    }

    return sets;
  }

  async fetchCards(params: FetchCardsParams): Promise<CardPage> {
    const index = await this.loadIndex();

    const scope =
      params.setId === undefined
        ? index.briefs
        : index.briefs.filter((brief) => this.setIdOf(brief.id) === params.setId);

    const start = (params.page - 1) * params.pageSize;
    const slice = scope.slice(start, start + params.pageSize);

    const items: CardDTO[] = [];
    const skipped: ProviderItemError[] = [];

    const hydratable: RawCardBrief[] = [];
    for (const brief of slice) {
      if (brief.image === undefined) {
        skipped.push({ provider: this.name, itemId: brief.id, message: 'card has no image' });
      } else {
        hydratable.push(brief);
      }
    }

    const queue = [...hydratable];
    const workers = Array.from({ length: HYDRATION_CONCURRENCY }, async () => {
      for (;;) {
        const brief = queue.shift();
        if (brief === undefined) return;

        const card = await this.hydrate(brief);
        if ('error' in card) skipped.push(card.error);
        else items.push(card.item);
      }
    });

    await Promise.all(workers);

    // The pool finishes out of order and a page has to be stable, because
    // PD-42 resumes from a page number.
    items.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

    return {
      items,
      skipped,
      page: params.page,
      pageSize: params.pageSize,
      total: scope.length,
      hasMore: start + params.pageSize < scope.length,
    };
  }

  async fetchPrices(cardIds: string[]): Promise<PriceDTO[]> {
    if (cardIds.length === 0) {
      return [];
    }

    const capturedAt = new Date();
    const queue = [...cardIds];
    const prices: PriceDTO[] = [];

    const workers = Array.from({ length: HYDRATION_CONCURRENCY }, async () => {
      for (;;) {
        const id = queue.shift();
        if (id === undefined) return;

        const parsed = RawCardSchema.safeParse(await this.get(`/cards/${encodeURIComponent(id)}`));
        if (parsed.success) {
          prices.push(...toPriceDTOs(parsed.data, capturedAt));
        }
      }
    });

    await Promise.all(workers);
    return prices;
  }

  /** Sorted by id, so the same page returns the same cards on a resume. */
  private async loadIndex(): Promise<CardIndex> {
    const now = Date.now();
    if (this.index !== null && now - this.index.fetchedAt < INDEX_TTL_MS) {
      return this.index;
    }

    this.indexInFlight ??= this.fetchIndex().finally(() => {
      this.indexInFlight = null;
    });

    this.index = await this.indexInFlight;
    return this.index;
  }

  private async fetchIndex(): Promise<CardIndex> {
    const parsed = RawCardBriefListSchema.safeParse(await this.get('/cards'));

    if (!parsed.success) {
      throw new ProviderContractError(this.name, '/cards did not return an array of cards', {
        cause: parsed.error,
      });
    }

    const briefs = [...parsed.data].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return { briefs, fetchedAt: Date.now() };
  }

  private async hydrate(
    brief: RawCardBrief,
  ): Promise<{ item: CardDTO } | { error: ProviderItemError }> {
    const payload = await this.get(`/cards/${encodeURIComponent(brief.id)}`);

    if (payload === null) {
      return {
        error: { provider: this.name, itemId: brief.id, message: 'card is in the index but 404s' },
      };
    }

    const parsed = RawCardSchema.safeParse(payload);
    if (!parsed.success) {
      return {
        error: {
          provider: this.name,
          itemId: brief.id,
          message: parsed.error.issues[0]?.message ?? 'did not match the card schema',
        },
      };
    }

    const { image } = parsed.data;
    if (image === undefined) {
      return {
        error: { provider: this.name, itemId: brief.id, message: 'card has no image' },
      };
    }

    // A payload can pass RawCardSchema and still fail the DTO. Without this catch the ZodError
    // escapes the pool and costs the whole page rather than one card.
    try {
      return { item: toCardDTO({ ...parsed.data, image }) };
    } catch (error) {
      return {
        error: {
          provider: this.name,
          itemId: brief.id,
          message: error instanceof Error ? error.message : 'failed to map card to the DTO shape',
        },
      };
    }
  }

  /** `exu-%3F` is a real id. encodeURIComponent turns it into `exu-%253F`, which
   * is the URL that answers 200 - the double encoding is correct, not a bug. */
  private get(path: string): Promise<unknown> {
    return getJson(path, this.http);
  }

  private setIdOf(cardId: string): string {
    const cut = cardId.lastIndexOf('-');
    return cut === -1 ? cardId : cardId.slice(0, cut);
  }
}
