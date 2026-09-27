import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ERROR_CODES,
  PackOpenResultSchema,
  type PackOpenResult,
  type PackTemplate,
} from '@pokedrop/shared';
import { domainError } from '../common/errors/domain-error.js';
import { isUniqueViolation } from '../common/errors/prisma-error.js';
import { InventoryService } from '../inventory/index.js';
import { PrismaService, type TransactionClient } from '../prisma/index.js';
import { PACK_CARD_SELECT, toPackCard } from './pack-card.js';
import { EmptySlotError, generatePack, type PulledCard } from './pack-generator.js';
import { PACK_OPEN_LOCK_MS, PackOpenLock } from './pack-open.lock.js';
import { loadPool } from './pack-pool.js';
import { SeededRng, newSeed } from './pack-rng.js';
import { PackTemplatesService } from './pack-templates.service.js';

const POLL_MS = 100;

type Opening = { id: string; userId: string; templateId: string; openId: string; createdAt: Date };
type Placed = { cardId: string; rarity: string; position: number };

@Injectable()
export class PackOpeningService {
  private readonly logger = new Logger(PackOpeningService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly templates: PackTemplatesService,
    private readonly inventory: InventoryService,
    private readonly lock: PackOpenLock,
  ) {}

  async open(userId: string, templateId: string, openId: string): Promise<PackOpenResult> {
    const existing = await this.findOpening(openId);
    if (existing !== null) {
      return this.replay(existing, userId, templateId);
    }

    const attempt = await this.lock.acquire(openId);
    if (attempt.kind === 'held') {
      const settled = await this.waitForOpening(openId);
      if (settled !== null) {
        return this.replay(settled, userId, templateId);
      }
    }

    try {
      return await this.openFresh(userId, templateId, openId);
    } finally {
      if (attempt.kind === 'acquired') {
        await this.lock.release(openId, attempt.token);
      }
    }
  }

  private async openFresh(
    userId: string,
    templateId: string,
    openId: string,
  ): Promise<PackOpenResult> {
    const template = await this.templates.getActive(templateId);
    const seed = newSeed();
    const pool = await loadPool(this.prisma, template.setFilter);

    let cards: PulledCard[];
    try {
      const pack = generatePack(template.slotConfig, pool, new SeededRng(seed));
      if (pack.fallbacks.length > 0) {
        this.logger.warn(
          `Template ${template.id} fell back: ${JSON.stringify(pack.fallbacks)} - it has drifted from the catalog`,
        );
      }
      cards = pack.cards;
    } catch (error) {
      if (error instanceof EmptySlotError) {
        this.logger.error(`Template ${template.id} slot ${error.slot} has no cards; open refused`);
        throw domainError(
          HttpStatus.CONFLICT,
          ERROR_CODES.PACK_UNAVAILABLE,
          'This pack cannot be opened right now',
        );
      }
      throw error;
    }

    let written: { openingId: string; createdAt: Date; balance: number };
    try {
      written = await this.prisma.withTransaction((tx) =>
        this.write(tx, { userId, template, openId, seed, cards }),
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        const winner = await this.findOpening(openId);
        if (winner !== null) {
          return this.replay(winner, userId, templateId);
        }
      }
      throw error;
    }

    await this.inventory.invalidateSummary(userId);

    return this.present(
      { id: written.openingId, userId, templateId, openId, createdAt: written.createdAt },
      written.balance,
      cards.map((card, position) => ({ ...card, position })),
    );
  }

  private async write(
    tx: TransactionClient,
    input: {
      userId: string;
      template: PackTemplate;
      openId: string;
      seed: Buffer;
      cards: PulledCard[];
    },
  ): Promise<{ openingId: string; createdAt: Date; balance: number }> {
    const { userId, template, openId, seed, cards } = input;

    const opening = await tx.packOpening.create({
      data: { userId, templateId: template.id, openId, seed: seed.toString('hex') },
      select: { id: true, createdAt: true },
    });

    const debited = await tx.$queryRaw<{ currency: number }[]>`
      UPDATE users SET currency = currency - ${template.cost}
      WHERE id = ${userId} AND currency >= ${template.cost}
      RETURNING currency`;
    const after = debited[0];
    if (after === undefined) {
      throw domainError(
        HttpStatus.PAYMENT_REQUIRED,
        ERROR_CODES.INSUFFICIENT_FUNDS,
        'Not enough coins to open this pack',
      );
    }

    await tx.currencyTransaction.create({
      data: {
        userId,
        amount: template.cost === 0 ? 0 : -template.cost,
        type: 'PACK_SPEND',
        refId: openId,
      },
    });

    await tx.packOpeningCard.createMany({
      data: cards.map((card, position) => ({
        packOpeningId: opening.id,
        cardId: card.cardId,
        rarity: card.rarity,
        position,
      })),
    });

    // Summed per card and sorted, so one statement mints the pack and two
    // opens can never take the same rows in opposite orders.
    const counts = new Map<string, number>();
    for (const card of cards) {
      counts.set(card.cardId, (counts.get(card.cardId) ?? 0) + 1);
    }
    const rows = [...counts.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const values = Prisma.join(
      rows.map(
        ([cardId, quantity]) =>
          Prisma.sql`(${randomUUID()}, ${userId}, ${cardId}, ${quantity}, 0, now())`,
      ),
    );
    await tx.$executeRaw`
      INSERT INTO inventory_items (id, "userId", "cardId", quantity, "lockedQuantity", "acquiredAt")
      VALUES ${values}
      ON CONFLICT ("userId", "cardId") DO UPDATE
      SET quantity = inventory_items.quantity + EXCLUDED.quantity,
          "acquiredAt" = EXCLUDED."acquiredAt"`;

    return { openingId: opening.id, createdAt: opening.createdAt, balance: after.currency };
  }

  private async replay(
    opening: Opening,
    userId: string,
    templateId: string,
  ): Promise<PackOpenResult> {
    if (opening.userId !== userId || opening.templateId !== templateId) {
      throw domainError(
        HttpStatus.CONFLICT,
        ERROR_CODES.OPEN_ID_CONFLICT,
        'This openId was already used for a different opening',
      );
    }

    const [cards, user] = await Promise.all([
      this.prisma.packOpeningCard.findMany({
        where: { packOpeningId: opening.id },
        orderBy: { position: 'asc' },
        select: { cardId: true, rarity: true, position: true },
      }),
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { currency: true } }),
    ]);

    return this.present(opening, user.currency, cards);
  }

  private async present(
    opening: Opening,
    balance: number,
    placed: Placed[],
  ): Promise<PackOpenResult> {
    const rows = await this.prisma.card.findMany({
      where: { id: { in: [...new Set(placed.map((card) => card.cardId))] } },
      select: PACK_CARD_SELECT,
    });
    const byId = new Map(rows.map((row) => [row.id, row]));

    return PackOpenResultSchema.parse({
      openingId: opening.id,
      openId: opening.openId,
      templateId: opening.templateId,
      createdAt: opening.createdAt,
      balance,
      cards: placed.map((card) => {
        const row = byId.get(card.cardId);
        return {
          ...card,
          card: row === undefined ? undefined : toPackCard(row),
        };
      }),
    });
  }

  private findOpening(openId: string): Promise<Opening | null> {
    return this.prisma.packOpening.findUnique({
      where: { openId },
      select: { id: true, userId: true, templateId: true, openId: true, createdAt: true },
    });
  }

  private async waitForOpening(openId: string): Promise<Opening | null> {
    const deadline = Date.now() + PACK_OPEN_LOCK_MS;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      const found = await this.findOpening(openId);
      if (found !== null) {
        return found;
      }
      if (!(await this.lock.isHeld(openId))) {
        return this.findOpening(openId);
      }
    }
    return null;
  }
}
