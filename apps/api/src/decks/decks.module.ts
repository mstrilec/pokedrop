import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/index.js';
import { DeckValidationService } from './deck-validation.service.js';
import { DecksController } from './decks.controller.js';
import { DecksService } from './decks.service.js';
import { UserDecksController } from './user-decks.controller.js';

@Module({
  imports: [InventoryModule],
  controllers: [DecksController, UserDecksController],
  providers: [DecksService, DeckValidationService],
})
export class DecksModule {}
