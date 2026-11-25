/**
 * Word-for-word Hebrew and Greek under each verse, from the Berean Bible's translation tables (public domain): one row per original word
 * with its English, transliteration, parsing and Strong's number. Pure; the reading of the big file is in resources/bereanArchive.ts.
 */
import { findBook } from "./books";

/** One word: the original, its transliteration, the English under it, Strong's number (H430 / G3056) and the parsing. */
export interface IWord {
  t: string;
  tr: string;
  g: string;
  s: string;
  p: string;
  /** the language when it is not the book's own (Aramaic in Daniel and Ezra) */
  l?: string;
}

/** A book: chapter → verse → words in reading order of the original language. */
export type IBook = Record<string, Record<string, IWord[]>>;

export const BEREAN_TABLES_URL = "https://bereanbible.com/bsb_tables.tsv";
export const BEREAN_TABLES_BYTES = 85525369;

const strongsOf = (prefix: "H" | "G", cell: string | undefined): string => {
  const m = /\d+/.exec(cell ?? "");
  return m ? `${prefix}${Number(m[0])}` : "";
};

/** Reads the tables line by line. Books come out whole, in the order of the file, as soon as the next book starts. */
export class BereanParser {
  private col = new Map<string, number>();
  private book: string | null = null;
  private chapter = 0;
  private verse = 0;
  private data: IBook = {};
  private seq = 0;
  private rows: Array<{ ch: number; v: number; sort: number; w: IWord }> = [];

  constructor(private onBook: (osis: string, data: IBook) => void) {}

  /** The column named like `name` (case and surrounding spaces ignored). */
  private at(cells: string[], name: string, from = 0): string {
    const i = this.col.get(name.toLowerCase());
    return i === undefined || i < from ? "" : cells[i] ?? "";
  }

  push(line: string) {
    if (!line) return;
    const cells = line.split("\t");
    if (!this.col.size) {
      if (/^Heb Sort/i.test(line)) cells.forEach((c, i) => !this.col.has(c.trim().toLowerCase()) && this.col.set(c.trim().toLowerCase(), i));
      return;
    }
    const vid = /^(.+?)\s+(\d+):(\d+)$/.exec(this.at(cells, "VerseId").trim());
    if (vid) {
      const b = findBook(vid[1])?.osis ?? null;
      if (b !== this.book) {
        this.flush();
        this.book = b;
      }
      this.chapter = Number(vid[2]);
      this.verse = Number(vid[3]);
    }
    const text = (cells[5] ?? "").trim();
    if (!this.book || !text || !this.chapter || !this.verse) return;
    const lang = this.at(cells, "Language").trim();
    const heb = lang !== "Greek";
    const w: IWord = {
      t: text,
      tr: this.at(cells, "Translit").trim(),
      g: this.at(cells, " BSB version ".trim()).trim().replace(/^[-–]$/, ""),
      s: heb ? strongsOf("H", this.at(cells, "Str Heb")) : strongsOf("G", this.at(cells, "Str Grk")),
      p: this.at(cells, "Parsing").trim(),
    };
    if (lang === "Aramaic") w.l = "Aramaic";
    this.rows.push({ ch: this.chapter, v: this.verse, sort: Number(cells[heb ? 0 : 1]) || this.seq++, w });
  }

  private flush() {
    if (this.book && this.rows.length) {
      this.rows.sort((a, b) => a.ch - b.ch || a.v - b.v || a.sort - b.sort);
      const out: IBook = {};
      for (const r of this.rows) ((out[r.ch] ??= {})[r.v] ??= []).push(r.w);
      this.data = out;
      this.onBook(this.book, this.data);
    }
    this.rows = [];
  }

  /** Call after the last line. */
  end() {
    this.flush();
    this.book = null;
  }
}

/** Strong's number as the dictionaries spell it: "H430", "G3056" (letter and no leading zeros). */
export function normStrongs(s: string): string {
  const m = /^\s*([HGhg])\s*0*(\d{1,5})/.exec(s);
  return m ? `${m[1].toUpperCase()}${m[2]}` : "";
}
