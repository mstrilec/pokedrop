import { AuditQuerySchema } from '@pokedrop/shared';
import { createZodDto } from '../common/zod-dto.js';

export class AuditQueryDto extends createZodDto('AuditQuery', AuditQuerySchema) {}
