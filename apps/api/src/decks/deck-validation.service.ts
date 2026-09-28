import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { LegalitiesSchema, type DeckValidation, type Legalities } from '@pokedrop/shared';
import { APP_CONFIG, type AppConfig } from '../config/index.js';
import { InventoryService } from '../inventory/index.js';
import { PrismaService, type TransactionClient } from '../prisma/index.js';
import { validateDeck } from './deck-validator.js';

@Injectable()
export class DeckValidationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Pass the caller's transaction so the verdict describes the rows it just wrote. */
  async validate(deckId: string, client: TransactionClient = this.prisma): Promise<DeckValidation> {
    const deck = await client.deck.findUniqueOrThrow({
      where: { id: deckId },
      select: {
        userId: true,
        format: true,
        ownedOnly: true,
        cards: {
          orderBy: { cardId: 'asc' },
          select: {
            cardId: true,
            count: true,
            card: { select: { name: true, supertype: true, subtypes: true, legalities: true } },
          },
        },
      },
    });

    const available = await this.inventory.availableQuantities(
      deck.userId,
      deck.cards.map((entry) => entry.cardId),
      client,
    );

    return validateDeck({
      format: deck.format,
      ownedOnly: deck.ownedOnly,
      deckSize: this.config.decks.size,
      cards: deck.cards.map(({ cardId, count, card }) => ({
        cardId,
        count,
        name: card.name,
        supertype: card.supertype,
        subtypes: card.subtypes,
        legalities: toLegalities(card.legalities),
      })),
      available,
    });
  }
}

function toLegalities(value: Prisma.JsonValue): Legalities {
  const parsed = LegalitiesSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
}
