import { WalletQuerySchema } from '@pokedrop/shared';
import { createZodDto } from '../common/zod-dto.js';

export class WalletQueryDto extends createZodDto('WalletQuery', WalletQuerySchema) {}
