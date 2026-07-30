/** Shared cursor-pagination helpers (spec §15: ?limit=&cursor= -> next_cursor). */

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

export function normalizeLimit(raw?: string | number): number {
  const n = typeof raw === 'string' ? parseInt(raw, 10) : raw;
  if (!n || Number.isNaN(n) || n < 1) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

/**
 * Builds Prisma `take/cursor/skip` args for id-based cursor pagination, fetching
 * one extra row to determine `next_cursor`.
 */
export function cursorArgs(limit: number, cursor?: string) {
  return {
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  };
}

/**
 * Marker returned by list endpoints. The global ResponseInterceptor detects it
 * and emits `{ data: [...items], next_cursor, error: null }` (spec §15), keeping
 * `next_cursor` a sibling of `data` rather than nesting it inside.
 */
export class Paginated<T> {
  constructor(
    public readonly items: T[],
    public readonly nextCursor: string | null,
  ) {}
}

/** Splits an over-fetched page into the page slice + the next cursor. */
export function splitPage<T extends { id: string }>(
  rows: T[],
  limit: number,
): { items: T[]; nextCursor: string | null } {
  if (rows.length > limit) {
    const items = rows.slice(0, limit);
    return { items, nextCursor: items[items.length - 1].id };
  }
  return { items: rows, nextCursor: null };
}
