import { NotificationListQuerySchema } from '@pokedrop/shared';
import { createZodDto } from '../common/zod-dto.js';

export class NotificationListQueryDto extends createZodDto(
  'NotificationListQuery',
  NotificationListQuerySchema,
) {}
