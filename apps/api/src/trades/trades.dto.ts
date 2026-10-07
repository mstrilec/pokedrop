import {
  AdminTradeQuerySchema,
  CounterTradeSchema,
  ProposeTradeSchema,
  TradeInboxQuerySchema,
  VoidTradeSchema,
} from '@pokedrop/shared';
import { createZodDto } from '../common/zod-dto.js';

export class ProposeTradeDto extends createZodDto('ProposeTrade', ProposeTradeSchema) {}

export class CounterTradeDto extends createZodDto('CounterTrade', CounterTradeSchema) {}

export class VoidTradeDto extends createZodDto('VoidTrade', VoidTradeSchema) {}

export class TradeInboxQueryDto extends createZodDto('TradeInboxQuery', TradeInboxQuerySchema) {}

export class AdminTradeQueryDto extends createZodDto('AdminTradeQuery', AdminTradeQuerySchema) {}
