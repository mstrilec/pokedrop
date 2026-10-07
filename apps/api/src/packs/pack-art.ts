import {
  rarityTier,
  RarityTierSchema,
  type CardId,
  type PackArt,
  type PackTemplate,
  type SetId,
} from '@pokedrop/shared';
import type { PrismaService } from '../prisma/index.js';

const COVER_SELECT = {
  id: true,
  name: true,
  types: true,
  rarity: true,
  imageLarge: true,
} as const;

type CoverRow = {
  id: string;
  name: string;
  types: string[];
  rarity: string | null;
  imageLarge: string;
};
type RarityRow = { setId: string; rarity: string | null };

const tierRank = (rarity: string | null) => RarityTierSchema.options.indexOf(rarityTier(rarity));

export async function packArtOf(
  prisma: PrismaService,
  templates: PackTemplate[],
): Promise<Map<string, PackArt>> {
  const firstSetIds = unique(templates.flatMap((t) => t.setFilter.setIds.slice(0, 1)));
  const coverIds = unique(templates.flatMap((t) => (t.coverCardId ? [t.coverCardId] : [])));
  const allSetIds = unique(templates.flatMap((t) => t.setFilter.setIds));

  const [sets, covers, groups] = await Promise.all([
    prisma.cardSet.findMany({
      where: { id: { in: firstSetIds } },
      select: { id: true, name: true, series: true, logoUrl: true },
    }),
    prisma.card.findMany({ where: { id: { in: coverIds } }, select: COVER_SELECT }),
    prisma.card.groupBy({ by: ['setId', 'rarity'], where: { setId: { in: allSetIds } } }),
  ]);
  const setById = new Map(sets.map((set) => [set.id, set]));
  const coverById = new Map(covers.map((card) => [card.id, card]));
  const rarities: RarityRow[] = groups.map(({ setId, rarity }) => ({ setId, rarity }));

  const arts = new Map<string, PackArt>();
  for (const template of templates) {
    const setId = template.setFilter.setIds[0] ?? '';
    const set = setById.get(setId) ?? { id: setId, name: setId, series: '', logoUrl: null };
    const chosen = template.coverCardId ? coverById.get(template.coverCardId) : undefined;
    const cover = chosen ?? (await defaultCover(prisma, template.setFilter.setIds, rarities));
    arts.set(template.id, {
      set: { ...set, id: set.id as SetId },
      cover: cover === null ? null : coverOf(cover),
      coverIsDefault: chosen === undefined,
      imageUrl: template.imageUrl,
    });
  }
  return arts;
}

async function defaultCover(
  prisma: PrismaService,
  setIds: string[],
  rarities: RarityRow[],
): Promise<CoverRow | null> {
  const own = rarities.filter((row) => setIds.includes(row.setId));
  if (own.length === 0) return null;
  const top = Math.max(...own.map((row) => tierRank(row.rarity)));
  const inTop = unique(own.filter((row) => tierRank(row.rarity) === top).map((row) => row.rarity));
  const named = inTop.filter((rarity): rarity is string => rarity !== null);
  const rarity = inTop.includes(null)
    ? { OR: [{ rarity: { in: named } }, { rarity: null }] }
    : { rarity: { in: named } };

  return prisma.card.findFirst({
    where: { setId: { in: setIds }, ...rarity },
    orderBy: [{ latestPriceUsd: { sort: 'desc', nulls: 'last' } }, { id: 'asc' }],
    select: COVER_SELECT,
  });
}

function coverOf(card: CoverRow): NonNullable<PackArt['cover']> {
  return {
    id: card.id as CardId,
    name: card.name,
    image: card.imageLarge,
    type: card.types[0] ?? null,
    rarity: card.rarity,
  };
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
