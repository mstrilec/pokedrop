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

/**
 * Eight. Nothing failed at sixteen and no 429 was seen at any level, so this is
 * not a limit the service imposed - it is one this project chose. TCGdex is
 * free and keyless and docs/PRD.md section 2 commits this project to free
 * infrastructure; being a guest on it is a constraint. Eight sweeps the catalog
 * far faster than the primary manages, and the remaining headroom is not ours
 * to take. Note that 8 is an HTTP rate, not a sweep rate: a full catalog takes
 * 15 to 25 minutes, because each page also opens a transaction and upserts 250
 * rows between fetches.
 */
const HYDRATION_CONCURRENCY = 8;

/**
 * English only. The 14-language path is documented in docs/Architecture.md
 * section 3 and built by nothing in v1; hardcoding it here keeps the decision
 * visible instead of hiding it behind an environment variable nobody sets.
 */
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

  /**
   * One request for the list plus one per set - 221 in all, about 30 seconds.
   * The list carries neither `releaseDate` nor `serie`, and SetDTO requires
   * both, so there is no cheaper shape available.
   */
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

  /**
   * TCGdex has no bulk path to full cards: every filtered endpoint returns
   * briefs. So a page is a slice of the brief index, hydrated one card at a
   * time through a bounded pool.
   *
   * `setId` narrows the index rather than issuing a different request, because
   * `/cards?set=` returns briefs too - the hydration cost is identical either
   * way.
   */
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

    // A brief with no image cannot become a CardDTO - imageSmall is a
    // non-nullable URL - so it is reported rather than fetched. 1 749 of 23 736
    // are in that state, and spending a request on each to fail anyway would
    // add seven minutes to a sweep.
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

  /**
   * Sorted by id, so a page boundary is a property of the catalog rather than
   * of the order this endpoint happened to answer in - the same page returns
   * the same 250 cards on a resume.
   *
   * Cached for an hour so one sweep sees one snapshot. A resume after that
   * refetches, and if cards were published in between the boundaries shift:
   * some cards are fetched twice, which the guarded upsert absorbs, and some are
   * missed, which the next sweep picks up. That is how this mirror already
   * converges across runs.
   *
   * The TTL is checked on every `fetchCards` call, not only on a resume, so a
   * single run lasting over an hour refetches mid-run - reachable, because the
   * sync processor sets `hasMore` on any page failure and keeps going with no
   * page ceiling. `total` and `hasMore` are then recomputed against the new
   * index, so a shrunken index can end the page loop early.
   */
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

    // Destructured rather than tested in place, so the narrowing survives into
    // the spread below without an assertion.
    const { image } = parsed.data;
    if (image === undefined) {
      return {
        error: { provider: this.name, itemId: brief.id, message: 'card has no image' },
      };
    }

    // RawCardSchema and CardDTOSchema are two different contracts: a payload
    // satisfying the raw one is not guaranteed to satisfy the DTO one, because
    // the raw schema exists to describe what TCGdex sends, not to mirror every
    // constraint the DTO imposes. A weakness with no `value` was exactly this
    // gap - RawTypeValueSchema.value used to be optional, so such a card passed
    // safeParse here and then threw a raw ZodError out of toCardDTO, which
    // nothing caught: the pool worker rejected, Promise.all rejected, and
    // fetchCards rejected - costing the whole 250-card page rather than the one
    // card (pop1-9, pop1-11, pop2-6 on page 45). That specific hole is closed,
    // but rarity being `''` against RaritySchema's min(1), a dexId below 1, a
    // non-integer hp, or a non-URL image would all fail the same way, so this
    // catch is what keeps any future DTO-only constraint from taking its page
    // down with it.
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
