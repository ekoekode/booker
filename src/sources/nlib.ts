/**
 * The Booker reference library (.nlib): one SQLite file holding a work or a reference book as a tree of entries.
 * Anyone can write one; the format is described in docs/REFERENCE-LIBRARY-FORMAT.md. Reading is lazy (sql.js is only
 * loaded when a library is first opened) and only needs `meta` and `entries`.
 */
import { openDb, rows, tables } from "../scripture/sqlite";
import { readEswordDictionary } from "../scripture/esword";
import { chunkParagraphs } from "./extract";
import { readMappedEntries, type DbMap } from "./dbmap";
import type { Chunk, SourceType } from "./types";

export interface NlibEntry {
  id: number;
  parent: number | null;
  level: string;
  locator: string;
  key: string;
  title: string;
  text: string;
}

export interface NlibMeta {
  title: string;
  authors: string[];
  /** what the library is: fathers, encyclopedia, lexicon, creeds, commentary, catechism, or anything */
  category: string;
  year?: string;
  publisher?: string;
  place?: string;
  edition?: string;
  container?: string;
  volume?: string;
  url?: string;
  type: SourceType;
}

const clean = (v: unknown): string => (v === null || v === undefined ? "" : String(v).trim());
const names = (v: string): string[] => v.split(/\s*;\s*|\s*\n\s*/).map((x) => x.trim()).filter(Boolean);

export function isNlib(db: { exec: (q: string) => unknown }, tabs: string[]): boolean {
  return tabs.includes("entries") && tabs.includes("meta");
}

export async function readNlibMeta(bytes: Uint8Array): Promise<NlibMeta> {
  const db = await openDb(bytes);
  try {
    const t = tables(db);
    if (!isNlib(db, t)) throw new Error("This is not a Booker reference library (no meta and entries tables).");
    const m: Record<string, string> = {};
    for (const r of rows(db, "select key, value from meta")) m[clean(r.key).toLowerCase()] = clean(r.value);
    const type = (["book", "chapter", "article", "web"] as const).find((x) => x === m.source_type) ?? "book";
    return {
      title: m.title || "Untitled library",
      authors: names(m.author ?? ""),
      category: m.category || "reference",
      type,
      ...(m.year && { year: m.year }),
      ...(m.publisher && { publisher: m.publisher }),
      ...(m.place && { place: m.place }),
      ...(m.edition && { edition: m.edition }),
      ...(m.container && { container: m.container }),
      ...(m.volume && { volume: m.volume }),
      ...(m.url && { url: m.url }),
    };
  } finally {
    db.close();
  }
}

/** Every entry in reading order. */
export async function readNlibEntries(bytes: Uint8Array): Promise<NlibEntry[]> {
  const db = await openDb(bytes);
  try {
    return rows(db, "select id, parent, level, locator, key, title, text from entries order by coalesce(seq, id), id").map((r) => ({
      id: Number(r.id),
      parent: r.parent === null || r.parent === undefined ? null : Number(r.parent),
      level: clean(r.level),
      locator: clean(r.locator),
      key: clean(r.key),
      title: clean(r.title),
      text: typeof r.text === "string" ? r.text : "",
    }));
  } finally {
    db.close();
  }
}

/** Where an entry is: its own locator, else the titles of the entry and its parents ("Book III › Chapter 5"). */
export function locatorOf(e: NlibEntry, byId: Map<number, NlibEntry>): string {
  if (e.locator) return e.locator;
  const path: string[] = [];
  const seen = new Set<number>();
  for (let cur: NlibEntry | undefined = e; cur && !seen.has(cur.id); cur = cur.parent === null ? undefined : byId.get(cur.parent)) {
    seen.add(cur.id);
    const part = cur.title || cur.key;
    if (part) path.unshift(part);
    if (path.length >= 4) break;
  }
  return path.join(" › ") || `entry ${e.id}`;
}

/** Searchable pieces: one per entry that has text, long ones split at paragraphs. */
export function nlibChunks(entries: NlibEntry[]): Chunk[] {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const out: Chunk[] = [];
  for (const e of entries) {
    if (!e.text.trim()) continue;
    const loc = locatorOf(e, byId);
    const head = [e.key && e.key !== e.title ? e.key : "", e.title].filter(Boolean).join(" ");
    const paras = e.text.split(/\n{2,}/);
    if (head) paras.unshift(head);
    const pieces = chunkParagraphs(paras, (n) => (n ? `${loc} (${n + 1})` : loc));
    pieces.forEach((c, i) => out.push(i === 0 ? { ...c, loc } : { ...c, loc: `${loc} (${i + 1})` }));
  }
  return out;
}

/** An e-Sword or MySword dictionary read as a library, so every lexicon you own can be searched with the rest. */
export async function dictionaryEntries(bytes: Uint8Array, id: string): Promise<{ meta: NlibMeta; entries: NlibEntry[] }> {
  const d = await readEswordDictionary(id, bytes);
  return {
    meta: { title: d.name || id, authors: [], category: "lexicon", type: "book" },
    entries: d.entries.map((e, i) => ({ id: i + 1, parent: null, level: "entry", locator: e.word, key: e.word, title: e.word, text: e.text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() })),
  };
}

/** Read any database source: a Booker library, a database with a field mapping, or an e-Sword dictionary. */
export async function readDatabase(bytes: Uint8Array, id: string, map?: DbMap | null): Promise<{ meta: NlibMeta; entries: NlibEntry[] }> {
  if (map?.table) return { meta: { title: id.replace(/\.[^.]+$/, ""), authors: [], category: "reference", type: "book" }, entries: await readMappedEntries(bytes, map) };
  const db = await openDb(bytes);
  let ours = false;
  try {
    ours = isNlib(db, tables(db));
  } finally {
    db.close();
  }
  if (ours) return { meta: await readNlibMeta(bytes), entries: await readNlibEntries(bytes) };
  return dictionaryEntries(bytes, id);
}
