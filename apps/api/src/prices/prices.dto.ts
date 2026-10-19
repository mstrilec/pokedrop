import { PriceHistoryQuerySchema } from '@pokedrop/shared';
import { createZodDto } from '../common/zod-dto.js';

export class PriceHistoryQueryDto extends createZodDto(
  'PriceHistoryQuery',
  PriceHistoryQuerySchema,
) {}
