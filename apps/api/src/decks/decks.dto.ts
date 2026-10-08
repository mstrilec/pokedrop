import {
  CreateDeckSchema,
  DeckListQuerySchema,
  RandomDeckRequestSchema,
  UpdateDeckSchema,
} from '@pokedrop/shared';
import { createZodDto } from '../common/zod-dto.js';

export class CreateDeckDto extends createZodDto('CreateDeck', CreateDeckSchema) {}

export class UpdateDeckDto extends createZodDto('UpdateDeck', UpdateDeckSchema) {}

export class DeckListQueryDto extends createZodDto('DeckListQuery', DeckListQuerySchema) {}

export class RandomDeckRequestDto extends createZodDto(
  'RandomDeckRequest',
  RandomDeckRequestSchema,
) {}
