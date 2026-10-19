import { CardSearchQuerySchema } from '@pokedrop/shared';
import { createZodDto } from '../common/zod-dto.js';

export class CardSearchQueryDto extends createZodDto('CardSearchQuery', CardSearchQuerySchema) {}
