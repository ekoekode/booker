/** What a Bible module is, whatever file it came from, and how raw verse markup becomes text. Pure. */
import { BOOKS, BOOK_BY_OSIS } from "./books";
import { fold, tokens } from "../sources/index";
import { matchWord, type SearchMode } from "../sources/fuzzy";

type Row = { hit: Hit; text: string; toks?: string[] };

/** Does the verse have a form of every word typed? */
function fuzzyHas(r: Row, words: string[]): boolean {
  const toks = (r.toks ??= tokens(r.text));
  return words.every((w) => toks.some((t) => matchWord(t, w)));
}

/** A stretch of verse text. `i` is italic (words added by the translators), `jesus` is words of Jesus. */
export interface Seg {
  t: string;
  i?: boolean;
  jesus?: boolean;
}

export interface Hit {
  book: string;
  c: number;
  v: number;
}

export interface BibleModule {
  /** the file it came from, used as its id */
  id: string;
  name: string;
  abbr: string;
  rtl: boolean;
  /** books present, as osis ids in canon order */
  books(): string[];
  chapterCount(book: string): number;
  verseCount(book: string, c: number): number;
  verse(book: string, c: number, v: number): Seg[] | null;
  /** the verse as the file wrote it, with its own markup (Strong's numbers among it), when the module keeps it */
  rawVerse?(book: string, c: number, v: number): string | null;
  /** whether the file tags its words with Strong's numbers */
  hasStrongs?(): boolean;
  /** verses that contain every word, in canon order; "fuzzy" also takes other forms of a word, the start of a word and a one-letter slip */
  search(words: string[], limit: number, mode?: SearchMode): Hit[];
}

export const verseKey = (book: string, c: number, v: number) => `${book}.${c}.${v}`;

export interface RawBible {
  name: string;
  abbr: string;
  rtl?: boolean;
  /** key -> raw text with the file's own markup, or ready segments */
  verses: Map<string, string | Seg[]>;
  /** how to read string entries */
  markup: "esword" | "plain";
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
export const decodeEntities = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });

const RED = /(?:color\s*=\s*["']?\s*(?:#?f{2}0{4}|#?c00|red|#?d{2}0{4})|color\s*:\s*(?:#?f{2}0{4}|red))/i;

/**
 * e-Sword and MySword verse text: <FI>italic<Fi>, <FR>words of Jesus<Fr>, <RF>footnote<Rf>, Strong's <WG123>,
 * <CM> paragraph marks, plus the plain <i> and <font color=red> some MySword modules use.
 */
export function parseMarkup(raw: string): Seg[] {
  const s = raw.replace(/<RF[^>]*>[\s\S]*?<Rf>/g, "").replace(/<TS\d?[^>]*>[\s\S]*?<Ts>/g, "").replace(/<(?:note|sup)\b[^>]*>[\s\S]*?<\/(?:note|sup)>/gi, "");
  const out: Seg[] = [];
  let italic = 0;
  let jesus = 0;
  const fonts: boolean[] = [];
  const push = (t: string) => {
    if (!t) return;
    const last = out[out.length - 1];
    const i = italic > 0;
    const j = jesus > 0;
    if (last && !!last.i === i && !!last.jesus === j) last.t += t;
    else out.push({ t, ...(i && { i }), ...(j && { jesus: j }) });
  };
  let at = 0;
  for (const m of s.matchAll(/<(\/?)([A-Za-z][A-Za-z0-9]*)([^>]*)>/g)) {
    push(decodeEntities(s.slice(at, m.index)));
    at = m.index! + m[0].length;
    const close = m[1] === "/";
    const name = m[2];
    switch (name) {
      case "FI":
        italic++;
        break;
      case "Fi":
        italic = Math.max(0, italic - 1);
        break;
      case "FR":
        jesus++;
        break;
      case "Fr":
        jesus = Math.max(0, jesus - 1);
        break;
      case "i":
      case "I":
      case "em":
        italic = close ? Math.max(0, italic - 1) : italic + 1;
        break;
      case "font":
        if (close) {
          if (fonts.pop()) jesus = Math.max(0, jesus - 1);
        } else {
          const red = RED.test(m[3]);
          fonts.push(red);
          if (red) jesus++;
        }
        break;
      case "br":
      case "CL":
      case "CM":
      case "CI":
        push(" ");
        break;
      default:
        break; // Strong's numbers, morphology and every other tag carry no text
    }
  }
  push(decodeEntities(s.slice(at)));
  // tidy whitespace without touching the edges between segments
  const res = out.map((g) => ({ ...g, t: g.t.replace(/\s+/g, " ") })).filter((g) => g.t);
  if (res.length) {
    res[0].t = res[0].t.replace(/^\s+/, "");
    res[res.length - 1].t = res[res.length - 1].t.replace(/\s+$/, "");
  }
  return res.filter((g) => g.t);
}

/** The words of a verse as one plain string. */
export const plain = (segs: Seg[]) => segs.map((g) => g.t).join("");

const BOOK_ORDER = new Map(BOOKS.map((b, i) => [b.osis, i]));

export class MemoryBible implements BibleModule {
  readonly id: string;
  readonly name: string;
  readonly abbr: string;
  readonly rtl: boolean;
  private raw: RawBible;
  private counts = new Map<string, number[]>();
  private cache = new Map<string, Seg[]>();
  private plainIndex: Row[] | null = null;

  constructor(id: string, raw: RawBible) {
    this.id = id;
    this.raw = raw;
    this.name = raw.name || id;
    this.abbr = raw.abbr || this.name.split(/\s+/).map((w) => w[0]).join("").toUpperCase().slice(0, 6);
    this.rtl = !!raw.rtl;
    for (const key of raw.verses.keys()) {
      const [book, c, v] = key.split(".");
      const arr = this.counts.get(book) ?? [];
      const ch = +c;
      arr[ch] = Math.max(arr[ch] ?? 0, +v);
      this.counts.set(book, arr);
    }
  }

  books() {
    return [...this.counts.keys()].sort((a, b) => (BOOK_ORDER.get(a) ?? 999) - (BOOK_ORDER.get(b) ?? 999));
  }
  chapterCount(book: string) {
    const a = this.counts.get(book);
    return a ? a.length - 1 : 0;
  }
  verseCount(book: string, c: number) {
    return this.counts.get(book)?.[c] ?? 0;
  }
  verse(book: string, c: number, v: number): Seg[] | null {
    const key = verseKey(book, c, v);
    const hit = this.cache.get(key);
    if (hit) return hit;
    const raw = this.raw.verses.get(key);
    if (raw === undefined) return null;
    const segs = typeof raw === "string" ? (this.raw.markup === "esword" ? parseMarkup(raw) : [{ t: raw.trim() }]) : raw;
    if (this.cache.size > 5000) this.cache.clear();
    this.cache.set(key, segs);
    return segs;
  }
  rawVerse(book: string, c: number, v: number): string | null {
    const raw = this.raw.verses.get(verseKey(book, c, v));
    return typeof raw === "string" && this.raw.markup === "esword" ? raw : null;
  }
  private tagged: boolean | null = null;
  hasStrongs(): boolean {
    if (this.tagged === null) {
      this.tagged = false;
      if (this.raw.markup === "esword") for (const r of this.raw.verses.values()) if (typeof r === "string" && /<W[HG]\d/.test(r)) { this.tagged = true; break; }
    }
    return this.tagged;
  }
  search(words: string[], limit: number, mode: SearchMode = "exact"): Hit[] {
    const ws = words.map((w) => w.toLowerCase()).filter(Boolean);
    if (!ws.length) return [];
    if (!this.plainIndex) {
      const rows: Row[] = [];
      for (const book of this.books())
        for (let c = 1; c <= this.chapterCount(book); c++)
          for (let v = 1; v <= this.verseCount(book, c); v++) {
            const raw = this.raw.verses.get(verseKey(book, c, v));
            if (raw === undefined) continue;
            const text = typeof raw === "string" ? (this.raw.markup === "esword" ? plain(parseMarkup(raw)) : raw) : plain(raw);
            rows.push({ hit: { book, c, v }, text: text.toLowerCase() });
          }
      this.plainIndex = rows;
    }
    const out: Hit[] = [];
    const fuzzy = mode === "fuzzy" ? ws.map((w) => fold(w)) : [];
    for (const r of this.plainIndex) {
      if (mode === "fuzzy" ? fuzzyHas(r, fuzzy) : ws.every((w) => r.text.includes(w))) {
        out.push(r.hit);
        if (out.length >= limit) break;
      }
    }
    return out;
  }
}

export const isKnownBook = (osis: string) => BOOK_BY_OSIS.has(osis);
