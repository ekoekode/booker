/**
 * Series in the project layout. A series is a folder holding `series.json`, a Codex shared by every book, and one
 * folder per book (each a normal project). Books point back with `seriesId` (the folder name) and `seriesUuid`.
 *   Saga/series.json   { name, seriesUuid, bookOrder: [folder names], bookIds, created }
 *   Saga/Codex/{Characters,Locations}
 *   Saga/Book One/Book One.md
 * Pure data code; the vault work is in vaultOps.ts.
 */
export interface SeriesMeta {
  name: string;
  seriesUuid?: string;
  /** book folder names, in reading order */
  bookOrder: string[];
  bookIds?: string[];
  created: string;
  [k: string]: unknown;
}

export interface SeriesInfo {
  /** the series folder's name (what a book calls its seriesId) */
  name: string;
  folder: string;
}

export function parseSeries(raw: unknown): SeriesMeta | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, any>;
  if (!o.name || !Array.isArray(o.bookOrder)) return null;
  return { ...o, name: String(o.name), bookOrder: o.bookOrder.map(String), bookIds: Array.isArray(o.bookIds) ? o.bookIds.map(String) : undefined, created: String(o.created ?? "") };
}

export function newSeries(name: string, uuid: string, today: string): SeriesMeta {
  return { name, seriesUuid: uuid, bookOrder: [], bookIds: [], created: today };
}

/** The series with a book added once (by folder name and book id). */
export function withBook(meta: SeriesMeta, folderName: string, bookId: string): SeriesMeta {
  const bookOrder = meta.bookOrder.includes(folderName) ? meta.bookOrder : [...meta.bookOrder, folderName];
  const ids = meta.bookIds ?? [];
  return { ...meta, bookOrder, bookIds: ids.includes(bookId) ? ids : [...ids, bookId] };
}

/** The series with a book taken out (by folder name and book id). */
export function withoutBook(meta: SeriesMeta, folderName: string, bookId?: string): SeriesMeta {
  return {
    ...meta,
    bookOrder: meta.bookOrder.filter((n) => n.toLowerCase() !== folderName.toLowerCase()),
    bookIds: meta.bookIds?.filter((i) => i !== bookId),
  };
}

/** Books sorted by the series' own order; books it does not list come last, by name. */
export function orderBooks<T extends { name: string }>(books: T[], bookOrder: string[]): T[] {
  const rank = (b: T) => {
    const i = bookOrder.findIndex((n) => n.toLowerCase() === b.name.toLowerCase());
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  return [...books].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/** Where a series book keeps its shared Codex. */
export function seriesCodex(seriesFolder: string) {
  return { codex: `${seriesFolder}/Codex`, characters: `${seriesFolder}/Codex/Characters`, locations: `${seriesFolder}/Codex/Locations` };
}

/** The order with one book moved up (-1) or down (+1); unchanged at the ends or when the book is not in it. */
export function moveInOrder(order: string[], name: string, dir: -1 | 1): string[] {
  const i = order.indexOf(name);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= order.length) return order;
  const out = [...order];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

/** The series' book list made to match the books that really exist: listed ones that are gone drop out, new ones go last. */
export function reconcileOrder(listed: string[], existing: string[]): string[] {
  const have = new Set(existing.map((n) => n.toLowerCase()));
  const kept = listed.filter((n) => have.has(n.toLowerCase()));
  const keptLower = new Set(kept.map((n) => n.toLowerCase()));
  return [...kept, ...existing.filter((n) => !keptLower.has(n.toLowerCase())).sort((a, b) => a.localeCompare(b))];
}
