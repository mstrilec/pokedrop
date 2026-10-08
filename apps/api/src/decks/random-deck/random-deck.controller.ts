import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  RandomDeckResponseSchema,
  RandomDeckTypesSchema,
  type RandomDeckResponse,
  type RandomDeckTypes,
} from '@pokedrop/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Doc, returns } from '../../common/openapi.js';
import type { AuthUser } from '../../common/request-auth.js';
import { MODERATE_THROTTLE } from '../../common/throttle.js';
import { RandomDeckRequestDto } from '../decks.dto.js';
import { RandomDeckService } from './random-deck.service.js';

@ApiTags('decks')
@Controller('decks/random')
export class RandomDeckController {
  constructor(private readonly random: RandomDeckService) {}

  @Doc(
    'The energy types each format can generate a random deck of',
    returns('RandomDeckTypes', RandomDeckTypesSchema),
  )
  @Get('types')
  types(): Promise<RandomDeckTypes> {
    return this.random.types();
  }

  @Doc(
    'Generate a random legal deck for the caller; nothing is saved',
    returns('RandomDeckResponse', RandomDeckResponseSchema),
  )
  @HttpCode(HttpStatus.OK)
  @Throttle(MODERATE_THROTTLE)
  @Post()
  generate(
    @CurrentUser() user: AuthUser,
    @Body() body: RandomDeckRequestDto,
  ): Promise<RandomDeckResponse> {
    return this.random.generate(user, body);
  }
}
