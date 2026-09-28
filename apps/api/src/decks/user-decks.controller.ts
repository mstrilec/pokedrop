import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { DeckPage } from '@pokedrop/shared';
import { Public } from '../common/decorators/public.decorator.js';
import { DeckListQueryDto } from './decks.dto.js';
import { DecksService } from './decks.service.js';

@ApiTags('decks')
@Public()
@Controller('users/:id/decks')
export class UserDecksController {
  constructor(private readonly decks: DecksService) {}

  @Get()
  list(@Param('id') userId: string, @Query() query: DeckListQueryDto): Promise<DeckPage> {
    return this.decks.listPublic(userId, query);
  }
}
