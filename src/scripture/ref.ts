/**
 * Reading and writing scripture references: "jn 3:16-18", "1 cor 13:4-7a", "Rom 8:28, 31", "Ps 23",
 * "Gen 1:1-2:3", "Ps 119:105; Prov 3:5". Pure: no Obsidian, no module data.
 */
import { bookName, findBook, type Book, type BookNaming } from "./books";

/** A place in a book. `v` null means the whole chapter; `part` is a, b or c, a piece of a verse. */
export interface Pos {
  c: number;
  v: number | null;
  part?: string;
}

/** One passage: a book and a stretch from one place to another (the same place for a single verse). */
export interface Passage {
  book: string;
  from: Pos;
  to: Pos;
}

const PART = /^[a-e]$/;

function pos(s: string): { c?: number; v?: number; part?: string } | null {
  const m = /^(\d{1,3})(?:(?:\s*[:.]\s*|\s+)(\d{1,3})([a-e])?)?$/.exec(s.trim());
  if (!m) return null;
  return m[2] ? { c: +m[1], v: +m[2], part: m[3] } : { c: +m[1] };
}

const verse = (s: string): { v: number; part?: string } | null => {
  const m = /^(\d{1,3})([a-e])?$/.exec(s.trim());
  return m ? { v: +m[1], part: m[2] } : null;
};

const BOOK_AT_START = /^\s*((?:[1-3]\s*|(?:i{1,3}|first|second|third)\s+)?[a-z][a-z\s.]*?)\.?\s*(\d[\s\S]*|)$/i;

/** Read one segment (between semicolons) that begins with a book name, or carries on in the book before. */
function segment(text: string, last: Book | null): { book: Book; passages: Passage[] } | null {
  let book = last;
  let rest = text.trim();
  const m = BOOK_AT_START.exec(rest);
  if (m && !/^\d/.test(rest.replace(/^[1-3]\s*[a-z]/i, "x"))) {
    const found = findBook(m[1]);
    if (found) {
      book = found;
      rest = m[2].trim();
    } else if (!last) return null;
  }
  if (!book) return null;
  if (!rest) return { book, passages: [{ book: book.osis, from: { c: 1, v: null }, to: { c: 1, v: null } }] };
  const passages: Passage[] = [];
  let chapter: number | null = null; // the chapter in force for bare verse numbers after a comma
  let first = true;
  for (const item of rest.split(",")) {
    const parts = item.split("-").map((x) => x.trim());
    if (parts.length > 2 || !parts[0]) return null;
    const left = pos(parts[0]);
    let from: Pos;
    // a single-chapter book reads "Jude 5" as verse 5
    if (book.single && !/[:.]/.test(parts[0]) && chapter === null && left?.c !== undefined && left.v === undefined) {
      const v = verse(parts[0]);
      if (!v) return null;
      from = { c: 1, v: v.v, part: v.part };
      chapter = 1;
    } else if (left && left.v !== undefined) {
      chapter = left.c!;
      from = { c: left.c!, v: left.v, part: left.part };
    } else if (left && left.c !== undefined && (first || chapter === null)) {
      from = { c: left.c, v: null };
      chapter = left.c;
    } else {
      const v = verse(parts[0]);
      if (!v || chapter === null) return null;
      from = { c: chapter, v: v.v, part: v.part };
    }
    first = false;
    let to: Pos = { ...from };
    if (parts.length === 2) {
      const right = pos(parts[1]);
      if (right && right.v !== undefined) to = { c: right.c!, v: right.v, part: right.part };
      else if (from.v === null) {
        const c = /^\d{1,3}$/.test(parts[1]) ? +parts[1] : NaN;
        if (Number.isNaN(c)) return null;
        to = { c, v: null };
      } else {
        const v = verse(parts[1]);
        if (!v) return null;
        to = { c: from.c, v: v.v, part: v.part };
      }
    }
    if (to.c < from.c || (to.c === from.c && from.v !== null && to.v !== null && to.v < from.v)) return null;
    if (from.part && !PART.test(from.part)) return null;
    passages.push({ book: book.osis, from, to });
  }
  return { book, passages };
}

/** Everything typed as references, in order; null when any part cannot be read. */
export function parseRefs(input: string): Passage[] | null {
  const text = input.replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();
  if (!text) return null;
  const out: Passage[] = [];
  let last: Book | null = null;
  for (const seg of text.split(/[;]/)) {
    if (!seg.trim()) continue;
    const r = segment(seg, last);
    if (!r) return null;
    last = r.book;
    out.push(...r.passages);
  }
  return out.length ? out : null;
}

export interface RefStyle {
  naming: BookNaming;
  /** "–" for a range, or "-" */
  dash: string;
  /** after the first verse of a run in the same chapter, leave the chapter off: 3:16-18, not 3:16-3:18 */
  sep: string;
}

export const DEFAULT_REF_STYLE: RefStyle = { naming: "full", dash: "–", sep: ":" };

const pp = (p: Pos, sep: string, withChapter: boolean) => (p.v === null ? `${p.c}` : `${withChapter ? p.c + sep : ""}${p.v}${p.part ?? ""}`);

/** "John 3:16–18": one passage written out. */
export function formatPassage(p: Passage, book: Book, style: RefStyle = DEFAULT_REF_STYLE): string {
  const name = bookName(book, style.naming);
  const { from, to, } = p;
  const sameChapter = from.c === to.c;
  const single = sameChapter && from.v === to.v && from.part === to.part;
  // one-chapter books are cited by verse alone: "Jude 5"
  if (book.single && from.c === 1 && to.c === 1 && from.v !== null && to.v !== null) return `${name} ${from.v}${from.part ?? ""}${single ? "" : `${style.dash}${to.v}${to.part ?? ""}`}`;
  if (single) return `${name} ${pp(from, style.sep, true)}`;
  if (from.v === null) return `${name} ${from.c}${style.dash}${to.c}`;
  if (sameChapter) return `${name} ${pp(from, style.sep, true)}${style.dash}${to.v}${to.part ?? ""}`;
  return `${name} ${pp(from, style.sep, true)}${style.dash}${pp(to, style.sep, true)}`;
}

const REF_TAIL = /\d{1,3}(?:[:.]\d{1,3}[a-c]?(?:\s?[-–]\s?\d{1,3}(?::\d{1,3})?[a-c]?)?(?:,\s?\d{1,3}[a-c]?)*)?/g;

/** The scripture reference in a line of text that the character position touches ("John 3:16", "1 Cor 13:4-7a"), or null. */
export function referenceAt(line: string, ch: number): { from: number; to: number } | null {
  for (const m of line.matchAll(REF_TAIL)) {
    const end = m.index! + m[0].length;
    // the book name is up to three words (and a leading number) before the numbers
    const before = line.slice(0, m.index!).replace(/\s+$/, "");
    const words = [...before.matchAll(/(?:[1-3]|I{1,3})?\s?[A-Za-z][A-Za-z.]*/g)];
    for (let n = 1; n <= 4 && n <= words.length; n++) {
      const w = words[words.length - n];
      const start = w.index! + (w[0].length - w[0].trimStart().length);
      const text = line.slice(start, end);
      if (start + text.length !== end || !/^[1-3IVX]*\s?[A-Za-z]/.test(text)) continue;
      if (parseRefs(text) && ch >= start && ch <= end) return { from: start, to: end };
    }
  }
  return null;
}
