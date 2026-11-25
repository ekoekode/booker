/** Loose matching for lists you type into: every word you type must be found, as part of a word, a near spelling, or letters in order. Pure. */
import { nearlyEqual } from "./sources/fuzzy";

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase();

/** How well one typed word matches the target (0 = not at all). */
function wordScore(w: string, target: string, words: string[]): number {
  if (words.includes(w)) return 100;
  if (words.some((x) => x.startsWith(w))) return 80;
  if (target.includes(w)) return 60;
  if (w.length >= 4 && words.some((x) => x[0] === w[0] && nearlyEqual(x, w))) return 40;
  if (w.length >= 3) {
    let at = 0;
    for (const c of w) {
      at = target.indexOf(c, at) + 1;
      if (!at) return 0;
    }
    return 15;
  }
  return 0;
}

/** A score for how well `query` matches `text`, or null when some word of it does not. An empty query matches everything. */
export function fuzzyScore(query: string, text: string): number | null {
  const q = fold(query).split(/\s+/).filter(Boolean);
  if (!q.length) return 0;
  const target = fold(text);
  const words = target.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  let total = 0;
  for (const w of q) {
    const s = wordScore(w, target, words);
    if (!s) return null;
    total += s;
  }
  return total / q.length;
}

/** The items that match, best first (the original order among equals). */
export function fuzzyFilter<T>(items: T[], query: string, text: (t: T) => string): T[] {
  if (!query.trim()) return items;
  return items
    .map((t, i) => ({ t, i, s: fuzzyScore(query, text(t)) }))
    .filter((x): x is { t: T; i: number; s: number } => x.s !== null)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.t);
}
