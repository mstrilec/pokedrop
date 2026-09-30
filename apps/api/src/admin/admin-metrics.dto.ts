import { AdminMetricsQuerySchema } from '@pokedrop/shared';
import { createZodDto } from '../common/zod-dto.js';

export class AdminMetricsQueryDto extends createZodDto(
  'AdminMetricsQuery',
  AdminMetricsQuerySchema,
) {}
