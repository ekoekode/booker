/** The word-for-word data (one JSON file per book), read when a verse's word study is asked for. */
import { normalizePath, type App } from "obsidian";
import { BOOKS } from "./books";
import { normStrongs, type IBook, type IWord } from "./interlinear";

/** How the Berean Bible renders one Strong's number: each English rendering with how often it is used, and in how many words. */
/** One use of a word: the verse and the English the Berean Bible gives it there. */
export interface Occurrence {
  book: string;
  chapter: number;
  verse: number;
  gloss: string;
}

export interface Renderings {
  total: number;
  glosses: Array<{ gloss: string; count: number }>;
}

export class WordData {
  private books = new Map<string, Promise<IBook | null>>();

  constructor(private app: App, private dir: () => string) {}

  private file(osis: string): string {
    return normalizePath(`${this.dir()}/${osis}.json`);
  }

  /** Whether the data has been downloaded (judged by two books from either end of the Bible). */
  async available(): Promise<boolean> {
    const a = this.app.vault.adapter;
    return (await a.exists(this.file("Gen"))) && (await a.exists(this.file("Rev")));
  }

  forget() {
    this.books.clear();
    this.scanned.clear();
  }

  /** A book's words: chapter → verse → the original words with their English. */
  book(osis: string): Promise<IBook | null> {
    let p = this.books.get(osis);
    if (!p) {
      p = (async () => {
        try {
          const f = this.file(osis);
          return (await this.app.vault.adapter.exists(f)) ? (JSON.parse(await this.app.vault.adapter.read(f)) as IBook) : null;
        } catch {
          return null;
        }
      })();
      this.books.set(osis, p);
    }
    return p;
  }

  private scanned = new Map<string, Promise<Occurrence[]>>();

  /** Every place a Strong's number is used in the Berean Bible, in canon order. Hebrew is looked for in the Old Testament, Greek in the New; the books are read one at a time and not kept. */
  occurrences(strongs: string): Promise<Occurrence[]> {
    const key = normStrongs(strongs);
    let p = this.scanned.get(key);
    if (!p) {
      p = (async () => {
        const out: Occurrence[] = [];
        const canon = BOOKS.filter((b) => !b.extra);
        for (const b of key.startsWith("H") ? canon.slice(0, 39) : canon.slice(39)) {
          const f = this.file(b.osis);
          if (!(await this.app.vault.adapter.exists(f))) continue;
          let book: IBook;
          try {
            book = JSON.parse(await this.app.vault.adapter.read(f)) as IBook;
          } catch {
            continue;
          }
          for (const [c, ch] of Object.entries(book))
            for (const [v, words] of Object.entries(ch))
              for (const w of words) if (normStrongs(w.s) === key) out.push({ book: b.osis, chapter: Number(c), verse: Number(v), gloss: w.g.trim() });
        }
        return out;
      })();
      this.scanned.set(key, p);
    }
    return p;
  }

  /** How the Berean Bible renders one Strong's number: each English rendering with how often it is used. */
  async renderings(strongs: string): Promise<Renderings> {
    const all = await this.occurrences(strongs);
    const counts = new Map<string, number>();
    for (const o of all) if (o.gloss) counts.set(o.gloss.toLowerCase(), (counts.get(o.gloss.toLowerCase()) ?? 0) + 1);
    return { total: all.length, glosses: [...counts].map(([gloss, count]) => ({ gloss, count })).sort((a, b) => b.count - a.count || a.gloss.localeCompare(b.gloss)) };
  }

  /** The words of one verse in the order of the original, or null when there are none. */
  async verse(osis: string, chapter: number, verse: number): Promise<IWord[] | null> {
    return (await this.book(osis))?.[String(chapter)]?.[String(verse)] ?? null;
  }
}
