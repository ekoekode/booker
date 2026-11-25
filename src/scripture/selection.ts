/** The verse the reader has selected. Chapter-only places have verse 0. */
export interface Selection {
  book: string;
  chapter: number;
  verse: number;
  /** the last verse when several are selected; absent for one verse */
  verseTo?: number;
}

/** The last verse selected: `verse` itself when only one is. */
export const lastVerse = (s: Selection) => (s.verseTo && s.verseTo > s.verse ? s.verseTo : s.verse);

/** "16" or "16-18". */
export const verseSpan = (s: Selection) => (lastVerse(s) > s.verse ? `${s.verse}-${lastVerse(s)}` : `${s.verse}`);

const norm = (s: Selection): Selection => (s.verseTo && s.verseTo > s.verse ? { book: s.book, chapter: s.chapter, verse: s.verse, verseTo: s.verseTo } : { book: s.book, chapter: s.chapter, verse: s.verse });

export const sameSelection = (a: Selection | null, b: Selection | null) =>
  !!a && !!b && a.book === b.book && a.chapter === b.chapter && a.verse === b.verse && lastVerse(a) === lastVerse(b);

/** Where the Bible reader tells other views which verse is selected. Repeating the same place does not notify again. */
export class SelectionStore {
  private cur: Selection | null = null;
  private subs = new Set<(s: Selection) => void>();

  get(): Selection | null {
    return this.cur;
  }

  /** Returns false when the place did not change. */
  set(s: Selection): boolean {
    if (sameSelection(this.cur, s)) return false;
    this.cur = norm(s);
    for (const fn of [...this.subs]) fn(this.cur);
    return true;
  }

  /** Returns a function that stops the listening. */
  subscribe(fn: (s: Selection) => void): () => void {
    this.subs.add(fn);
    return () => void this.subs.delete(fn);
  }
}
