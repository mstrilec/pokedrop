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
import type { DeckDetail, DeckPage } from '@pokedrop/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Public } from '../common/decorators/public.decorator.js';
import type { AuthUser } from '../common/request-auth.js';
import { CreateDeckDto, DeckListQueryDto, UpdateDeckDto } from './decks.dto.js';
import { DecksService } from './decks.service.js';

@ApiTags('decks')
@Controller('decks')
export class DecksController {
  constructor(private readonly decks: DecksService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: DeckListQueryDto): Promise<DeckPage> {
    return this.decks.list(user.id, query);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: CreateDeckDto): Promise<DeckDetail> {
    return this.decks.create(user, body);
  }

  /** Public so a shared deck page renders signed out; the service hides private decks. */
  @Public()
  @Get(':id')
  get(@CurrentUser() viewer: AuthUser | undefined, @Param('id') id: string): Promise<DeckDetail> {
    return this.decks.get(id, viewer);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: UpdateDeckDto,
  ): Promise<DeckDetail> {
    return this.decks.update(user, id, body);
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<void> {
    return this.decks.remove(user, id);
  }
}
