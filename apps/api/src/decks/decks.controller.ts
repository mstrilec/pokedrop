import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type {
  DeckDetail,
  DeckPage,
  DeckSaveResult,
  DeckStats,
  DeckValidation,
} from '@pokedrop/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Public } from '../common/decorators/public.decorator.js';
import type { AuthUser } from '../common/request-auth.js';
import { CreateDeckDto, DeckListQueryDto, UpdateDeckDto } from './decks.dto.js';
import { DecksService } from './decks.service.js';
import { Doc, returns } from '../common/openapi.js';
import {
  DeckDetailSchema,
  DeckPageSchema,
  DeckSaveResultSchema,
  DeckStatsSchema,
  DeckValidationSchema,
} from '@pokedrop/shared';

@ApiTags('decks')
@Controller('decks')
export class DecksController {
  constructor(private readonly decks: DecksService) {}

  @Doc("The caller's own decks", returns('DeckPage', DeckPageSchema))
  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: DeckListQueryDto): Promise<DeckPage> {
    return this.decks.list(user.id, query);
  }

  @Doc('Create a deck', returns('DeckSaveResult', DeckSaveResultSchema))
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: CreateDeckDto): Promise<DeckSaveResult> {
    return this.decks.create(user, body);
  }

  /** Public so a shared deck page renders signed out; the service hides private decks. */
  @Public()
  @Doc(
    'One deck with its cards: public decks for anyone, private ones for their owner',
    returns('DeckDetail', DeckDetailSchema),
  )
  @Get(':id')
  get(@CurrentUser() viewer: AuthUser | undefined, @Param('id') id: string): Promise<DeckDetail> {
    return this.decks.get(id, viewer);
  }

  @Public()
  @Doc("A deck's curve, type and energy breakdown", returns('DeckStats', DeckStatsSchema))
  @Get(':id/stats')
  stats(@CurrentUser() viewer: AuthUser | undefined, @Param('id') id: string): Promise<DeckStats> {
    return this.decks.stats(id, viewer);
  }

  @Doc(
    'Rename, re-mode or replace the cards of an owned deck',
    returns('DeckSaveResult', DeckSaveResultSchema),
  )
  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: UpdateDeckDto,
  ): Promise<DeckSaveResult> {
    return this.decks.update(user, id, body);
  }

  @Doc("Copy a visible deck into the caller's own", returns('DeckSaveResult', DeckSaveResultSchema))
  @Post(':id/clone')
  clone(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<DeckSaveResult> {
    return this.decks.clone(user, id);
  }

  @HttpCode(HttpStatus.OK)
  @Doc(
    'Validate an owned deck against format and copy rules',
    returns('DeckValidation', DeckValidationSchema),
  )
  @Post(':id/validate')
  validate(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<DeckValidation> {
    return this.decks.validate(user, id);
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Doc('Delete an owned deck')
  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<void> {
    return this.decks.remove(user, id);
  }
}
