import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/index.js';
import { DeckValidationService } from './deck-validation.service.js';
import { DecksController } from './decks.controller.js';
import { DecksService } from './decks.service.js';
import { RandomDeckController } from './random-deck/random-deck.controller.js';
import { RandomDeckService } from './random-deck/random-deck.service.js';
import { UserDecksController } from './user-decks.controller.js';

@Module({
  imports: [InventoryModule],
  // RandomDeckController first: `decks/random` must not be taken by `decks/:id`.
  controllers: [RandomDeckController, DecksController, UserDecksController],
  providers: [DecksService, DeckValidationService, RandomDeckService],
})
export class DecksModule {}
