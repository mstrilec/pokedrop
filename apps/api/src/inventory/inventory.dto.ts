import { InventoryQuerySchema, OwnedQuerySchema } from '@pokedrop/shared';
import { createZodDto } from '../common/zod-dto.js';

export class InventoryQueryDto extends createZodDto('InventoryQuery', InventoryQuerySchema) {}

export class OwnedQueryDto extends createZodDto('OwnedQuery', OwnedQuerySchema) {}
