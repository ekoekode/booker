/** The books a picker offers, in groups. Pure. */
import { BOOK_BY_OSIS } from "../scripture/books";

export interface BookGroup {
  label: string;
  books: Array<{ osis: string; name: string }>;
}

/** The books a Bible or commentary has, as Old Testament, New Testament and the rest, in canon order. */
export function bookGroups(have: string[]): BookGroup[] {
  const groups: BookGroup[] = [
    { label: "Old Testament", books: [] },
    { label: "New Testament", books: [] },
    { label: "Other books", books: [] },
  ];
  for (const osis of have) {
    const b = BOOK_BY_OSIS.get(osis);
    const entry = { osis, name: b?.name ?? osis };
    const n = b?.num ?? 999;
    groups[n <= 39 ? 0 : n <= 66 ? 1 : 2].books.push(entry);
  }
  return groups.filter((g) => g.books.length);
}

/** The numbers 1 to n, for a grid of chapters or verses. */
export const numbers = (n: number): number[] => Array.from({ length: Math.max(0, n) }, (_, i) => i + 1);
