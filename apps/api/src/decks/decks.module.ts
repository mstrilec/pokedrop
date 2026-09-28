import { Module } from '@nestjs/common';
import { DecksController } from './decks.controller.js';
import { DecksService } from './decks.service.js';

@Module({
  controllers: [DecksController],
  providers: [DecksService],
})
export class DecksModule {}
