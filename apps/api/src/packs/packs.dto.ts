import {
  CreatePackTemplateSchema,
  OpenPackRequestSchema,
  PackHistoryQuerySchema,
  UpdatePackTemplateSchema,
} from '@pokedrop/shared';
import { createZodDto } from '../common/zod-dto.js';

export class CreatePackTemplateDto extends createZodDto(
  'CreatePackTemplate',
  CreatePackTemplateSchema,
) {}

export class UpdatePackTemplateDto extends createZodDto(
  'UpdatePackTemplate',
  UpdatePackTemplateSchema,
) {}

export class OpenPackRequestDto extends createZodDto('OpenPackRequest', OpenPackRequestSchema) {}

export class PackHistoryQueryDto extends createZodDto('PackHistoryQuery', PackHistoryQuerySchema) {}
