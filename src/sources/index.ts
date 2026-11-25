/**
 * A small full-text index for one source: every word points at the chunks it appears in. Words are folded so that
 * accents, case and Hebrew vowel points do not matter. Pure and serialisable.
 */
import { MATCH_WEIGHT, matchWord, type SearchMode } from "./fuzzy";
import type { Chunk } from "./types";

export interface SourceIndex {
  v: 1;
  chunks: Chunk[];
  /** word -> chunk numbers */
  terms: Record<string, number[]>;
}

/** Lower case, no accents, no Hebrew vowel points or cantillation, no Greek breathing marks. */
export function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-֑ͯ-ׇ]/g, "").toLowerCase();
}

export function tokens(s: string): string[] {
  return fold(s).match(/[\p{L}\p{N}][\p{L}\p{N}'’]*/gu)?.map((t) => t.replace(/['’]s$/, "").replace(/['’]/g, "")) ?? [];
}

export function buildIndex(chunks: Chunk[]): SourceIndex {
  const terms: Record<string, number[]> = Object.create(null);
  chunks.forEach((c, i) => {
    for (const t of new Set(tokens(c.text))) (terms[t] ??= []).push(i);
  });
  return { v: 1, chunks, terms };
}

export interface Hit {
  chunk: number;
  score: number;
}

/** "grace" "free will" or "predestination -election": quoted phrases must appear whole; the last word may be a start. */
export function parseQuery(q: string): { words: string[]; phrases: string[]; not: string[] } {
  const phrases: string[] = [];
  const rest = q.replace(/"([^"]+)"/g, (_, p: string) => {
    phrases.push(fold(p).replace(/\s+/g, " ").trim());
    return " ";
  });
  const words: string[] = [];
  const not: string[] = [];
  for (const w of rest.split(/\s+/).filter(Boolean)) {
    if (w.startsWith("-") && w.length > 1) not.push(...tokens(w.slice(1)));
    else words.push(...tokens(w));
  }
  for (const p of phrases) words.push(...tokens(p));
  return { words, phrases, not };
}

export function search(ix: SourceIndex, q: string, limit = 50, mode: SearchMode = "exact"): Hit[] {
  const { words, phrases, not } = parseQuery(q);
  if (!words.length) return [];
  let result = new Map<number, number>();
  for (let wi = 0; wi < words.length; wi++) {
    const w = words[wi];
    const prefix = wi === words.length - 1 && !phrases.length && w.length >= 3;
    const found = new Map<number, number>();
    const add = (list: number[], weight = 1) => {
      for (const c of list) found.set(c, (found.get(c) ?? 0) + weight);
    };
    if (mode === "fuzzy") {
      // every form of the word the text has: the word itself, its stem, words that start with it, one-letter slips
      for (const t in ix.terms) {
        const m = matchWord(t, w);
        if (m) add(ix.terms[t], MATCH_WEIGHT[m]);
      }
    } else {
      if (ix.terms[w]) add(ix.terms[w]);
      if (prefix) for (const t in ix.terms) if (t !== w && t.startsWith(w)) add(ix.terms[t]);
    }
    result = wi === 0 ? found : new Map([...result].filter(([c]) => found.has(c)).map(([c, s]) => [c, s + found.get(c)!] as [number, number]));
  }
  let hits = [...result].map(([chunk, score]) => ({ chunk, score }));
  if (not.length) hits = hits.filter((h) => !not.some((n) => tokens(ix.chunks[h.chunk].text).includes(n)));
  for (const p of phrases) hits = hits.filter((h) => fold(ix.chunks[h.chunk].text).replace(/\s+/g, " ").includes(p));
  return hits.sort((a, b) => b.score - a.score || a.chunk - b.chunk).slice(0, limit);
}

/** A window of text around the first match, with the words that matched. */
export function snippet(text: string, q: string, width = 160): string {
  const { words, phrases } = parseQuery(q);
  const flat = text.replace(/\s+/g, " ");
  const low = fold(flat);
  let at = -1;
  for (const p of phrases) {
    at = low.indexOf(p);
    if (at >= 0) break;
  }
  if (at < 0) for (const w of words) {
    at = low.indexOf(w);
    if (at >= 0) break;
  }
  if (at < 0) at = 0;
  const from = Math.max(0, at - Math.floor(width / 3));
  const out = flat.slice(from, from + width);
  return (from > 0 ? "…" : "") + out + (from + width < flat.length ? "…" : "");
}
