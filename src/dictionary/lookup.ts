/** Looking words up in an English dictionary module and reading its senses and synonyms. Pure. */
import { fold } from "../sources/index";

export interface Sense {
  /** "n.", "v.", "adj." or "adv." */
  pos: string;
  gloss: string;
  synonyms: string[];
}

export interface Found {
  /** the headword that matched, which may be a base form of what was typed */
  word: string;
  senses: Sense[];
}

/** Senses from an entry's text: "n. gloss" lines, each optionally followed by a "Synonyms: a, b" line. */
export function parseSenses(text: string): Sense[] {
  const out: Sense[] = [];
  for (const block of text.split(/\n\s*\n/)) {
    const lines = block.split("\n");
    const m = /^(n\.|v\.|adj\.|adv\.)\s+(.*)$/.exec(lines[0] ?? "");
    if (!m) continue;
    const syn = lines.find((l) => l.startsWith("Synonyms:"));
    out.push({ pos: m[1], gloss: m[2].trim(), synonyms: syn ? syn.slice(9).split(",").map((x) => x.trim()).filter(Boolean) : [] });
  }
  return out;
}

/** The forms to try for a typed word, most exact first: "running" tries running, run, runn, runne… */
export function candidates(raw: string): string[] {
  const w = raw.toLowerCase().replace(/[’']s$/, "").trim();
  const out = [w];
  const add = (x: string) => {
    if (x.length > 2 && !out.includes(x)) out.push(x);
  };
  if (w.endsWith("ies")) add(`${w.slice(0, -3)}y`);
  if (w.endsWith("es")) add(w.slice(0, -2));
  if (w.endsWith("s")) add(w.slice(0, -1));
  if (w.endsWith("ied")) add(`${w.slice(0, -3)}y`);
  if (w.endsWith("ed")) {
    add(w.slice(0, -2));
    add(w.slice(0, -1));
    if (/(.)\1ed$/.test(w)) add(w.slice(0, -3));
  }
  if (w.endsWith("ing")) {
    add(w.slice(0, -3));
    add(`${w.slice(0, -3)}e`);
    if (/(.)\1ing$/.test(w)) add(w.slice(0, -4));
  }
  if (w.endsWith("ly")) add(w.slice(0, -2));
  if (w.endsWith("er") || w.endsWith("est")) add(w.replace(/(er|est)$/, ""));
  return out;
}

export interface Entry {
  word: string;
  text: string;
}

/** Entries by lower-case headword. */
export class EnglishIndex {
  private map = new Map<string, string>();
  private thes = new Map<string, string[]>();

  constructor(entries: Entry[]) {
    for (const e of entries) {
      const k = e.word.toLowerCase();
      if (!this.map.has(k)) this.map.set(k, e.text);
    }
  }

  get size() {
    return this.map.size;
  }

  /** Add a thesaurus (headword to its synonyms) whose words come after the dictionary's own synonyms. */
  setThesaurus(entries: Entry[]) {
    this.thes = new Map();
    this.rankCache.clear();
    for (const e of entries) {
      const k = e.word.toLowerCase();
      if (!this.thes.has(k)) this.thes.set(k, e.text.split(",").map((s) => s.trim()).filter(Boolean));
    }
  }

  get hasThesaurus() {
    return this.thes.size > 0;
  }

  find(typed: string): Found | null {
    for (const c of candidates(typed)) {
      const text = this.map.get(c);
      if (text) return { word: c, senses: parseSenses(text) };
    }
    return null;
  }

  /** Words that start with the typed text, for a quick pick list. */
  startingWith(prefix: string, limit = 8): string[] {
    const p = fold(prefix.toLowerCase());
    if (p.length < 2) return [];
    const out: string[] = [];
    for (const k of this.map.keys()) {
      if (k.startsWith(p)) out.push(k);
      if (out.length >= limit) break;
    }
    return out;
  }

  /** Every synonym of every sense, once each, in order; then the thesaurus's, when one is loaded. */
  synonyms(typed: string, limit = 24): string[] {
    const f = this.find(typed);
    const base = f?.word ?? candidates(typed).find((c) => this.thes.has(c));
    if (!base) return [];
    const seen = new Set<string>();
    for (const s of f?.senses ?? []) for (const x of s.synonyms) seen.add(x);
    for (const x of this.ranked(base)) seen.add(x);
    seen.delete(base);
    return [...seen].slice(0, limit);
  }

  private rankCache = new Map<string, string[]>();

  /**
   * The thesaurus's synonyms for a word, best first. The thesaurus has no order of its own (it is alphabetical and loose, and
   * almost every word lists the others back), so each synonym is scored by how much its own list overlaps the word's:
   * words that share many neighbours are close in meaning. Ties keep the thesaurus's order.
   */
  private ranked(base: string): string[] {
    const hit = this.rankCache.get(base);
    if (hit) return hit;
    const list = this.thes.get(base) ?? [];
    const mine = new Set(list);
    mine.add(base);
    const scored = list.map((s, i) => {
      const theirs = this.thes.get(s.toLowerCase());
      let shared = 0;
      if (theirs) for (const x of theirs) if (mine.has(x)) shared++;
      return { s, i, score: theirs ? shared / (mine.size + theirs.length - shared) : 0 };
    });
    const out = scored.sort((a, b) => b.score - a.score || a.i - b.i).map((x) => x.s);
    this.rankCache.set(base, out);
    if (this.rankCache.size > 300) this.rankCache.delete(this.rankCache.keys().next().value!);
    return out;
  }

  /** More synonyms from the thesaurus, best first, leaving out words already given. */
  more(typed: string, skip: string[] = [], limit = 30): string[] {
    const base = candidates(typed).find((c) => this.thes.has(c));
    if (!base) return [];
    const have = new Set([base, ...skip.map((s) => s.toLowerCase())]);
    return this.ranked(base).filter((x) => !have.has(x.toLowerCase())).slice(0, limit);
  }
}

/** The word under an offset in a line of text (letters, with an inner apostrophe or hyphen), or null. */
export function wordAt(line: string, offset: number): { from: number; to: number; word: string } | null {
  const re = /[A-Za-zÀ-ɏ]+(?:['’-][A-Za-zÀ-ɏ]+)*/g;
  for (const m of line.matchAll(re)) {
    const from = m.index!;
    const to = from + m[0].length;
    if (offset >= from && offset <= to) return { from, to, word: m[0] };
  }
  return null;
}
