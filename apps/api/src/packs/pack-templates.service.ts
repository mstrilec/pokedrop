import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  PackTemplateSchema,
  type CreatePackTemplate,
  type PackTemplate,
  type PackTemplateView,
  type SetFilter,
  type SlotConfig,
  type UpdatePackTemplate,
} from '@pokedrop/shared';
import { AuditService } from '../audit/index.js';
import { PrismaService, type TransactionClient } from '../prisma/index.js';
import { packArtOf } from './pack-art.js';
import { toTemplateView } from './pack-template.view.js';

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

  async viewsOf(templates: PackTemplate[]): Promise<PackTemplateView[]> {
    const arts = await packArtOf(this.prisma, templates);
    return templates.map((template) => toTemplateView(template, arts.get(template.id)!));
  }

  async viewOf(template: PackTemplate): Promise<PackTemplateView> {
    const [view] = await this.viewsOf([template]);
    return view!;
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
      await assertCover(tx, input.setFilter, input.coverCardId ?? null);

      const row = await tx.packTemplate.create({
        data: {
          name: input.name,
          setFilter: input.setFilter,
          cost: input.cost,
          slotConfig: input.slotConfig,
          active: input.active,
          coverCardId: input.coverCardId ?? null,
          imageUrl: input.imageUrl ?? null,
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
      const current = toTemplate(existing);
      if (patch.setFilter !== undefined || patch.slotConfig !== undefined) {
        await assertPool(
          tx,
          patch.setFilter ?? current.setFilter,
          patch.slotConfig ?? current.slotConfig,
        );
      }
      if (patch.setFilter !== undefined || patch.coverCardId !== undefined) {
        await assertCover(
          tx,
          patch.setFilter ?? current.setFilter,
          patch.coverCardId === undefined ? current.coverCardId : patch.coverCardId,
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
          ...(patch.coverCardId === undefined ? {} : { coverCardId: patch.coverCardId }),
          ...(patch.imageUrl === undefined ? {} : { imageUrl: patch.imageUrl }),
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

async function assertCover(
  tx: TransactionClient,
  setFilter: SetFilter,
  coverCardId: string | null,
): Promise<void> {
  if (coverCardId === null) return;
  const card = await tx.card.findFirst({
    where: { id: coverCardId, setId: { in: setFilter.setIds } },
    select: { id: true },
  });
  if (card === null) {
    throw new BadRequestException("The featured card is not in this pack's sets");
  }
}

function toTemplate(row: Record<string, unknown>): PackTemplate {
  return PackTemplateSchema.parse(row);
}
