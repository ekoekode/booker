/**
 * Matching the words of an English verse to the Hebrew or Greek words behind them, so a Strong's number can be picked out in any
 * Bible. The Berean word-for-word tables give, for each verse, the original words in order with their English; this finds where that
 * English is in another translation. Pure; reading and writing the results is in aligner.ts.
 */
import { normStrongs, type IWord } from "./interlinear";

/** Bumped when the matching changes, so alignments made by an older version are made again. */
export const ALIGN_VERSION = 1;

/** A stretch of a verse's plain text (start, end) and the Strong's number it renders. */
export type Span = [number, number, string];

/** One book of alignments: chapter → verse → spans. */
export type AlignBook = Record<string, Record<string, Span[]>>;

export interface Tok {
  w: string;
  start: number;
  end: number;
  stem: string;
}

const WORD = /[\p{L}\p{N}]+(?:['’][\p{L}]+)*/gu;

/** The root of an English word, rough enough that loved, loves and loving meet. */
export function stem(word: string): string {
  let w = word.toLowerCase().replace(/['’]s$/, "").replace(/['’]/g, "");
  if (w.length > 4 && w.endsWith("ies")) w = `${w.slice(0, -3)}y`;
  else if (w.length > 5 && w.endsWith("ing")) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith("ed")) w = w.slice(0, -2);
  else if (w.length > 4 && /(?:ch|sh|ss|x|z)es$/.test(w)) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1);
  if (w.length > 5 && w.endsWith("ly")) w = w.slice(0, -2);
  if (w.length > 3 && w.endsWith("e")) w = w.slice(0, -1);
  return w;
}

export function tokenize(text: string): Tok[] {
  const out: Tok[] = [];
  for (const m of text.matchAll(WORD)) out.push({ w: m[0], start: m.index!, end: m.index! + m[0].length, stem: stem(m[0]) });
  return out;
}

const FUNCTION = new Set(
  "a an the of and or to in on at by for with from as is are was were be been being am it its that this these those who whom whose which he she they them his her their him you your we our us i my me shall will would should may might can could do does did have has had so but if then than there here upon unto into over out up".split(" ")
);

/** What a Berean gloss says in the words that carry meaning ("of the deep" → deep), or all its words when it has no others ("the", "of"). */
function glossStems(gloss: string): { stems: string[]; weak: boolean } {
  const words = (gloss.toLowerCase().match(WORD) ?? []).filter((w) => !/^v+$/.test(w));
  const content = words.filter((w) => !FUNCTION.has(w));
  if (content.length) return { stems: [...new Set(content.map(stem))], weak: false };
  return { stems: [...new Set(words.filter((w) => w !== "the" && w !== "a" && w !== "an").map(stem))], weak: true };
}

/** What each Strong's number has been rendered as across a whole Bible: number → word stem → how often. */
export class Lexicon {
  private map = new Map<string, Map<string, number>>();
  private total = new Map<string, number>();

  add(strongs: string, stemmed: string) {
    let m = this.map.get(strongs);
    if (!m) this.map.set(strongs, (m = new Map()));
    m.set(stemmed, (m.get(stemmed) ?? 0) + 1);
    this.total.set(strongs, (this.total.get(strongs) ?? 0) + 1);
  }

  /** The renderings of a number worth trying, the most used first. */
  best(strongs: string): string[] {
    const m = this.map.get(strongs);
    const t = this.total.get(strongs) ?? 0;
    if (!m) return [];
    return [...m].filter(([, c]) => c >= 2 && c >= t * 0.06).sort((a, b) => b[1] - a[1]).slice(0, 8).map((x) => x[0]);
  }
}

/** Read what a matched verse says into a lexicon. */
export function learn(lex: Lexicon, text: string, spans: Span[]) {
  for (const [s, e, str] of spans) lex.add(str, stem(text.slice(s, e)));
}

/**
 * Where in `text` each of the original `words` is rendered. Words are matched by the English the Berean tables give them (the order of the
 * original is kept as far as the translation allows); the ones left over are matched by how this Bible renders the same number elsewhere,
 * then by elimination between neighbours that did match.
 */
export function alignVerse(words: IWord[], text: string, lex?: Lexicon): Span[] {
  const toks = tokenize(text);
  const m = toks.length;
  const n = words.length;
  if (!m || !n) return [];
  const where = new Map<string, number[]>();
  toks.forEach((t, j) => where.set(t.stem, [...(where.get(t.stem) ?? []), j]));
  const owner: number[] = new Array(m).fill(-1);
  const info = words.map((w) => ({ s: normStrongs(w.s), gloss: (w.g ?? "").trim(), ...glossStems(w.g ?? "") }));
  const got: number[][] = words.map(() => []);

  /** Positions for the stems of one word, near `near` (and after it rather than before). The longest stem must be among them. */
  const choose = (stems: string[], near: number, reach: number): number[] => {
    const longest = stems.reduce((a, b) => (b.length > a.length ? b : a), "");
    const taken: number[] = [];
    let at = near;
    for (const st of [longest, ...stems.filter((x) => x !== longest)]) {
      let best = -1;
      let cost = Infinity;
      for (const j of where.get(st) ?? []) {
        if (owner[j] >= 0 || taken.includes(j)) continue;
        const c = Math.abs(j - at) + (j < at ? 2 : 0);
        if (c < cost) {
          cost = c;
          best = j;
        }
      }
      if (best < 0 || cost > reach) {
        if (st === longest) return [];
        continue;
      }
      taken.push(best);
      at = best + 1;
    }
    return taken;
  };

  const claim = (i: number, js: number[]) => {
    for (const j of js) owner[j] = i;
    got[i].push(...js);
  };

  // 1. the English the Berean tables give each word, taken in order
  let cursor = -1;
  for (let i = 0; i < n; i++) {
    const w = info[i];
    if (!w.s || !w.stems.length) continue;
    const near = cursor >= 0 ? cursor + 1 : Math.round((i * m) / n);
    const js = choose(w.stems, near, w.weak ? 4 : Math.max(10, m));
    if (!js.length) continue;
    claim(i, js);
    if (!w.weak) cursor = Math.max(...js);
  }

  const anchors = (i: number, dir: -1 | 1): number => {
    for (let k = i + dir; k >= 0 && k < n; k += dir) {
      if (!got[k].length || info[k].weak) continue;
      return dir < 0 ? Math.max(...got[k]) : Math.min(...got[k]);
    }
    return dir < 0 ? -1 : m;
  };

  // 2. the way this Bible renders the same number elsewhere, between the neighbours that matched
  if (lex) {
    for (let i = 0; i < n; i++) {
      const w = info[i];
      if (got[i].length || !w.s || w.weak || !w.stems.length) continue;
      const lo = anchors(i, -1);
      const hi = anchors(i, 1);
      if (lo > hi) continue;
      for (const st of lex.best(w.s)) {
        const j = (where.get(st) ?? []).find((x) => owner[x] < 0 && x > lo - 2 && x < hi + 2);
        if (j !== undefined) {
          claim(i, [j]);
          break;
        }
      }
    }
  }

  // 3. words left between two that matched: as many words as are left in the English, in order
  for (let i = 0; i < n; ) {
    if (got[i].length || !info[i].s || info[i].weak || !info[i].stems.length) {
      i++;
      continue;
    }
    let end = i;
    while (end + 1 < n && !got[end + 1].length && info[end + 1].s && !info[end + 1].weak && info[end + 1].stems.length) end++;
    const lo = anchors(i, -1);
    const hi = anchors(end, 1);
    if (lo <= hi && (lo >= 0 || hi < m)) {
      const free: number[] = [];
      for (let j = lo + 1; j < hi; j++) if (owner[j] < 0 && !FUNCTION.has(toks[j].w.toLowerCase())) free.push(j);
      if (free.length === end - i + 1) for (let k = 0; k <= end - i; k++) claim(i + k, [free[k]]);
    }
    i = end + 1;
  }

  const out: Span[] = [];
  for (let i = 0; i < n; i++) for (const j of got[i]) out.push([toks[j].start, toks[j].end, info[i].s]);
  return out.sort((a, b) => a[0] - b[0]);
}

/** Put the spans of one number into runs, joining words that sit next to each other ("shall not perish"). */
export function runs(text: string, spans: Span[], strongs: string): Array<[number, number]> {
  const key = normStrongs(strongs);
  const out: Array<[number, number]> = [];
  for (const [s, e, str] of spans) {
    if (normStrongs(str) !== key) continue;
    const last = out[out.length - 1];
    if (last && /^[\s]*$/.test(text.slice(last[1], s))) last[1] = e;
    else out.push([s, e]);
  }
  return out;
}
