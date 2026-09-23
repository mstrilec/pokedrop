import { PriceHistoryQuerySchema } from '@pokedrop/shared';
import { createZodDto } from '../common/zod-dto.js';

/**
 * The wrapper is what ZodValidationPipe looks for and what puts the schema into
 * the OpenAPI document. The schema itself lives in @pokedrop/shared, because the
 * frontend imports it too.
 */
export class PriceHistoryQueryDto extends createZodDto(
  'PriceHistoryQuery',
  PriceHistoryQuerySchema,
) {}
