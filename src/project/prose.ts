/**
 * Prose measurements for the Stats page: how much of a text is dialogue, how easy it is to read, which words it leans on,
 * and which words come back too soon. Pure code, no Obsidian imports.
 */
import { splitFrontmatter, stripComments, stripLinks } from "../text";

/** The prose of a note: no properties, comments, links or Markdown marks. */
export function proseOf(note: string): string {
  const body = stripLinks(stripComments(splitFrontmatter(note).body));
  return body
    .replace(/^#{1,6}\s.*$/gm, "")
    .replace(/^\s*(?:[-*_]\s*){3,}$/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/[*_~`]+/g, "")
    .trim();
}

const WORD = /[\p{L}\p{N}]+(?:['’][\p{L}]+)*/gu;

export function wordsOf(text: string): string[] {
  return text.match(WORD) ?? [];
}

export function sentencesOf(text: string): string[] {
  return text
    .split(/(?<=[.!?…]["”’')\]]*)\s+(?=["“‘'(\[]?[\p{Lu}\p{N}])/u)
    .map((s) => s.trim())
    .filter((s) => /[\p{L}\p{N}]/u.test(s));
}

/** A rough syllable count for English words. */
export function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 1;
  if (w.length <= 3) return 1;
  const stripped = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "");
  const groups = stripped.match(/[aeiouy]{1,3}/g);
  return Math.max(1, groups ? groups.length : 1);
}

export interface Readability {
  words: number;
  sentences: number;
  avgSentence: number;
  avgWord: number;
  /** Flesch reading ease: higher is easier */
  ease: number;
  /** Flesch-Kincaid US school grade */
  grade: number;
}

export function readability(text: string): Readability {
  const words = wordsOf(text);
  const sentences = Math.max(1, sentencesOf(text).length);
  const n = words.length;
  if (!n) return { words: 0, sentences: 0, avgSentence: 0, avgWord: 0, ease: 0, grade: 0 };
  const syl = words.reduce((a, w) => a + syllables(w), 0);
  const chars = words.reduce((a, w) => a + w.length, 0);
  const wps = n / sentences;
  const spw = syl / n;
  return {
    words: n,
    sentences,
    avgSentence: round1(wps),
    avgWord: round1(chars / n),
    ease: round1(206.835 - 1.015 * wps - 84.6 * spw),
    grade: round1(0.39 * wps + 11.8 * spw - 15.59),
  };
}

const round1 = (x: number) => Math.round(x * 10) / 10;

/** Words inside quotation marks and all other words. Straight and curly double quotes count; so do « ». */
export function dialogueSplit(text: string): { dialogue: number; narrative: number } {
  let dialogue = 0;
  let narrative = 0;
  const re = /“[^”]*”|"[^"\n]*"|«[^»]*»/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    narrative += wordsOf(text.slice(last, m.index)).length;
    dialogue += wordsOf(m[0]).length;
    last = (m.index ?? 0) + m[0].length;
  }
  narrative += wordsOf(text.slice(last)).length;
  return { dialogue, narrative };
}

export const COMMON = new Set(
  "a about above after again all also am an and any are as at be because been before being below between both but by can could did do does doing down during each few for from further had has have having he her here hers herself him himself his how i if in into is it its itself just me more most my myself no nor not now of off on once only or other our ours ourselves out over own same she should so some such than that the their theirs them themselves then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours yourself yourselves said say says one two like back then than get got went come came know knew".split(" ")
);

/** The most used words that are not everyday words, most used first. */
export function topWords(texts: string[], n = 20, exclude: Set<string> = COMMON): Array<{ word: string; count: number }> {
  const counts = new Map<string, number>();
  for (const t of texts)
    for (const w of wordsOf(t)) {
      const k = w.toLowerCase();
      if (k.length < 3 || exclude.has(k) || /^\d+$/.test(k)) continue;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  return [...counts].map(([word, count]) => ({ word, count })).sort((a, b) => b.count - a.count || a.word.localeCompare(b.word)).slice(0, n);
}

export interface Echo {
  phrase: string;
  /** how many times it came back within the window */
  count: number;
  /** word positions of the repeats */
  at: number[];
}

/**
 * Words (and two-word phrases) that come back within `window` words of themselves. Everyday words and short words are
 * ignored. Most repeated first.
 */
export function findEchoes(text: string, window = 40, limit = 20): Echo[] {
  const ws = wordsOf(text).map((w) => w.toLowerCase());
  const out = new Map<string, number[]>();
  const lastAt = new Map<string, number>();
  const note = (key: string, i: number) => {
    const prev = lastAt.get(key);
    if (prev !== undefined && i - prev <= window) out.set(key, [...(out.get(key) ?? []), i]);
    lastAt.set(key, i);
  };
  ws.forEach((w, i) => {
    if (w.length >= 4 && !COMMON.has(w)) note(w, i);
    if (i > 0) {
      const a = ws[i - 1];
      if (!(COMMON.has(a) && COMMON.has(w)) && a.length + w.length >= 8) note(`${a} ${w}`, i);
    }
  });
  const res: Echo[] = [...out].map(([phrase, at]) => ({ phrase, count: at.length, at }));
  // a phrase that only repeats because its words do is noise: drop phrases whose every word is already listed with a count at least as high
  const single = new Map(res.filter((e) => !e.phrase.includes(" ")).map((e) => [e.phrase, e.count]));
  return res
    .filter((e) => !e.phrase.includes(" ") || !e.phrase.split(" ").every((w) => (single.get(w) ?? 0) >= e.count))
    .sort((a, b) => b.count - a.count || a.phrase.localeCompare(b.phrase))
    .slice(0, limit);
}

/** Everything the Stats page needs from one scene, so it can be added up across the book and kept until the scene changes. */
export interface SceneProse {
  words: number;
  sentences: number;
  syllables: number;
  chars: number;
  dialogue: number;
  narrative: number;
  freq: Record<string, number>;
  echoes: Echo[];
}

export function analyse(note: string, window = 40): SceneProse {
  const text = proseOf(note);
  const ws = wordsOf(text);
  const d = dialogueSplit(text);
  const freq: Record<string, number> = {};
  for (const w of ws) {
    const k = w.toLowerCase();
    if (k.length >= 3 && !COMMON.has(k) && !/^\d+$/.test(k)) freq[k] = (freq[k] ?? 0) + 1;
  }
  return {
    words: ws.length,
    sentences: ws.length ? sentencesOf(text).length : 0,
    syllables: ws.reduce((a, w) => a + syllables(w), 0),
    chars: ws.reduce((a, w) => a + w.length, 0),
    dialogue: d.dialogue,
    narrative: d.narrative,
    freq,
    echoes: findEchoes(text, window, 10),
  };
}

/** Readability and the dialogue share for a set of scenes, from their sums. */
export function combine(list: SceneProse[]): Readability & { dialogue: number; narrative: number; dialoguePct: number } {
  const t = list.reduce(
    (a, s) => ({ words: a.words + s.words, sentences: a.sentences + s.sentences, syllables: a.syllables + s.syllables, chars: a.chars + s.chars, dialogue: a.dialogue + s.dialogue, narrative: a.narrative + s.narrative }),
    { words: 0, sentences: 0, syllables: 0, chars: 0, dialogue: 0, narrative: 0 }
  );
  const sentences = Math.max(1, t.sentences);
  const wps = t.words ? t.words / sentences : 0;
  const spw = t.words ? t.syllables / t.words : 0;
  const talk = t.dialogue + t.narrative;
  return {
    words: t.words,
    sentences: t.sentences,
    avgSentence: round1(wps),
    avgWord: t.words ? round1(t.chars / t.words) : 0,
    ease: t.words ? round1(206.835 - 1.015 * wps - 84.6 * spw) : 0,
    grade: t.words ? round1(0.39 * wps + 11.8 * spw - 15.59) : 0,
    dialogue: t.dialogue,
    narrative: t.narrative,
    dialoguePct: talk ? Math.round((t.dialogue / talk) * 100) : 0,
  };
}

/** Most used words across scenes. */
export function topFromFreq(list: SceneProse[], n = 20): Array<{ word: string; count: number }> {
  const all = new Map<string, number>();
  for (const s of list) for (const [w, c] of Object.entries(s.freq)) all.set(w, (all.get(w) ?? 0) + c);
  return [...all].map(([word, count]) => ({ word, count })).sort((a, b) => b.count - a.count || a.word.localeCompare(b.word)).slice(0, n);
}
