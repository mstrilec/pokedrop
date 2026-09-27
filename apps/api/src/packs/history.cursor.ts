import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

export type HistoryCursor = { createdAt: Date; id: string };

// A value PostgreSQL cannot compare would surface as a 500, not a 400.
const PayloadSchema = z.object({
  c: z.iso.datetime().refine((value) => !value.startsWith('0000')),
  id: z.string().regex(/^[\w-]{1,64}$/),
});

export function encodeHistoryCursor(createdAt: Date, id: string): string {
  return Buffer.from(JSON.stringify({ c: createdAt.toISOString(), id }), 'utf8').toString(
    'base64url',
  );
}

export function decodeHistoryCursor(raw: string): HistoryCursor {
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw new BadRequestException('Invalid cursor');
  }

  const payload = PayloadSchema.safeParse(json);
  if (!payload.success) {
    throw new BadRequestException('Invalid cursor');
  }
  return { createdAt: new Date(payload.data.c), id: payload.data.id };
}
