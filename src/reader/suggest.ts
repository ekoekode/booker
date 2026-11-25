/** What the Reader's one box offers as you type: a passage, a book, a source or work to open, or a search. Pure. */
import { interpret } from "../scripture/omnibox";
import { BOOK_BY_OSIS } from "../scripture/books";
import { databaseLabel, databaseOf, databases, workOf } from "../sources/catalog";
import type { Source } from "../sources/types";
import type { Place } from "./place";

export type Suggestion =
  | { kind: "passage"; label: string; book: string; chapter: number; verse: number }
  | { kind: "book"; label: string; book: string }
  | { kind: "open"; label: string; note: string; place: Place }
  | { kind: "bible"; label: string; path: string }
  | { kind: "search"; label: string; text: string };

export interface SuggestContext {
  /** books the open Bible has */
  books: string[];
  sources: Source[];
  bibles: Array<{ path: string; name: string }>;
  commentaries: Array<{ path: string; name: string }>;
}

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const matches = (hay: string, words: string[]) => words.every((w) => hay.includes(w));

/** At most `limit` suggestions, best first; the last is always a search for the text as typed. */
export function suggest(input: string, ctx: SuggestContext, limit = 8): Suggestion[] {
  const text = input.trim();
  if (!text) return [];
  const out: Suggestion[] = [];
  const t = interpret(text, ctx.books);
  const name = (osis: string) => BOOK_BY_OSIS.get(osis)?.name ?? osis;
  if (t.kind === "ref") out.push({ kind: "passage", label: `${name(t.book)} ${t.chapter}${t.verse ? `:${t.verse}` : ""}`, book: t.book, chapter: t.chapter, verse: t.verse });
  else if (t.kind === "books") for (const b of t.books.slice(0, 4)) out.push({ kind: "book", label: name(b), book: b });

  const words = fold(text).split(/\s+/).filter(Boolean);
  if (t.kind !== "ref" && words.length) {
    for (const b of ctx.bibles) if (matches(fold(b.name), words)) out.push({ kind: "bible", label: b.name, path: b.path });
    for (const c of ctx.commentaries) if (matches(fold(c.name), words)) out.push({ kind: "open", label: c.name, note: "Commentary", place: { kind: "commentary", path: c.path } });
    for (const d of databases(ctx.sources)) if (matches(fold(d.label), words)) out.push({ kind: "open", label: d.label, note: d.note, place: { kind: "works", db: d.id } });
    let works = 0;
    for (const s of ctx.sources) {
      if (works >= 5) break;
      const w = workOf(s);
      if (matches(fold(`${s.title} ${w.author}`), words)) {
        out.push({ kind: "open", label: s.title, note: [w.author, databaseLabel(databaseOf(s))].filter(Boolean).join(" · "), place: { kind: "work", uid: s.uid, entry: 0 } });
        works++;
      }
    }
  }
  const search: Suggestion = { kind: "search", label: `Search for “${text}”`, text };
  return [...out.slice(0, Math.max(0, limit - 1)), search];
}
