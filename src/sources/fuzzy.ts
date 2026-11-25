/** Looser word matching for search: the same word in another form (stemming), the start of a word, and a one-letter slip. Pure. */
import { stemmer } from "stemmer";

export type SearchMode = "exact" | "fuzzy" | "semantic";

const cache = new Map<string, string>();

/** The stem of a folded word: "running", "runs" and "ran"-like forms of one word meet. Words with digits or other scripts are left as they are. */
export function stem(word: string): string {
  if (!/^[a-z]+$/.test(word)) return word;
  let s = cache.get(word);
  if (s === undefined) {
    s = stemmer(word);
    if (cache.size > 50000) cache.clear();
    cache.set(word, s);
  }
  return s;
}

/** True when two words differ by at most one inserted, missing, changed or swapped letter. */
export function nearlyEqual(a: string, b: string): boolean {
  if (a === b) return true;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0;
  while (i < la && i < lb && a[i] === b[i]) i++;
  if (i === la || i === lb) return Math.abs(la - lb) <= 1; // one is the other plus a letter at the end
  if (la === lb) {
    if (a.slice(i + 1) === b.slice(i + 1)) return true; // one letter changed
    return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2); // two letters swapped
  }
  return la > lb ? a.slice(i + 1) === b.slice(i) : b.slice(i + 1) === a.slice(i);
}

export type MatchKind = "exact" | "stem" | "prefix" | "near";

/** How a word of the text matches a word the user typed, or null. Both are folded. Exact wins over stem, stem over prefix, prefix over near. */
export function matchWord(term: string, word: string): MatchKind | null {
  if (term === word) return "exact";
  if (stem(term) === stem(word)) return "stem";
  if (word.length >= 3 && term.startsWith(word)) return "prefix";
  if (word.length >= 5 && term[0] === word[0] && nearlyEqual(term, word)) return "near";
  return null;
}

export const MATCH_WEIGHT: Record<MatchKind, number> = { exact: 3, stem: 2, prefix: 2, near: 1 };
