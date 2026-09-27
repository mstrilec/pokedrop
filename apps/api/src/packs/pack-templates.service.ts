import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  PackTemplateSchema,
  type CreatePackTemplate,
  type PackTemplate,
  type SetFilter,
  type SlotConfig,
  type UpdatePackTemplate,
} from '@pokedrop/shared';
import { AuditService } from '../audit/index.js';
import { PrismaService, type TransactionClient } from '../prisma/index.js';

const ENTITY = 'PackTemplate';

@Injectable()
export class PackTemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async listActive(): Promise<PackTemplate[]> {
    const rows = await this.prisma.packTemplate.findMany({
      where: { active: true },
      orderBy: [{ cost: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toTemplate);
  }

  async getActive(id: string): Promise<PackTemplate> {
    const row = await this.prisma.packTemplate.findUnique({ where: { id } });
    if (row === null || !row.active) {
      throw new NotFoundException('Pack template not found');
    }
    return toTemplate(row);
  }

  async listAll(): Promise<PackTemplate[]> {
    const rows = await this.prisma.packTemplate.findMany({
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toTemplate);
  }

  create(actorId: string, input: CreatePackTemplate): Promise<PackTemplate> {
    return this.prisma.withTransaction(async (tx) => {
      await assertPool(tx, input.setFilter, input.slotConfig);

      const row = await tx.packTemplate.create({
        data: {
          name: input.name,
          setFilter: input.setFilter,
          cost: input.cost,
          slotConfig: input.slotConfig,
          active: input.active,
        },
      });

      await this.audit.record(tx, {
        actorId,
        action: 'pack_template.create',
        entity: ENTITY,
        entityId: row.id,
        meta: { input: input },
      });

      return toTemplate(row);
    });
  }

  update(actorId: string, id: string, patch: UpdatePackTemplate): Promise<PackTemplate> {
    return this.prisma.withTransaction(async (tx) => {
      const existing = await tx.packTemplate.findUnique({ where: { id } });
      if (existing === null) {
        throw new NotFoundException('Pack template not found');
      }

      // Only a change to what a pack can contain is checked against the pool,
      // so a template whose sets later lost a rarity can still be deactivated.
      if (patch.setFilter !== undefined || patch.slotConfig !== undefined) {
        const current = toTemplate(existing);
        await assertPool(
          tx,
          patch.setFilter ?? current.setFilter,
          patch.slotConfig ?? current.slotConfig,
        );
      }

      const row = await tx.packTemplate.update({
        where: { id },
        data: {
          ...(patch.name === undefined ? {} : { name: patch.name }),
          ...(patch.cost === undefined ? {} : { cost: patch.cost }),
          ...(patch.active === undefined ? {} : { active: patch.active }),
          ...(patch.setFilter === undefined ? {} : { setFilter: patch.setFilter }),
          ...(patch.slotConfig === undefined ? {} : { slotConfig: patch.slotConfig }),
        },
      });

      await this.audit.record(tx, {
        actorId,
        action: 'pack_template.update',
        entity: ENTITY,
        entityId: id,
        meta: { changes: patch },
      });

      return toTemplate(row);
    });
  }
}

async function assertPool(
  tx: TransactionClient,
  setFilter: SetFilter,
  slotConfig: SlotConfig,
): Promise<void> {
  const setIds: string[] = setFilter.setIds;

  const sets = await tx.cardSet.findMany({ where: { id: { in: setIds } }, select: { id: true } });
  const known = new Set(sets.map((set) => set.id));
  const unknownSets = setIds.filter((setId) => !known.has(setId));
  if (unknownSets.length > 0) {
    throw new BadRequestException(`Unknown set: ${unknownSets.join(', ')}`);
  }

  const rarities = await tx.card.findMany({
    where: { setId: { in: setIds }, rarity: { not: null } },
    distinct: ['rarity'],
    select: { rarity: true },
  });
  const pool = new Set(rarities.map((row) => row.rarity));
  const referenced = new Set(slotConfig.slots.flatMap((slot) => Object.keys(slot.weights)));
  const absent = [...referenced].filter((rarity) => !pool.has(rarity));
  if (absent.length > 0) {
    throw new BadRequestException(
      `No cards in ${setIds.join(', ')} for rarity: ${absent.map((r) => `"${r}"`).join(', ')}`,
    );
  }
}

function toTemplate(row: Record<string, unknown>): PackTemplate {
  return PackTemplateSchema.parse(row);
}
