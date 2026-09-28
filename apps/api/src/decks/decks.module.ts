import { Module } from '@nestjs/common';
import { DecksController } from './decks.controller.js';
import { DecksService } from './decks.service.js';
import { UserDecksController } from './user-decks.controller.js';

@Module({
  controllers: [DecksController, UserDecksController],
  providers: [DecksService],
})
export class DecksModule {}
