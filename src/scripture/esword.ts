/**
 * e-Sword (.bblx, .cmtx, .dctx and the other .xxxx files) and MySword (.bbl.mybible, .cmt.mybible, .dct.mybible):
 * SQLite databases. Columns are looked up by name so small differences between the two programs and between
 * versions do not matter.
 */
import { BOOK_BY_NUM, BOOK_BY_OSIS } from "./books";
import { decodeEntities, MemoryBible, verseKey, type RawBible } from "./module";
import { columns, openDb, rows, tables } from "./sqlite";

export class LockedModuleError extends Error {
  constructor() {
    super("This module is locked or not a readable e-Sword or MySword file. Modules bought from a publisher are often protected; free and unlocked ones open.");
  }
}

const pick = (cols: string[], ...names: RegExp[]) => {
  for (const n of names) {
    const c = cols.find((x) => n.test(x));
    if (c) return c;
  }
  return undefined;
};

function details(db: Awaited<ReturnType<typeof openDb>>, ts: string[]) {
  const t = ts.find((x) => /^details$/i.test(x));
  if (!t) return {} as Record<string, any>;
  return rows(db, `select * from "${t}" limit 1`)[0] ?? {};
}

const lower = (o: Record<string, any>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k.toLowerCase(), v]));

/** A module's title as it is shown: some modules carry a "(draft)" the reader does not need to see. */
const shownTitle = (t: string) => t.replace(/\s*\(draft\)\s*$/i, "").trim();

/** A module's own title (its Details table), without reading the text. */
export async function readEswordTitle(bytes: Uint8Array): Promise<string> {
  let db;
  try {
    db = await openDb(bytes);
  } catch {
    return "";
  }
  try {
    const d = lower(details(db, tables(db)));
    return shownTitle(String(d.description ?? d.title ?? ""));
  } catch {
    return "";
  } finally {
    db.close();
  }
}

/** A Bible module as a MemoryBible. */
export async function readEswordBible(id: string, bytes: Uint8Array): Promise<MemoryBible> {
  let db;
  try {
    db = await openDb(bytes);
  } catch {
    throw new LockedModuleError();
  }
  try {
    const ts = tables(db);
    const t = ts.find((x) => /^bible$/i.test(x)) ?? ts.find((x) => columns(db, x).some((c) => /^scripture$/i.test(c)));
    if (!t) throw new LockedModuleError();
    const cols = columns(db, t);
    const book = pick(cols, /^book$/i);
    const ch = pick(cols, /^chapter$/i);
    const vs = pick(cols, /^verse$/i);
    const text = pick(cols, /^scripture$/i, /^text$/i);
    if (!book || !ch || !vs || !text) throw new LockedModuleError();
    const d = lower(details(db, ts));
    const verses = new Map<string, string>();
    for (const r of rows(db, `select "${book}" b, "${ch}" c, "${vs}" v, "${text}" t from "${t}"`)) {
      const b = BOOK_BY_NUM.get(Number(r.b));
      if (!b || typeof r.t !== "string") continue;
      verses.set(verseKey(b.osis, Number(r.c), Number(r.v)), r.t);
    }
    if (!verses.size) throw new LockedModuleError();
    const raw: RawBible = {
      name: shownTitle(String(d.description ?? d.title ?? id)),
      abbr: String(d.abbreviation ?? "").trim(),
      rtl: Number(d.righttoleft) === 1,
      verses,
      markup: "esword",
    };
    return new MemoryBible(id, raw);
  } finally {
    db.close();
  }
}

export interface DictEntry {
  word: string;
  text: string;
}

/** Turn the light HTML of dictionary and commentary entries into plain text with paragraph breaks. */
export function entryText(html: string): string {
  const text = decodeEntities(
    html
      .replace(/<RF[^>]*>[\s\S]*?<Rf>/g, "")
      .replace(/<\/?(?:br|p|div|CM|CL|li|tr|h\d)\b[^>]*>/gi, "\n")
      .replace(/<[^>]*>/g, "")
  );
  return text.split("\n").map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n\n");
}

export interface DictionaryModule {
  id: string;
  name: string;
  entries: DictEntry[];
}

/** A dictionary or lexicon (.dctx, .dct.mybible, and Strong's-style lexicons). */
export async function readEswordDictionary(id: string, bytes: Uint8Array): Promise<DictionaryModule> {
  let db;
  try {
    db = await openDb(bytes);
  } catch {
    throw new LockedModuleError();
  }
  try {
    const ts = tables(db);
    const t = ts.find((x) => !/^details$/i.test(x) && columns(db, x).some((c) => /word|topic|term|entry/i.test(c)) && columns(db, x).some((c) => /def|data|content|text|desc/i.test(c)));
    if (!t) throw new LockedModuleError();
    const cols = columns(db, t);
    const w = pick(cols, /^word$/i, /^topic$/i, /^term$/i, /entry/i, /word|topic/i)!;
    const dcol = pick(cols, /^definition$/i, /^data$/i, /^content$/i, /def|data|text|desc/i)!;
    const d = lower(details(db, ts));
    const entries: DictEntry[] = [];
    for (const r of rows(db, `select "${w}" w, "${dcol}" d from "${t}"`)) if (typeof r.w === "string" && typeof r.d === "string") entries.push({ word: r.w.trim(), text: r.d });
    return { id, name: shownTitle(String(d.description ?? d.title ?? id)), entries };
  } finally {
    db.close();
  }
}

export interface CommentaryModule {
  id: string;
  name: string;
  /** notes covering a verse */
  at(book: string, c: number, v: number): string[];
}

/** A commentary (.cmtx, .cmt.mybible). */
export async function readEswordCommentary(id: string, bytes: Uint8Array): Promise<CommentaryModule> {
  let db;
  try {
    db = await openDb(bytes);
  } catch {
    throw new LockedModuleError();
  }
  try {
    const ts = tables(db);
    const t = ts.find((x) => /^commentary$/i.test(x)) ?? ts.find((x) => columns(db, x).some((c) => /^comments$/i.test(c)));
    if (!t) throw new LockedModuleError();
    const cols = columns(db, t);
    const book = pick(cols, /^book$/i)!;
    const c1 = pick(cols, /^chapterbegin$/i, /^chapter$/i)!;
    const c2 = pick(cols, /^chapterend$/i);
    const v1 = pick(cols, /^versebegin$/i, /^fromverse$/i, /^verse$/i)!;
    const v2 = pick(cols, /^verseend$/i, /^toverse$/i);
    const body = pick(cols, /^comments$/i, /^data$/i, /^text$/i);
    if (!book || !c1 || !v1 || !body) throw new LockedModuleError();
    const d = lower(details(db, ts));
    const all = rows(db, `select "${book}" b, "${c1}" c1, ${c2 ? `"${c2}"` : `"${c1}"`} c2, "${v1}" v1, ${v2 ? `"${v2}"` : `"${v1}"`} v2, "${body}" t from "${t}"`);
    return {
      id,
      name: shownTitle(String(d.description ?? d.title ?? id)),
      at(bk, c, v) {
        const n = [...BOOK_BY_NUM].find(([, b]) => b.osis === bk)?.[0];
        return all
          .filter((r) => Number(r.b) === n && (Number(r.c1) < c || (Number(r.c1) === c && Number(r.v1) <= v)) && (Number(r.c2) > c || (Number(r.c2) === c && (Number(r.v2) >= v || Number(r.v2) === 0))))
          .map((r) => entryText(String(r.t)));
      },
    };
  } finally {
    db.close();
  }
}

/** A commentary kept open, so big ones (tens of thousands of notes) are queried a verse at a time instead of loaded whole. */
export interface CommentaryRow {
  /** first and last verse the note covers; 0 for a note on the chapter as a whole */
  from: number;
  to: number;
  text: string;
}

export interface LiveCommentary extends CommentaryModule {
  /** books the commentary has notes on, as Booker book ids in canon order */
  books(): string[];
  /** chapters with notes in a book */
  chapters(book: string): number[];
  /** every note of a chapter, in the module's order */
  chapterRows(book: string, chapter: number): CommentaryRow[];
  close(): void;
}

export async function openLiveCommentary(id: string, bytes: Uint8Array): Promise<LiveCommentary> {
  let db;
  try {
    db = await openDb(bytes);
  } catch {
    throw new LockedModuleError();
  }
  const ts = tables(db);
  const t = ts.find((x) => /^commentary$/i.test(x)) ?? ts.find((x) => columns(db, x).some((c) => /^comments$/i.test(c)));
  if (!t) {
    db.close();
    throw new LockedModuleError();
  }
  const cols = columns(db, t);
  const book = pick(cols, /^book$/i)!;
  const c1 = pick(cols, /^chapterbegin$/i, /^chapter$/i)!;
  const c2 = pick(cols, /^chapterend$/i) ?? c1;
  const v1 = pick(cols, /^versebegin$/i, /^fromverse$/i, /^verse$/i)!;
  const v2 = pick(cols, /^verseend$/i, /^toverse$/i) ?? v1;
  const body = pick(cols, /^comments$/i, /^data$/i, /^text$/i)!;
  const d = lower(details(db, ts));
  const q = `select "${body}" t from "${t}" where "${book}" = ? and ("${c1}" < ? or ("${c1}" = ? and "${v1}" <= ?)) and ("${c2}" > ? or ("${c2}" = ? and ("${v2}" >= ? or "${v2}" = 0))) order by rowid limit 300`;
  return {
    id,
    name: shownTitle(String(d.description ?? d.title ?? id)),
    at(bk, c, v) {
      const n = BOOK_BY_OSIS.get(bk)?.num;
      if (!n) return [];
      return rows(db, q, [n, c, c, v, c, c, v]).map((r) => entryText(String(r.t)));
    },
    books() {
      const have = new Set(rows(db, `select distinct "${book}" b from "${t}"`).map((r) => Number(r.b)));
      return [...BOOK_BY_NUM].filter(([n]) => have.has(n)).map(([, b]) => b.osis);
    },
    chapters(bk) {
      const n = BOOK_BY_OSIS.get(bk)?.num;
      if (!n) return [];
      return rows(db, `select distinct "${c1}" c from "${t}" where "${book}" = ? order by 1`, [n]).map((r) => Number(r.c)).filter((c) => c > 0);
    },
    chapterRows(bk, c) {
      const n = BOOK_BY_OSIS.get(bk)?.num;
      if (!n) return [];
      const r = rows(db, `select "${v1}" a, "${v2}" z, "${body}" t from "${t}" where "${book}" = ? and "${c1}" <= ? and "${c2}" >= ? order by "${v1}", rowid limit 400`, [n, c, c]);
      return r.map((x) => ({ from: Number(x.a), to: Math.max(Number(x.a), Number(x.z)), text: entryText(String(x.t)) }));
    },
    close() {
      db.close();
    },
  };
}
