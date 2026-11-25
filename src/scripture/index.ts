/** The scripture index at the back of a book: every reference used, with the chapters it appears in. Pure. */
import { BOOKS, BOOK_BY_OSIS } from "./books";
import { formatPassage, parseRefs, type Passage } from "./ref";

const CAND = /((?:[1-3]|I{1,3})?\s?[A-Z][A-Za-z.]*(?:\s[A-Za-z]{2,}){0,2})\s(\d{1,3}(?::\d{1,3}[a-c]?(?:\s?[-–]\s?\d{1,3}(?::\d{1,3})?[a-c]?)?(?:,\s?\d{1,3}[a-c]?)*|\s?[-–]\s?\d{1,3})?)/g;

export interface Located {
  from: number;
  to: number;
  text: string;
  passages: Passage[];
}

/** Where references sit in running text, with what they say. A bare chapter ("Romans 8") counts; so does "John 3:16-18" and "1 Cor 13:4-7a, 9". */
export function locateReferences(text: string): Located[] {
  const out: Located[] = [];
  for (const m of text.matchAll(CAND)) {
    const words = m[1].trim().split(/\s+/);
    // "see John 3:16" or "In Romans 8": drop leading words until a book name is left
    for (let i = 0; i < words.length && i < 4; i++) {
      const name = words.slice(i).join(" ");
      if (!/^[1-3IVX]*\s?[A-Z]/.test(name)) continue;
      const found = parseRefs(`${name} ${m[2]}`);
      if (found) {
        const to = m.index! + m[0].length;
        const whole = `${name} ${m[2]}`;
        out.push({ from: to - whole.length, to, text: text.slice(to - whole.length, to), passages: found });
        break;
      }
    }
  }
  return out;
}

/** The passages of every reference in the text. */
export function scanReferences(text: string): Passage[] {
  return locateReferences(text).flatMap((l) => l.passages);
}

const posKey = (p: { c: number; v: number | null }) => p.c * 1000 + (p.v ?? 0);

export interface IndexEntry {
  label: string;
  where: string[];
}

/** Group references by book in canon order, each passage once, with the places it was found (first appearance order). */
export function buildScriptureIndex(found: { passage: Passage; where: string }[]): { book: string; entries: IndexEntry[] }[] {
  const byKey = new Map<string, { passage: Passage; where: string[] }>();
  for (const f of found) {
    const k = `${f.passage.book}|${f.passage.from.c}:${f.passage.from.v}${f.passage.from.part ?? ""}|${f.passage.to.c}:${f.passage.to.v}${f.passage.to.part ?? ""}`;
    const e = byKey.get(k) ?? { passage: f.passage, where: [] };
    if (!e.where.includes(f.where)) e.where.push(f.where);
    byKey.set(k, e);
  }
  const groups = new Map<string, { passage: Passage; where: string[] }[]>();
  for (const e of byKey.values()) groups.set(e.passage.book, [...(groups.get(e.passage.book) ?? []), e]);
  return BOOKS.filter((b) => groups.has(b.osis)).map((b) => ({
    book: b.name,
    entries: groups
      .get(b.osis)!
      .sort((x, y) => posKey(x.passage.from) - posKey(y.passage.from) || posKey(x.passage.to) - posKey(y.passage.to))
      .map((e) => ({ label: formatPassage(e.passage, BOOK_BY_OSIS.get(e.passage.book)!), where: e.where })),
  }));
}
