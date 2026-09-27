import { BadRequestException } from '@nestjs/common';
import { INVENTORY_SORTS, type InventorySort } from '@pokedrop/shared';
import { z } from 'zod';

export type SortKey = 'acquiredAt' | 'name' | 'price';
export type SortSpec = { key: SortKey; dir: 'asc' | 'desc' };

export const SORTS: Record<InventorySort, SortSpec> = {
  acquired_desc: { key: 'acquiredAt', dir: 'desc' },
  acquired_asc: { key: 'acquiredAt', dir: 'asc' },
  name_asc: { key: 'name', dir: 'asc' },
  name_desc: { key: 'name', dir: 'desc' },
  price_desc: { key: 'price', dir: 'desc' },
  price_asc: { key: 'price', dir: 'asc' },
};

export type InventoryCursor = { v: string | null; id: string };

const PayloadSchema = z.object({
  s: z.enum(INVENTORY_SORTS),
  v: z.string().max(256).nullable(),
  id: z.string().min(1).max(64),
});

// A value of the wrong kind would reach Prisma as an Invalid Date or an
// unparseable Decimal and surface as a 500, not a 400.
const VALUE_RULES: Record<SortKey, z.ZodType<string | null>> = {
  acquiredAt: z.iso.datetime(),
  name: z.string().min(1),
  price: z
    .string()
    .regex(/^\d{1,8}\.\d{2}$/)
    .nullable(),
};

export function encodeCursor(sort: InventorySort, v: string | null, id: string): string {
  return Buffer.from(JSON.stringify({ s: sort, v, id }), 'utf8').toString('base64url');
}

export function decodeCursor(raw: string, sort: InventorySort): InventoryCursor {
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw invalidCursor();
  }

  const payload = PayloadSchema.safeParse(json);
  if (!payload.success || payload.data.s !== sort) {
    throw invalidCursor();
  }

  if (!VALUE_RULES[SORTS[sort].key].safeParse(payload.data.v).success) {
    throw invalidCursor();
  }

  return { v: payload.data.v, id: payload.data.id };
}

function invalidCursor(): BadRequestException {
  return new BadRequestException('Invalid cursor');
}
