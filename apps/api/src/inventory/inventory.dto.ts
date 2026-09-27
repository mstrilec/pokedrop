import { InventoryQuerySchema } from '@pokedrop/shared';
import { createZodDto } from '../common/zod-dto.js';

export class InventoryQueryDto extends createZodDto('InventoryQuery', InventoryQuerySchema) {}
