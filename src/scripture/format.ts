/**
 * Turning passages into the Markdown a writer inserts: a block quote or inline quote, verse numbers, a reference in
 * the chosen form, partial verses (a, b, c). Pure: it works on a module and passages, nothing else.
 */
import { BOOK_BY_OSIS, type BookNaming } from "./books";
import { plain, type BibleModule, type Seg } from "./module";
import { formatPassage, type Passage } from "./ref";

export type Layout = "block" | "inline" | "plain";
export type NumberStyle = "none" | "super" | "bracket" | "plain";
export type RefPlace = "none" | "after" | "before" | "paren";
export type TranslationTag = "off" | "plain" | "paren";

export interface VerseStyle {
  layout: Layout;
  /** how verse numbers look inside the text */
  numbers: NumberStyle;
  /** a lone verse needs no number; turn this off to number it anyway */
  skipSingleNumber: boolean;
  /** each verse starts a new line (poetry, lists) instead of running on */
  lines: boolean;
  reference: RefPlace;
  naming: BookNaming;
  translation: TranslationTag;
  /** show a verse's words of Jesus in italics */
  jesus: "plain" | "italic";
  /** words the translators added (italic in the module) stay italic */
  addedWords: "italic" | "plain";
  /** a quotation that starts or stops mid-verse is marked with an ellipsis */
  ellipsis: boolean;
  dash: string;
}

export const DEFAULT_STYLE: VerseStyle = {
  layout: "block",
  numbers: "super",
  skipSingleNumber: true,
  lines: false,
  reference: "after",
  naming: "full",
  translation: "plain",
  jesus: "plain",
  addedWords: "italic",
  ellipsis: true,
  dash: "–",
};

export interface ResolvedVerse {
  c: number;
  v: number;
  segs: Seg[];
}

/** The verses a passage covers in this module, with partial verses cut to the pieces asked for. */
export function resolvePassage(mod: BibleModule, p: Passage): ResolvedVerse[] {
  const out: ResolvedVerse[] = [];
  const lastCh = Math.min(p.to.c, mod.chapterCount(p.book));
  for (let c = p.from.c; c <= lastCh; c++) {
    const first = c === p.from.c && p.from.v !== null ? p.from.v : 1;
    const last = c === p.to.c && p.to.v !== null ? p.to.v : mod.verseCount(p.book, c);
    for (let v = first; v <= Math.min(last, mod.verseCount(p.book, c)); v++) {
      let segs = mod.verse(p.book, c, v);
      if (!segs) continue;
      const startPart = c === p.from.c && v === first && p.from.v !== null ? p.from.part : undefined;
      const endPart = c === p.to.c && v === last && p.to.v !== null ? p.to.part : undefined;
      if (startPart || endPart) segs = cutParts(segs, startPart, endPart);
      if (segs.length) out.push({ c, v, segs });
    }
  }
  return out;
}

// ------------------------------------------------------------ partial verses

const MAJOR = /[;:.?!—]/;

/** Where the clauses of a verse start: the text offsets after punctuation that ends a clause. */
function clauseStarts(text: string): Array<{ at: number; major: boolean }> {
  const out: Array<{ at: number; major: boolean }> = [];
  const re = /([,;:.?!—])(?=\s|["”’'])/g;
  for (const m of text.matchAll(re)) {
    let at = m.index! + 1;
    while (/["”’')]/.test(text[at] ?? "")) at++;
    while (/\s/.test(text[at] ?? "")) at++;
    if (at > 0 && at < text.length - 2) out.push({ at, major: MAJOR.test(m[1]) });
  }
  return out;
}

/**
 * Split a verse into at most three parts, a, b and c, at clause breaks. Modules store whole verses, so this is a
 * guess at where a writer would cut; the insert window shows the parts so the guess can be checked.
 */
export function partOffsets(text: string): number[] {
  const cands = clauseStarts(text);
  if (cands.length <= 2) return cands.map((c) => c.at);
  const pick = (target: number, taken: number) => {
    let best = cands[0];
    let score = Infinity;
    for (const c of cands) {
      if (c.at === taken) continue;
      const s = Math.abs(c.at - target) - (c.major ? text.length * 0.08 : 0);
      if (s < score) {
        score = s;
        best = c;
      }
    }
    return best.at;
  };
  const a = pick(text.length / 3, -1);
  const b = pick((text.length * 2) / 3, a);
  return [a, b].sort((x, y) => x - y);
}

export function verseParts(segs: Seg[]): Seg[][] {
  const text = plain(segs);
  const cuts = [0, ...partOffsets(text), text.length];
  return cuts.slice(0, -1).map((from, i) => sliceSegs(segs, from, cuts[i + 1]));
}

function sliceSegs(segs: Seg[], from: number, to: number): Seg[] {
  const out: Seg[] = [];
  let at = 0;
  for (const g of segs) {
    const a = Math.max(from, at);
    const b = Math.min(to, at + g.t.length);
    if (b > a) out.push({ ...g, t: g.t.slice(a - at, b - at) });
    at += g.t.length;
  }
  if (out.length) {
    out[0].t = out[0].t.replace(/^\s+/, "");
    out[out.length - 1].t = out[out.length - 1].t.replace(/\s+$/, "");
  }
  return out.filter((g) => g.t);
}

const PART_INDEX: Record<string, number> = { a: 0, b: 1, c: 2, d: 3, e: 4 };

/** Keep the parts from `from` to `to` (a to c); a missing end means the start or the end of the verse. */
export function cutParts(segs: Seg[], from?: string, to?: string): Seg[] {
  const parts = verseParts(segs);
  const a = from ? Math.min(PART_INDEX[from] ?? 0, parts.length - 1) : 0;
  const b = to ? Math.min(PART_INDEX[to] ?? parts.length - 1, parts.length - 1) : parts.length - 1;
  if (b < a) return [];
  const keep = parts.slice(a, b + 1);
  const merged: Seg[] = [];
  keep.forEach((p, i) => {
    if (i > 0) merged.push({ t: " " });
    merged.push(...p);
  });
  return merged;
}

// ------------------------------------------------------------------ output

const num = (n: string, s: NumberStyle) => (s === "super" ? `<sup>${n}</sup>` : s === "bracket" ? `[${n}]` : `${n} `);

function segsMarkdown(segs: Seg[], style: VerseStyle): string {
  return segs
    .map((g) => {
      const italic = (g.i && style.addedWords === "italic") || (g.jesus && style.jesus === "italic");
      const t = g.t;
      if (!italic) return t;
      const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(t)!;
      return m[2] ? `${m[1]}*${m[2]}*${m[3]}` : t;
    })
    .join("")
    .replace(/\*\s*\*/g, " ")
    .replace(/\*\*/g, "* *");
}

/** One passage as text (no quote marks or reference), with verse numbers as the style asks. */
export function passageText(verses: ResolvedVerse[], p: Passage, style: VerseStyle): string {
  const showNumbers = style.numbers !== "none" && !(style.skipSingleNumber && verses.length === 1);
  const parts: string[] = [];
  let prevC = -1;
  verses.forEach((v, i) => {
    let label = "";
    if (showNumbers) label = num(i > 0 && v.c !== prevC && prevC !== -1 ? `${v.c}:${v.v}` : String(v.v), style.numbers);
    prevC = v.c;
    parts.push(label + segsMarkdown(v.segs, style));
  });
  let text = style.lines ? parts.join("\n") : parts.join(" ");
  const first = verses[0];
  if (style.ellipsis && first) {
    const cutStart = p.from.part && p.from.part !== "a";
    const last = verses[verses.length - 1];
    const cutEnd = p.to.part && !/[.?!;:]["”’')]*$/.test(plain(last.segs));
    if (cutStart) text = text.replace(/^((?:<sup>[^<]*<\/sup>|\[[^\]]*\]|\d+(?::\d+)?\s)?)/, "$1…");
    if (cutEnd) text = text.replace(/[,;:\s]*$/, "") + "…";
  }
  return text;
}

export function referenceText(p: Passage, style: VerseStyle, mod: Pick<BibleModule, "abbr">): string {
  const b = BOOK_BY_OSIS.get(p.book);
  if (!b) return p.book;
  const ref = formatPassage(p, b, { naming: style.naming, dash: style.dash, sep: ":" });
  const tag = style.translation === "off" || !mod.abbr ? "" : style.translation === "paren" ? ` (${mod.abbr})` : ` ${mod.abbr}`;
  return ref + tag;
}

/** Several passages joined the way they are cited: "John 3:16; Romans 8:28". The tag follows the last. */
export function referenceList(ps: Passage[], style: VerseStyle, mod: Pick<BibleModule, "abbr">): string {
  const noTag: VerseStyle = { ...style, translation: "off" };
  const list = ps.map((p) => referenceText(p, noTag, mod)).join("; ");
  if (style.translation === "off" || !mod.abbr) return list;
  return style.translation === "paren" ? `${list} (${mod.abbr})` : `${list} ${mod.abbr}`;
}

/**
 * The Markdown to insert for these passages. Block quotes put each passage in its own quote; inline layout runs
 * everything together in quotation marks.
 */
export function formatInsert(mod: BibleModule, passages: Passage[], style: VerseStyle): string {
  const bodies = passages.map((p) => ({ p, text: passageText(resolvePassage(mod, p), p, style) })).filter((x) => x.text);
  if (!bodies.length) return "";
  const refAll = referenceList(passages, style, mod);
  const q = (s: string) => `“${s}”`;
  switch (style.layout) {
    case "block": {
      const blocks = bodies.map((b, i) => {
        const lines = b.text.split("\n").map((l) => `> ${l}`);
        const ref = style.reference === "none" ? "" : referenceList([b.p], style, mod);
        if (style.reference === "after") lines.push(`> — ${ref}`);
        else if (style.reference === "before") lines.unshift(`> ${ref}`);
        else if (style.reference === "paren") lines[lines.length - 1] += ` (${ref})`;
        void i;
        return lines.join("\n");
      });
      return blocks.join("\n>\n");
    }
    case "inline": {
      const body = bodies.map((b) => b.text.replace(/\n/g, " ")).join(" … ");
      if (style.reference === "before") return `${refAll}: ${q(body)}`;
      if (style.reference === "after") return `${q(body)} — ${refAll}`;
      if (style.reference === "paren") return `${q(body)} (${refAll})`;
      return q(body);
    }
    default: {
      const body = bodies.map((b) => b.text).join("\n\n");
      if (style.reference === "before") return `${refAll}\n${body}`;
      if (style.reference === "after") return `${body}\n— ${refAll}`;
      if (style.reference === "paren") return `${body} (${refAll})`;
      return body;
    }
  }
}

