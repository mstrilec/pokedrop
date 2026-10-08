import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import {
  BASIC_ENERGY_TYPES,
  basicEnergyTypeOf,
  DECK_FORMATS,
  RandomDeckResponseSchema,
  validateDeck,
  type DeckFormat,
  type DeckValidation,
  type RandomDeckRequest,
  type RandomDeckResponse,
  type RandomDeckTypes,
} from '@pokedrop/shared';
import { createHash, randomBytes } from 'node:crypto';
import { PLAYABLE_CARD_SELECT, toLegalities, toPlayableCard } from '../../common/card-summary.js';
import type { AuthUser } from '../../common/request-auth.js';
import { APP_CONFIG, type AppConfig } from '../../config/index.js';
import { SeededRng } from '../../packs/pack-rng.js';
import { PrismaService } from '../../prisma/index.js';
import { generateDeck } from './random-deck.generator.js';
import { loadPool } from './random-deck.pool.js';
import type { GenerateResult, PoolCard } from './random-deck.types.js';

const ATTEMPTS = 5;

type DeckResult = Extract<GenerateResult, { result: 'deck' }>;

@Injectable()
export class RandomDeckService {
  private readonly logger = new Logger(RandomDeckService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Read from the ~180 basic Energy printings, not from the whole pool. */
  async types(): Promise<RandomDeckTypes> {
    const energies = await this.prisma.card.findMany({
      where: { supertype: 'Energy', subtypes: { has: 'Basic' } },
      select: { name: true, legalities: true },
    });
    const legal = energies.map((e) => ({
      type: basicEnergyTypeOf(e.name),
      legalities: toLegalities(e.legalities),
    }));
    return Object.fromEntries(
      DECK_FORMATS.map((format) => [
        format,
        BASIC_ENERGY_TYPES.filter((type) =>
          legal.some((e) => e.type === type && e.legalities[format] === 'Legal'),
        ),
      ]),
    ) as RandomDeckTypes;
  }

  async generate(user: AuthUser, request: RandomDeckRequest): Promise<RandomDeckResponse> {
    if (request.seed !== undefined && this.config.app.isProduction) {
      throw new BadRequestException('seed is only accepted in development');
    }
    // Decided by the format, not the member's pool: a type they own no Energy of gets the
    // shortfall sentence, not this 400.
    const allowed = (await this.types())[request.format];
    for (const type of request.types) {
      if (!allowed.includes(type)) {
        throw new BadRequestException(`No basic ${type} Energy is legal in ${request.format}`);
      }
    }

    const pool = await loadPool(this.prisma, {
      format: request.format,
      userId: request.ownedOnly ? user.id : null,
    });
    const base = request.seed ?? randomBytes(16).toString('hex');
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      const seed = createHash('sha256')
        .update(attempt === 0 ? base : `${base}:${attempt}`)
        .digest();
      const result = generateDeck(
        pool,
        { format: request.format, types: request.types, deckSize: this.config.decks.size },
        new SeededRng(seed),
      );
      if (result.result === 'shortfall') return result;
      const verdict = await this.verdict(request, result, pool);
      if (verdict.valid) return this.answer(request.format, result);
      this.logger.error(
        { seed: base, attempt, issues: verdict.issues },
        'A random deck failed validation',
      );
    }
    throw new InternalServerErrorException('Could not generate a legal deck');
  }

  private async verdict(
    request: RandomDeckRequest,
    result: DeckResult,
    pool: PoolCard[],
  ): Promise<DeckValidation> {
    const rows = await this.prisma.card.findMany({
      where: { id: { in: result.cards.map((c) => c.cardId) } },
      select: { id: true, name: true, supertype: true, subtypes: true, legalities: true },
    });
    const info = new Map(rows.map((row) => [row.id, row]));
    const available = new Map(pool.map((card) => [card.id, card.available]));
    return validateDeck({
      format: request.format,
      ownedOnly: request.ownedOnly,
      deckSize: this.config.decks.size,
      cards: result.cards.flatMap(({ cardId, count }) => {
        const row = info.get(cardId);
        return row
          ? [
              {
                cardId,
                count,
                name: row.name,
                supertype: row.supertype,
                subtypes: row.subtypes,
                legalities: toLegalities(row.legalities),
              },
            ]
          : [];
      }),
      // Any card: nothing is owned for the check, so ownership is only ever a warning.
      available: request.ownedOnly
        ? new Map(result.cards.map(({ cardId }) => [cardId, available.get(cardId) ?? 0]))
        : new Map(),
    });
  }

  private async answer(format: DeckFormat, result: DeckResult): Promise<RandomDeckResponse> {
    const rows = await this.prisma.card.findMany({
      where: { id: { in: result.cards.map((c) => c.cardId) } },
      select: PLAYABLE_CARD_SELECT,
    });
    const card = new Map(rows.map((row) => [row.id, toPlayableCard(row)]));
    return RandomDeckResponseSchema.parse({
      result: 'deck',
      format,
      types: result.types,
      cards: result.cards.map(({ cardId, count }) => ({ cardId, count, card: card.get(cardId) })),
    });
  }
}
