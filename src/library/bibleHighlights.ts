/** Highlights on Bible text: a stretch of one verse in one module, with a colour. Pure. */
import { asNum, asStr, newId } from "./jsonStore";

export interface BibleHighlight {
  id: string;
  module: string;
  book: string;
  chapter: number;
  verse: number;
  /** character offsets inside the verse's plain text */
  start: number;
  end: number;
  text: string;
  color: string;
  created: number;
}

export interface BibleHighlights {
  items: BibleHighlight[];
}

export const emptyHighlights = (): BibleHighlights => ({ items: [] });

export function parseBibleHighlights(raw: unknown): BibleHighlights {
  const list = (raw && typeof raw === "object" ? (raw as any).items : null) as unknown;
  if (!Array.isArray(list)) return emptyHighlights();
  const items: BibleHighlight[] = [];
  for (const r of list) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const start = asNum(o.start, -1);
    const end = asNum(o.end, -1);
    if (!asStr(o.book) || start < 0 || end <= start) continue;
    items.push({ id: asStr(o.id) || newId(), module: asStr(o.module), book: asStr(o.book), chapter: asNum(o.chapter), verse: asNum(o.verse), start, end, text: asStr(o.text), color: asStr(o.color, "yellow"), created: asNum(o.created) });
  }
  return { items };
}

export type NewHighlight = Omit<BibleHighlight, "id" | "created">;

/** Adds a highlight. One that overlaps an older one of the same verse replaces it, so a stretch has one colour. */
export function addBibleHighlight(h: BibleHighlights, n: NewHighlight, now = Date.now()): { highlights: BibleHighlights; item: BibleHighlight } {
  const item: BibleHighlight = { ...n, id: newId(now), created: now };
  const keep = h.items.filter((o) => !(o.module === n.module && o.book === n.book && o.chapter === n.chapter && o.verse === n.verse && o.start < n.end && n.start < o.end));
  return { highlights: { items: [...keep, item] }, item };
}

export const removeBibleHighlight = (h: BibleHighlights, id: string): BibleHighlights => ({ items: h.items.filter((o) => o.id !== id) });

/** The highlights of one chapter of one module, by verse. */
export function forChapter(h: BibleHighlights, module: string, book: string, chapter: number): Map<number, BibleHighlight[]> {
  const out = new Map<number, BibleHighlight[]>();
  for (const o of h.items) {
    if (o.module !== module || o.book !== book || o.chapter !== chapter) continue;
    const list = out.get(o.verse) ?? [];
    list.push(o);
    list.sort((a, b) => a.start - b.start);
    out.set(o.verse, list);
  }
  return out;
}

/** A verse's text cut into plain and highlighted stretches, in order. */
export function splitVerse(text: string, marks: BibleHighlight[]): Array<{ text: string; mark?: BibleHighlight }> {
  const out: Array<{ text: string; mark?: BibleHighlight }> = [];
  let at = 0;
  for (const m of marks) {
    const s = Math.max(m.start, at);
    const e = Math.min(m.end, text.length);
    if (e <= s) continue;
    if (s > at) out.push({ text: text.slice(at, s) });
    out.push({ text: text.slice(s, e), mark: m });
    at = e;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}
