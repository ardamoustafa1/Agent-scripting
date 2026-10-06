import { z } from 'zod';

import { DomainError } from '../errors/domain-errors.js';

/**
 * Cursor (keyset) pagination standard for every list endpoint:
 *   ?limit=1..100 (default 25) &cursor=<opaque> &sort=<field>|-<field> &<filters>
 * Response: { data: T[], page: { limit, nextCursor | null, sort } }.
 * The cursor binds the sort, so changing `sort` mid-pagination is rejected.
 */
export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

export interface SortSpec<F extends string> {
  readonly field: F;
  readonly direction: 'asc' | 'desc';
}

export interface ListQuery<F extends string> {
  readonly limit: number;
  readonly cursor?: CursorPayload;
  readonly sort: SortSpec<F>;
}

export interface CursorPayload {
  /** sort expression, e.g. "-createdAt" */
  readonly s: string;
  /** last sort value (ISO date, string or number) */
  readonly v: string | number | null;
  /** last id (tie-breaker) */
  readonly id: string;
}

export class InvalidCursorError extends DomainError {
  override readonly name = 'InvalidCursorError';

  constructor() {
    super('VERBIS_PAGINATION_INVALID_CURSOR', 'The cursor is invalid or does not match the sort');
  }
}

export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

const CursorSchema = z.object({
  s: z.string().max(64),
  v: z.union([z.string().max(512), z.number(), z.null()]),
  id: z.uuid(),
});

export function decodeCursor(raw: string): CursorPayload {
  try {
    return CursorSchema.parse(JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')));
  } catch {
    throw new InvalidCursorError();
  }
}

const sortExpression = (sort: SortSpec<string>): string =>
  `${sort.direction === 'desc' ? '-' : ''}${sort.field}`;

/**
 * Builds the zod schema for a list query: pagination + sort allow-list + resource filters.
 * The first sortable field (descending) is the default.
 */
export function listQuerySchema<F extends string, Shape extends z.ZodRawShape>(
  sortable: readonly [F, ...F[]],
  filters: Shape,
  defaultSort: `${'-' | ''}${F}` = `-${sortable[0]}`,
) {
  const sortValues = sortable.flatMap((field) => [field, `-${field}`]) as [string, ...string[]];
  return z
    .object({
      limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
      cursor: z.string().max(2048).optional(),
      sort: z.enum(sortValues).default(defaultSort),
      ...filters,
    })
    .strict()
    .transform((parsed) => {
      const { limit, cursor, sort, ...rest } = parsed as {
        limit: number;
        cursor?: string;
        sort: string;
      } & Record<string, unknown>;
      const desc = sort.startsWith('-');
      const spec: SortSpec<F> = {
        field: (desc ? sort.slice(1) : sort) as F,
        direction: desc ? 'desc' : 'asc',
      };
      const decoded = cursor === undefined ? undefined : decodeCursor(cursor);
      if (decoded !== undefined && decoded.s !== sort) throw new InvalidCursorError();
      return {
        limit,
        sort: spec,
        ...(decoded === undefined ? {} : { cursor: decoded }),
        filters: rest as { [K in keyof Shape]: z.output<Shape[K]> },
      };
    });
}

export const PageInfoSchema = z.object({
  limit: z.number().int(),
  nextCursor: z.string().nullable(),
  sort: z.string(),
});

export function pageSchema<T extends z.ZodType>(item: T) {
  return z.object({ data: z.array(item), page: PageInfoSchema });
}

export interface Page<T> {
  data: T[];
  page: { limit: number; nextCursor: string | null; sort: string };
}

type SortValue = Date | string | number | bigint | null;

/** Prisma `where` fragment for "after the cursor" with an `id` tie-breaker. */
export function keysetWhere<F extends string>(
  query: ListQuery<F>,
): Record<string, unknown> | undefined {
  const { cursor, sort } = query;
  if (cursor === undefined) return undefined;
  const op = sort.direction === 'desc' ? 'lt' : 'gt';
  const value =
    sort.field.endsWith('At') && typeof cursor.v === 'string' ? new Date(cursor.v) : cursor.v;
  if (value === null) return { id: { [op]: cursor.id } };
  return {
    OR: [{ [sort.field]: { [op]: value } }, { [sort.field]: value, id: { [op]: cursor.id } }],
  };
}

export function keysetOrderBy<F extends string>(
  query: ListQuery<F>,
): Record<string, 'asc' | 'desc'>[] {
  return [{ [query.sort.field]: query.sort.direction }, { id: query.sort.direction }];
}

/**
 * Builds the page from `limit + 1` rows fetched with keysetWhere/keysetOrderBy.
 * `valueOf` reads the sort field from a row.
 */
export function toPage<R extends { id: string }, T, F extends string>(
  rows: R[],
  query: ListQuery<F>,
  map: (row: R) => T,
  valueOf: (row: R, field: F) => SortValue,
): Page<T> {
  const hasMore = rows.length > query.limit;
  const items = hasMore ? rows.slice(0, query.limit) : rows;
  const last = items.at(-1);
  let nextCursor: string | null = null;
  if (hasMore && last !== undefined) {
    const raw = valueOf(last, query.sort.field);
    const v = raw instanceof Date ? raw.toISOString() : typeof raw === 'bigint' ? Number(raw) : raw;
    nextCursor = encodeCursor({ s: sortExpression(query.sort), v, id: last.id });
  }
  return {
    data: items.map(map),
    page: { limit: query.limit, nextCursor, sort: sortExpression(query.sort) },
  };
}
