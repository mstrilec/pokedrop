import { CreatePackTemplateSchema, UpdatePackTemplateSchema } from '@pokedrop/shared';
import { createZodDto } from '../common/zod-dto.js';

export class CreatePackTemplateDto extends createZodDto(
  'CreatePackTemplate',
  CreatePackTemplateSchema,
) {}

export class UpdatePackTemplateDto extends createZodDto(
  'UpdatePackTemplate',
  UpdatePackTemplateSchema,
) {}
