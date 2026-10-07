import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AuditPageSchema, type AuditPage, type AuditQuery } from '@pokedrop/shared';
import { decodeNewestCursor, encodeNewestCursor } from '../common/newest-cursor.js';
import { PrismaService } from '../prisma/index.js';

const DAY = 24 * 60 * 60 * 1000;

/** Reads only: the log is append-only, and nothing here writes it. */
@Injectable()
export class AdminAuditService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: AuditQuery): Promise<AuditPage> {
    const cursor = query.cursor === undefined ? null : decodeNewestCursor(query.cursor);
    const scope = scopeOf(query);
    const where: Prisma.AuditLogWhereInput =
      cursor === null
        ? scope
        : {
            AND: [
              scope,
              {
                OR: [
                  { createdAt: { lt: cursor.createdAt } },
                  { createdAt: cursor.createdAt, id: { lt: cursor.id } },
                ],
              },
            ],
          };

    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.pageSize + 1,
        select: {
          id: true,
          action: true,
          entity: true,
          entityId: true,
          meta: true,
          createdAt: true,
          actor: { select: { id: true, displayName: true, email: true } },
        },
      }),
      this.prisma.auditLog.count({ where: scope }),
    ]);
    const page = rows.slice(0, query.pageSize);
    const last = page.at(-1);
    const subjects = await this.subjects(page);

    return AuditPageSchema.parse({
      items: page.map((row) => ({
        ...row,
        meta:
          typeof row.meta === 'object' && row.meta !== null && !Array.isArray(row.meta)
            ? row.meta
            : {},
        subject: subjects.get(`${row.entity}:${row.entityId}`) ?? null,
      })),
      pageSize: query.pageSize,
      total,
      nextCursor:
        rows.length > query.pageSize && last !== undefined
          ? encodeNewestCursor(last.createdAt, last.id)
          : null,
    });
  }

  /** One read per kind for the whole page: users by id, templates by id. */
  private async subjects(rows: { entity: string; entityId: string }[]) {
    const ids = (entity: string) => [
      ...new Set(rows.filter((r) => r.entity === entity).map((r) => r.entityId)),
    ];
    const [users, templates] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: ids('User') } },
        select: { id: true, displayName: true, email: true },
      }),
      this.prisma.packTemplate.findMany({
        where: { id: { in: ids('PackTemplate') } },
        select: { id: true, name: true },
      }),
    ]);
    const map = new Map<string, { label: string; email: string | null }>();
    for (const u of users)
      map.set(`User:${u.id}`, { label: u.displayName || u.email, email: u.email });
    for (const t of templates) map.set(`PackTemplate:${t.id}`, { label: t.name, email: null });
    return map;
  }
}

function scopeOf(query: AuditQuery): Prisma.AuditLogWhereInput {
  const and: Prisma.AuditLogWhereInput[] = [];
  if (query.actor === 'system') and.push({ actorId: null });
  else if (query.actor !== undefined) and.push({ actorId: query.actor });
  if (query.action !== undefined) {
    and.push(
      query.action.includes('.')
        ? { action: query.action }
        : { action: { startsWith: `${query.action}.` } },
    );
  }
  if (query.entity !== undefined) and.push({ entity: query.entity });
  if (query.entityId !== undefined) and.push({ entityId: query.entityId });
  if (query.from !== undefined || query.to !== undefined) {
    and.push({
      createdAt: {
        ...(query.from !== undefined ? { gte: new Date(`${query.from}T00:00:00Z`) } : {}),
        ...(query.to !== undefined
          ? { lt: new Date(new Date(`${query.to}T00:00:00Z`).getTime() + DAY) }
          : {}),
      },
    });
  }
  return and.length === 0 ? {} : { AND: and };
}
