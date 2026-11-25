/** Which fields of a database Booker uses, kept in a small file next to the database so it travels with it. */
import { columns, openDb, rows, tables } from "../scripture/sqlite";
import type { NlibEntry } from "./nlib";

export type MapField = "key" | "title" | "text" | "locator" | "parent" | "level" | "order";
export const MAP_FIELDS: MapField[] = ["title", "key", "text", "locator", "parent", "level", "order"];

export interface DbMap {
  /** for a database that is not a Booker library: the table and which column holds each field */
  table?: string;
  columns?: Partial<Record<MapField, string>>;
  /** the fields shown and filtered on when browsing */
  nav: { title: boolean; key: boolean; locator: boolean };
}

export const DEFAULT_NAV: DbMap["nav"] = { title: true, key: true, locator: true };
export const mapPath = (file: string): string => `${file}.map.json`;

export function parseMap(json: string): DbMap | null {
  try {
    const m = JSON.parse(json) as Partial<DbMap>;
    if (!m || typeof m !== "object") return null;
    const nav = { ...DEFAULT_NAV, ...(m.nav ?? {}) };
    const cols: DbMap["columns"] = {};
    for (const f of MAP_FIELDS) if (typeof m.columns?.[f] === "string" && m.columns[f]) cols[f] = m.columns[f];
    return { ...(typeof m.table === "string" && m.table ? { table: m.table } : {}), ...(Object.keys(cols).length ? { columns: cols } : {}), nav: { title: !!nav.title, key: !!nav.key, locator: !!nav.locator } };
  } catch {
    return null;
  }
}

/** Blank the fields switched off for browsing, so labels and the filter skip them. At least one stays on. */
export function applyNav(entries: NlibEntry[], nav: DbMap["nav"]): NlibEntry[] {
  if (nav.title && nav.key && nav.locator) return entries;
  if (!nav.title && !nav.key && !nav.locator) return entries;
  return entries.map((e) => ({ ...e, title: nav.title ? e.title : "", key: nav.key ? e.key : "", locator: nav.locator ? e.locator : "" }));
}

const TEXT = /text|content|body|data|def|descr|scripture|verse|article|entry_text/i;
const HEAD = /^(word|topic|term|entry|title|name|heading|headword|key|lemma)$/i;
const PARENT = /^(parent|parent_id|parentid)$/i;
const ORDER = /^(seq|ord|order|position|sort|sortorder)$/i;
const LOC = /^(locator|ref|reference|loc|number|no|chapter)$/i;
const LEVEL = /^(level|type|kind)$/i;

/** Guess a mapping from table and column names; null when nothing looks like text. */
export function suggestMapping(cols: Record<string, string[]>): DbMap | null {
  let best: { score: number; table: string; map: DbMap["columns"] } | null = null;
  for (const [table, list] of Object.entries(cols)) {
    const text = list.find((c) => TEXT.test(c));
    if (!text) continue;
    const head = list.find((c) => HEAD.test(c) && c !== text);
    const map: DbMap["columns"] = { text };
    if (head) map.title = head;
    const key = list.find((c) => /^(key|word|lemma|term)$/i.test(c) && c !== head && c !== text);
    if (key) map.key = key;
    const parent = list.find((c) => PARENT.test(c));
    if (parent) map.parent = parent;
    const order = list.find((c) => ORDER.test(c));
    if (order) map.order = order;
    const loc = list.find((c) => LOC.test(c) && c !== head && c !== text);
    if (loc) map.locator = loc;
    const level = list.find((c) => LEVEL.test(c) && c !== text);
    if (level) map.level = level;
    const score = 1 + (head ? 2 : 0) + (parent ? 1 : 0) + (key ? 1 : 0);
    if (!best || score > best.score) best = { score, table, map };
  }
  return best ? { table: best.table, columns: best.map, nav: { ...DEFAULT_NAV } } : null;
}

const q = (s: string) => `"${s.replace(/"/g, "")}"`;
const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v).trim());

/** The tables of a database and their columns, for choosing a mapping. */
export async function describeDatabase(bytes: Uint8Array): Promise<Record<string, string[]>> {
  const db = await openDb(bytes);
  try {
    const out: Record<string, string[]> = {};
    for (const t of tables(db)) out[t] = columns(db, t);
    return out;
  } finally {
    db.close();
  }
}

/** Read the entries of any SQLite database through a mapping. Column names are checked against the table before they reach the query. */
export async function readMappedEntries(bytes: Uint8Array, map: DbMap, limit = 500000): Promise<NlibEntry[]> {
  if (!map.table || !map.columns) throw new Error("This database has no field mapping yet.");
  const db = await openDb(bytes);
  try {
    const have = new Set(columns(db, map.table));
    if (!have.size) throw new Error(`The table “${map.table}” is not in this database.`);
    const picks: string[] = ["rowid as _id"];
    for (const f of MAP_FIELDS) {
      const c = map.columns[f];
      if (c && have.has(c)) picks.push(`${q(c)} as _${f}`);
    }
    const order = map.columns.order && have.has(map.columns.order) ? `order by ${q(map.columns.order)}, rowid` : "order by rowid";
    const out: NlibEntry[] = [];
    for (const r of rows(db, `select ${picks.join(", ")} from ${q(map.table)} ${order} limit ${Math.max(1, Math.floor(limit))}`)) {
      const parent = r._parent === null || r._parent === undefined || r._parent === "" ? null : Number(r._parent);
      out.push({
        id: Number(r._id),
        parent: parent !== null && Number.isFinite(parent) ? parent : null,
        level: str(r._level) || "entry",
        locator: str(r._locator),
        key: str(r._key),
        title: str(r._title),
        text: typeof r._text === "string" ? r._text.replace(/<[^>]+>/g, " ").replace(/[ \t]+/g, " ").trim() : str(r._text),
      });
    }
    return out;
  } finally {
    db.close();
  }
}
