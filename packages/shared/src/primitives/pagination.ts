import { z } from 'zod';

export const DEFAULT_PAGE_SIZE = 24;
export const MAX_PAGE_SIZE = 100;

/**
 * Query parameters accepted by every list endpoint.
 *
 * `z.coerce` is required, not cosmetic: query strings arrive as text, so
 * `?page=2` would fail a plain `z.number()`. The ceiling on pageSize is what
 * keeps a caller from asking for the whole catalog in one request, per the
 * "no unbounded queries" rule in docs/Architecture.md section 10.
 */
export const PaginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;

/**
 * The envelope every list endpoint returns, built around the item schema.
 *
 * `nextCursor` is present but optional because docs/API.md leaves cursor
 * pagination open: a collection that outgrows offset paging can start
 * returning it without changing the shape consumers already read.
 */
export const pageOf = <T extends z.ZodType>(item: T) =>
  z.object({
    items: z.array(item),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1),
    total: z.number().int().min(0),
    totalPages: z.number().int().min(0),
    nextCursor: z.string().nullable().optional(),
  });

export type Page<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  nextCursor?: string | null;
};
