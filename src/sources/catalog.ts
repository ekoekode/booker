/** The Library as a catalogue: which databases there are, and the works in one, filtered, sorted and grouped. Pure. */
import type { Source } from "./types";
import { volumesFor, volumeTags, volumeLabel, type Volume } from "./volumes";

export interface Database {
  id: string;
  label: string;
  count: number;
  /** what the works in it are, for the card's note */
  note: string;
}

const OTHER_DB = "Other libraries";
const DOCS = "Documents and books";

/** The database a source belongs to: the collection it came from, else its kind. */
export function databaseOf(s: Source): string {
  if (s.kind !== "db") return DOCS;
  const c = (s.container ?? "").replace(/\s*\(.*\)\s*$/, "").trim();
  if (c) return c;
  return /\.(dctx|mybible)$/i.test(s.file) ? "Dictionaries and lexicons" : OTHER_DB;
}

/** A shorter name for a database card: "Historical Christian Faith, Writings Database" becomes "Church writings". */
export function databaseLabel(id: string): string {
  const w = /writings database/i.test(id);
  const c = /commentar/i.test(id);
  if (/historical christian faith/i.test(id) && (w || c)) return w ? "Church Fathers: Writings" : "Church Fathers: Commentaries";
  return id;
}

export const categoryOf = (s: Source): string => s.category || (/commentar/i.test(s.container ?? "") ? "commentary" : s.kind === "db" ? "writings" : "document");

export function databases(all: Source[]): Database[] {
  const m = new Map<string, Source[]>();
  for (const s of all) {
    const k = databaseOf(s);
    m.set(k, [...(m.get(k) ?? []), s]);
  }
  return [...m.entries()]
    .map(([id, list]) => {
      const authors = new Set(list.flatMap((s) => s.authors));
      return { id, label: databaseLabel(id), count: list.length, note: `${list.length} work${list.length === 1 ? "" : "s"}${authors.size > 1 ? ` · ${authors.size} authors` : ""}` };
    })
    .sort((a, b) => (a.id === DOCS ? 1 : b.id === DOCS ? -1 : a.label.localeCompare(b.label)));
}

export interface Work {
  source: Source;
  author: string;
  /** the year as a number for sorting and range filters; null when none is known */
  year: number | null;
  volumes: Volume[];
  volumeText: string;
}

export function workOf(s: Source): Work {
  const author = s.authors[0] ?? "Unknown author";
  const y = /-?\d{1,4}/.exec(s.year ?? "");
  const volumes = volumesFor(author);
  return { source: s, author, year: y ? parseInt(y[0], 10) : null, volumes, volumeText: volumeLabel(volumes) };
}

export interface WorkFilter {
  db?: string;
  text?: string;
  author?: string;
  category?: string;
  volume?: string;
  yearFrom?: number | null;
  yearTo?: number | null;
}

export type WorkSort = "author" | "title" | "date";

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function filterWorks(all: Source[], f: WorkFilter): Work[] {
  const words = fold(f.text ?? "").split(/\s+/).filter(Boolean);
  const out: Work[] = [];
  for (const s of all) {
    if (f.db && databaseOf(s) !== f.db) continue;
    if (f.category && categoryOf(s) !== f.category) continue;
    const w = workOf(s);
    if (f.author && w.author !== f.author) continue;
    if (f.volume && !volumeTags(w.volumes).includes(f.volume)) continue;
    if (f.yearFrom != null && (w.year === null || w.year < f.yearFrom)) continue;
    if (f.yearTo != null && (w.year === null || w.year > f.yearTo)) continue;
    if (words.length) {
      const hay = fold(`${s.title} ${s.authors.join(" ")} ${s.year ?? ""} ${w.volumeText} ${s.container ?? ""}`);
      if (!words.every((x) => hay.includes(x))) continue;
    }
    out.push(w);
  }
  return out;
}

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base" });

export function sortWorks(list: Work[], by: WorkSort): Work[] {
  const cmp: Record<WorkSort, (a: Work, b: Work) => number> = {
    author: (a, b) => byName(a.author, b.author) || byName(a.source.title, b.source.title),
    title: (a, b) => byName(a.source.title, b.source.title),
    date: (a, b) => (a.year ?? Infinity) - (b.year ?? Infinity) || byName(a.author, b.author),
  };
  return [...list].sort(cmp[by]);
}

export interface Group {
  heading: string;
  works: Work[];
}

/** Works under an author's grey heading, authors in the sort's order. Other sorts give one unheaded group. */
export function groupWorks(list: Work[], by: WorkSort): Group[] {
  if (by !== "author") return [{ heading: "", works: list }];
  const out: Group[] = [];
  for (const w of list) {
    const last = out[out.length - 1];
    if (last && last.heading === w.author) last.works.push(w);
    else out.push({ heading: w.author, works: [w] });
  }
  return out;
}

/** Choices a filter control offers for a set of works. */
export function facets(list: Work[]) {
  const authors = [...new Set(list.map((w) => w.author))].sort(byName);
  const categories = [...new Set(list.map((w) => categoryOf(w.source)))].sort(byName);
  const years = list.map((w) => w.year).filter((y): y is number => y !== null);
  const vols = new Set(list.flatMap((w) => volumeTags(w.volumes)));
  return { authors, categories, minYear: years.length ? Math.min(...years) : null, maxYear: years.length ? Math.max(...years) : null, volumes: vols };
}

/** "804", "1737", "c. 150": years before 1000 read better with AD. */
export const yearText = (y: number | null): string => (y === null ? "undated" : y < 0 ? `${-y} BC` : y < 1000 ? `${y} AD` : String(y));
