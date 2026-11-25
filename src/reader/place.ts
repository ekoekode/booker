/** Where the Reader is, how that is saved, and the way back through the places visited. Pure. */

export type Place =
  | { kind: "shelf" }
  | { kind: "works"; db: string }
  | { kind: "bible"; module: string; book: string; chapter: number; verse: number; verseTo?: number }
  | { kind: "work"; uid: string; entry: number }
  | { kind: "word"; strongs: string; text: string; translit: string; gloss: string; parse: string }
  | { kind: "commentary"; path: string; book?: string; chapter?: number; verse?: number; verseTo?: number };

export const samePlace = (a: Place, b: Place): boolean => JSON.stringify(a) === JSON.stringify(b);

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown, fallback = 0): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : fallback);

/** A saved place back from view state: the new `place` field, or the two-tab reader's old fields. Never throws. */
export function placeFromState(state: unknown): Place {
  const s = (state && typeof state === "object" ? state : {}) as Record<string, any>;
  const p = s.place;
  if (p && typeof p === "object") {
    switch (p.kind) {
      case "shelf":
        return { kind: "shelf" };
      case "works":
        return { kind: "works", db: str(p.db) };
      case "bible": {
        const verse = num(p.verse);
        const to = num(p.verseTo);
        return { kind: "bible", module: str(p.module), book: str(p.book) || "John", chapter: Math.max(1, num(p.chapter, 1)), verse, ...(to > verse && verse > 0 && { verseTo: to }) };
      }
      case "word":
        return str(p.text) || str(p.strongs) ? { kind: "word", strongs: str(p.strongs), text: str(p.text), translit: str(p.translit), gloss: str(p.gloss), parse: str(p.parse) } : { kind: "shelf" };
      case "work":
        return str(p.uid) ? { kind: "work", uid: p.uid, entry: num(p.entry) } : { kind: "shelf" };
      case "commentary":
        return str(p.path) ? { kind: "commentary", path: p.path, ...(str(p.book) && { book: p.book }), ...(num(p.chapter) && { chapter: p.chapter }), ...(num(p.verse) && { verse: p.verse }), ...(num(p.verseTo) > num(p.verse) && num(p.verse) > 0 && { verseTo: p.verseTo }) } : { kind: "shelf" };
    }
  }
  // the old reader: a Bible tab and a Library tab with fields side by side
  if (s.mode === "library") {
    const c = s.cmt;
    if (c && typeof c === "object" && str(c.path)) return placeFromState({ place: { kind: "commentary", ...c } });
    if (str(s.uid)) return { kind: "work", uid: s.uid, entry: num(s.entry) };
    if (str(s.db)) return { kind: "works", db: s.db };
    return { kind: "shelf" };
  }
  return { kind: "bible", module: str(s.module), book: str(s.book) || "John", chapter: Math.max(1, num(s.chapter, 1)), verse: num(s.verse) };
}

/** Back and forward through the places visited. */
export class History {
  private items: Place[] = [];
  private at = -1;

  constructor(private cap = 50) {}

  get current(): Place | null {
    return this.items[this.at] ?? null;
  }
  get canBack(): boolean {
    return this.at > 0;
  }
  get canForward(): boolean {
    return this.at >= 0 && this.at < this.items.length - 1;
  }

  /** Go somewhere new: forward places are dropped; the same place again changes nothing. */
  push(p: Place) {
    if (this.current && samePlace(this.current, p)) return;
    this.items = [...this.items.slice(0, this.at + 1), p].slice(-this.cap);
    this.at = this.items.length - 1;
  }

  /** Change the current place without a new step (a verse picked, a section read). */
  replace(p: Place) {
    if (this.at < 0) return this.push(p);
    this.items[this.at] = p;
  }

  back(): Place | null {
    if (!this.canBack) return null;
    return this.items[--this.at];
  }
  forward(): Place | null {
    if (!this.canForward) return null;
    return this.items[++this.at];
  }
}
