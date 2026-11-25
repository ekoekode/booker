/** What the Bible reader's one box makes of what was typed. Pure. */
import { BOOKS, bookKey, findBook } from "./books";
import { parseRefs, type Passage } from "./ref";

export type Typed =
  | { kind: "empty" }
  /** a complete reference: John 3:16, Ps 23, Gen 1:1-3 */
  | { kind: "ref"; passage: Passage; book: string; chapter: number; verse: number }
  /** the start of a book name: "rom" */
  | { kind: "books"; books: string[] }
  /** anything else, searched as words */
  | { kind: "search"; words: string[] };

/**
 * Decide what to do with the text. `have` lists the books the open Bible carries, in order, so a prefix such as "rom"
 * only offers books that exist there. A bare book name ("Romans") opens its first chapter.
 */
export function interpret(input: string, have: string[]): Typed {
  const text = input.trim();
  if (!text) return { kind: "empty" };
  const first = parseRefs(text)?.[0];
  const hasDigit = /\d/.test(text.replace(/^[1-3I]+\s*(?=[a-z])/i, ""));
  const prefixed = (): string[] => {
    const key = bookKey(text);
    if (key.length < 2 || /\d$/.test(text) || /\s/.test(text.replace(/^[1-3]\s/, ""))) return [];
    return BOOKS.filter((b) => have.includes(b.osis) && [b.name, b.sbl, b.short, ...b.aliases].some((n) => bookKey(n).startsWith(key) || bookKey(n).replace(/^\d/, "").startsWith(key))).map((b) => b.osis);
  };
  if (first && have.includes(first.book) && hasDigit) return { kind: "ref", passage: first, book: first.book, chapter: first.from.c, verse: first.from.v ?? 0 };
  const bare = findBook(text);
  const names = prefixed();
  if (bare && have.includes(bare.osis) && (names.length <= 1 || bookKey(text) === bookKey(bare.name))) {
    return { kind: "ref", passage: { book: bare.osis, from: { c: 1, v: null }, to: { c: 1, v: null } }, book: bare.osis, chapter: 1, verse: 0 };
  }
  if (names.length) return { kind: "books", books: names };
  return { kind: "search", words: text.toLowerCase().split(/\s+/).filter(Boolean) };
}

/** True when pausing on this text should open it by itself: a whole reference, not a book name still being typed. */
export const opensByItself = (t: Typed, text: string): boolean => t.kind === "ref" && /\d/.test(text);
