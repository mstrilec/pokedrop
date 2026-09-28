import {
  BadRequestException,
  ForbiddenException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ERROR_CODES,
  type ProposeTrade,
  type Trade,
  type TradeLine,
  type TradeNotificationType,
} from '@pokedrop/shared';
import { AuditService } from '../audit/index.js';
import { domainError } from '../common/errors/domain-error.js';
import type { AuthUser } from '../common/request-auth.js';
import { InventoryService } from '../inventory/index.js';
import { NotificationsService } from '../notifications/index.js';
import { PrismaService } from '../prisma/index.js';
import { TradeCloseService } from './trade-close.service.js';
import { TRADE_SELECT, toTrade, tradeLines, type TradeRow } from './trade-row.js';

type Terms = { offered: TradeLine[]; requested: TradeLine[]; currencyFromInitiator: number };

type Role = 'initiator' | 'recipient';

/** The trade is visible to both parties, so the wrong one gets an honest 403. */
function assertRole(trade: TradeRow, user: AuthUser, role: Role): void {
  const allowed = role === 'initiator' ? trade.initiatorId : trade.recipientId;
  if (allowed !== user.id) {
    throw new ForbiddenException(`Only the ${role} can do this`);
  }
}

function counterparty(trade: TradeRow, userId: string): string {
  return trade.initiatorId === userId ? trade.recipientId : trade.initiatorId;
}

@Injectable()
export class TradesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly closer: TradeCloseService,
  ) {}

  async propose(user: AuthUser, input: ProposeTrade): Promise<Trade> {
    if (input.recipientId === user.id) {
      throw new BadRequestException('You cannot trade with yourself');
    }
    const recipient = await this.prisma.user.findUnique({
      where: { id: input.recipientId },
      select: { id: true },
    });
    if (recipient === null) {
      throw new NotFoundException('User not found');
    }
    await this.assertTerms(user.id, input);

    const row = await this.prisma.withTransaction(async (tx) => {
      const created = await tx.trade.create({
        data: {
          initiatorId: user.id,
          recipientId: input.recipientId,
          currencyFromInitiator: input.currencyFromInitiator,
          currencyFromRecipient: input.currencyFromRecipient,
          items: { createMany: { data: tradeLines(input) } },
        },
        select: TRADE_SELECT,
      });
      await this.inventory.lock(tx, user.id, input.offered);
      await this.audit.record(tx, {
        actorId: user.id,
        action: 'trade.propose',
        entity: 'Trade',
        entityId: created.id,
        meta: { from: null, to: 'PENDING', counteredTradeId: null },
      });
      return created;
    });

    await this.notify([row.recipientId], 'trade.proposed', row.id, user.id);
    return toTrade(row);
  }

  decline(user: AuthUser, id: string): Promise<Trade> {
    return this.finish(user, id, {
      role: 'recipient',
      to: 'DECLINED',
      action: 'trade.decline',
      notify: 'trade.declined',
    });
  }

  cancel(user: AuthUser, id: string): Promise<Trade> {
    return this.finish(user, id, {
      role: 'initiator',
      to: 'CANCELLED',
      action: 'trade.cancel',
      notify: 'trade.cancelled',
    });
  }

  /** PENDING only here; an ACCEPTED trade answers TRADE_NOT_PENDING until PD-73. */
  async voidPending(admin: AuthUser, id: string, reason: string): Promise<Trade> {
    const trade = await this.prisma.trade.findUnique({ where: { id }, select: TRADE_SELECT });
    if (trade === null) {
      throw new NotFoundException('Trade not found');
    }

    await this.prisma.withTransaction((tx) =>
      this.closer.close(tx, trade, {
        to: 'VOIDED',
        action: 'trade.void',
        actorId: admin.id,
        release: true,
        meta: { reason },
      }),
    );

    await this.notify([trade.initiatorId, trade.recipientId], 'trade.voided', trade.id, admin.id);
    return this.read(id);
  }

  private async finish(
    user: AuthUser,
    id: string,
    step: {
      role: Role;
      to: 'DECLINED' | 'CANCELLED';
      action: string;
      notify: TradeNotificationType;
    },
  ): Promise<Trade> {
    const trade = await this.loadAsParty(user, id);
    assertRole(trade, user, step.role);

    await this.prisma.withTransaction((tx) =>
      this.closer.close(tx, trade, {
        to: step.to,
        action: step.action,
        actorId: user.id,
        release: true,
      }),
    );

    await this.notify([counterparty(trade, user.id)], step.notify, trade.id, user.id);
    return this.read(id);
  }

  private async loadAsParty(user: AuthUser, id: string): Promise<TradeRow> {
    const trade = await this.prisma.trade.findUnique({ where: { id }, select: TRADE_SELECT });
    if (trade === null || (trade.initiatorId !== user.id && trade.recipientId !== user.id)) {
      throw new NotFoundException('Trade not found');
    }
    return trade;
  }

  private async read(id: string): Promise<Trade> {
    return toTrade(
      await this.prisma.trade.findUniqueOrThrow({ where: { id }, select: TRADE_SELECT }),
    );
  }

  /**
   * The recipient's holdings are not checked: an inventory is private, and a
   * refusal here would disclose it. Settlement checks.
   */
  private async assertTerms(initiatorId: string, terms: Terms): Promise<void> {
    const ids = [...terms.offered, ...terms.requested].map((line) => line.cardId);
    if (ids.length > 0) {
      const found = await this.prisma.card.findMany({
        where: { id: { in: ids } },
        select: { id: true },
      });
      const known = new Set(found.map((card) => card.id));
      const unknown = ids.filter((id) => !known.has(id));
      if (unknown.length > 0) {
        throw new BadRequestException(`Unknown card: ${unknown.join(', ')}`);
      }
    }

    if (terms.currencyFromInitiator > 0) {
      const me = await this.prisma.user.findUniqueOrThrow({
        where: { id: initiatorId },
        select: { currency: true },
      });
      if (me.currency < terms.currencyFromInitiator) {
        throw domainError(
          HttpStatus.PAYMENT_REQUIRED,
          ERROR_CODES.INSUFFICIENT_FUNDS,
          'Not enough coins for this offer',
        );
      }
    }
  }

  private notify(
    userIds: string[],
    type: TradeNotificationType,
    tradeId: string,
    actorId: string | null,
  ): Promise<void> {
    return this.notifications.notify(
      userIds.map((userId) => ({ userId, type, payload: { tradeId, actorId } })),
    );
  }
}
