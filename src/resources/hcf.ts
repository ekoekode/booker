/**
 * HistoricalChristianFaith's two repositories as Booker libraries. Writings-Database holds one HTML file per work in a folder per author;
 * Commentaries-Database holds, in a folder per Father, one TOML file per Bible passage. Pure: the archive reading is in hcfArchive.ts.
 */
import { BOOKS, bookKey, findBook } from "../scripture/books";
import { htmlToLibrary } from "./html";
import { LibBuilder, naturalCompare } from "./libBuilder";
import type { LibEntry } from "./thml";
import type { NlibWriteMeta } from "../sources/nlibWrite";

export const HCF_WRITINGS_URL = "https://codeload.github.com/HistoricalChristianFaith/Writings-Database/tar.gz/HEAD";
export const HCF_COMMENTARIES_URL = "https://codeload.github.com/HistoricalChristianFaith/Commentaries-Database/tar.gz/HEAD";

export interface Comment {
  quote: string;
  source?: string;
  /** where in the commenting book it stands, for the folders named after Bible books: "6:15-20" */
  where?: string;
}

/** The `[[commentary]]` blocks of one passage file. Only the plain string forms the repository uses are understood. */
export function parseCommentary(toml: string): Comment[] {
  const out: Comment[] = [];
  for (const block of toml.split(/^\[\[commentary\]\]\s*$/m).slice(1)) {
    const f: Record<string, string> = {};
    const rest = block.replace(/^(\w+)\s*=\s*'''([\s\S]*?)'''/gm, (_, k: string, v: string) => ((f[k] = v.trim()), ""));
    for (const m of rest.matchAll(/^(\w+)\s*=\s*(?:'([^'\n]*)'|"((?:[^"\\\n]|\\.)*)")/gm)) f[m[1]] = (m[2] ?? m[3] ?? "").replace(/\\(["\\])/g, "$1");
    if (f.quote) out.push({ quote: f.quote, source: f.source_title || undefined, where: f.append_to_author_name?.trim() || undefined });
  }
  return out;
}

/** "Genesis 2_24" → book "Genesis", reference "Genesis 2:24", with the numbers to sort by. */
export function passageOf(stem: string): { book: string; ref: string; chapter: number; verse: number } {
  const ref = stem.replace(/_/g, ":");
  const m = /^(.*?)\s+(\d+)(?::(\d+))?/.exec(ref);
  if (!m) return { book: stem, ref, chapter: 0, verse: 0 };
  return { book: m[1], ref, chapter: Number(m[2]), verse: Number(m[3] ?? 0) };
}

const bookRank = (name: string) => findBook(name)?.num ?? 1000;

/** The folders of the Commentaries database named after a Bible book hold that book's own use of the Old Testament, not a Father's comments. */
const isBibleBook = (name: string) => BOOKS.some((b) => !b.extra && [b.name, b.sbl, b.short, b.osis].some((n) => bookKey(n) === bookKey(name)));

/** One comment on one verse, for the commentary module that the Bible references window reads. */
export interface CommentNote {
  book: number;
  chapter: number;
  verse: number;
  text: string;
}

export function commentaryLibrary(father: string, files: { name: string; text: string }[]): { meta: NlibWriteMeta; entries: LibEntry[]; notes: CommentNote[] } | null {
  const rows: { p: ReturnType<typeof passageOf>; comments: Comment[] }[] = [];
  for (const f of files) {
    const comments = parseCommentary(f.text);
    if (comments.length) rows.push({ p: passageOf(f.name.replace(/\.toml$/i, "")), comments });
  }
  if (!rows.length) return null;
  rows.sort((a, b) => bookRank(a.p.book) - bookRank(b.p.book) || naturalCompare(a.p.book, b.p.book) || a.p.chapter - b.p.chapter || a.p.verse - b.p.verse || naturalCompare(a.p.ref, b.p.ref));
  const scripture = isBibleBook(father);
  const title = scripture ? `${father}: passages it quotes from the Old Testament` : `${father}: comments on Scripture`;
  const b = new LibBuilder(title);
  const books = new Map<string, number>();
  for (const r of rows) {
    if (!books.has(r.p.book)) books.set(r.p.book, b.add(1, r.p.book, "", "book"));
    const text = r.comments
      .map((c) => {
        const by = scripture ? `${father}${c.where ? ` ${c.where}` : ""}` : c.source;
        return by ? `${c.quote}\n— ${by}` : c.quote;
      })
      .join("\n\n");
    b.add(books.get(r.p.book)!, r.p.ref, text, "passage", r.p.ref);
  }
  // a Father's comments become notes on the verses they are about; a Bible book's own folder is not a commentary
  const notes: CommentNote[] = [];
  if (!scripture)
    for (const r of rows) {
      const book = findBook(r.p.book)?.num;
      if (!book || r.p.chapter < 1) continue;
      for (const c of r.comments) notes.push({ book, chapter: r.p.chapter, verse: r.p.verse, text: `${father}${c.source ? `, ${c.source}` : ""}\n\n${c.quote}` });
    }
  return {
    notes,
    meta: { title, authors: [father], category: "classics", container: "Church Fathers Commentary (HistoricalChristianFaith)", url: "https://github.com/HistoricalChristianFaith/Commentaries-Database", license: "From HistoricalChristianFaith; the repository states no licence" },
    entries: b.entries,
  };
}

/** One author's folder of works: folders become sections, each HTML file a section with its own headings beneath. */
export function writingsLibrary(author: string, files: { path: string; html: string }[]): { meta: NlibWriteMeta; entries: LibEntry[] } | null {
  if (!files.length) return null;
  const b = new LibBuilder(author);
  const folders = new Map<string, number>([["", 1]]);
  const folder = (parts: string[]): number => {
    const key = parts.join("/");
    const have = folders.get(key);
    if (have) return have;
    const id = b.add(folder(parts.slice(0, -1)), parts[parts.length - 1], "", "work");
    folders.set(key, id);
    return id;
  };
  for (const f of [...files].sort((x, y) => naturalCompare(x.path, y.path))) {
    const parts = f.path.split("/");
    const stem = parts[parts.length - 1].replace(/\.html?$/i, "");
    const doc = htmlToLibrary(f.html, stem);
    b.graft(folder(parts.slice(0, -1)), stem, doc, "chapter");
  }
  return {
    meta: { title: author, authors: [author], category: "classics", container: "Church Fathers Writings (HistoricalChristianFaith)", url: "https://github.com/HistoricalChristianFaith/Writings-Database", license: "Public domain texts compiled by HistoricalChristianFaith" },
    entries: b.entries,
  };
}
