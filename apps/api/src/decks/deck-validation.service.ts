import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { validateDeck, type DeckValidation } from '@pokedrop/shared';
import { toLegalities } from '../common/card-summary.js';
import { APP_CONFIG, type AppConfig } from '../config/index.js';
import { InventoryService } from '../inventory/index.js';
import { PrismaService, type TransactionClient } from '../prisma/index.js';

@Injectable()
export class DeckValidationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Pass the caller's transaction so the verdict describes the rows it just wrote. */
  async validate(deckId: string, client: TransactionClient = this.prisma): Promise<DeckValidation> {
    const deck = await client.deck.findUnique({
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

    if (deck === null) {
      throw new NotFoundException('Deck not found');
    }

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
