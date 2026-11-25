/** What of your writing quotes a verse, a commentary note or a passage of a work: block quotes in your notes with their footnotes. */
import type { App, TFile } from "obsidian";
import { findProjects } from "../project/vaultOps";
import { scanReferences } from "../scripture";
import type { Passage } from "../scripture/ref";

export interface QuoteRecord {
  path: string;
  /** 0-based line of the quote in the note */
  line: number;
  /** the quoted words */
  quote: string;
  /** the footnotes that go with the quote, and the "— source" line */
  notes: string;
  passages: Passage[];
}

/** The block quotes of a note with the footnotes they point at. Pure. */
export function scanQuotes(path: string, text: string): QuoteRecord[] {
  const lines = text.split("\n");
  const defs = new Map<string, string>();
  lines.forEach((l, i) => {
    const m = /^\[\^([^\]]+)\]:\s*(.*)$/.exec(l);
    if (!m) return;
    let body = m[2];
    for (let k = i + 1; k < lines.length && /^( {2,}|\t)\S/.test(lines[k]); k++) body += " " + lines[k].trim();
    defs.set(m[1], body);
  });
  const out: QuoteRecord[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith(">")) continue;
    let j = i;
    while (j < lines.length && lines[j].startsWith(">")) j++;
    const block = lines.slice(i, j).map((l) => l.replace(/^>\s?/, ""));
    const cite = block.filter((l) => /^\s*[—–-]\s/.test(l));
    const body = block.filter((l) => l.trim() && !cite.includes(l)).join("\n\n");
    const labels = [...block.join("\n").matchAll(/\[\^([^\]]+)\]/g)].map((m) => m[1]);
    const notes = [...labels.map((l) => defs.get(l) ?? ""), ...cite].filter(Boolean).join(" ");
    out.push({ path, line: i, quote: body.replace(/\[\^[^\]]+\]/g, ""), notes, passages: scanReferences(notes) });
    i = j;
  }
  return out;
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

const covers = (p: Passage, book: string, c: number, v: number): boolean => {
  if (p.book !== book) return false;
  const at = c * 1000 + v;
  return p.from.c * 1000 + (p.from.v ?? 0) <= at && at <= p.to.c * 1000 + (p.to.v ?? 999);
};

/** Quotes in the notes of your books, read once per change of a note. */
export class QuotedIndex {
  private cache = new Map<string, { mtime: number; records: QuoteRecord[] }>();

  constructor(private app: App, private enabled: () => boolean = () => true) {}

  /** Forget what was read, so the next look reads every note again (a note changed in another editor, or deleted). */
  refresh() {
    this.cache.clear();
  }

  /** A note that is gone: its quotes are no longer offered. */
  drop(path: string) {
    this.cache.delete(path);
  }

  async records(): Promise<QuoteRecord[]> {
    if (!this.enabled()) return [];
    const bases = findProjects(this.app).map((p) => p.layout.base + "/");
    const out: QuoteRecord[] = [];
    const seen = new Set<string>();
    for (const f of this.app.vault.getMarkdownFiles() as TFile[]) {
      if (!bases.some((b) => f.path.startsWith(b))) continue;
      seen.add(f.path);
      let e = this.cache.get(f.path);
      if (!e || e.mtime !== f.stat.mtime) {
        const text = await this.app.vault.cachedRead(f);
        e = { mtime: f.stat.mtime, records: text.includes(">") ? scanQuotes(f.path, text) : [] };
        this.cache.set(f.path, e);
      }
      out.push(...e.records);
    }
    for (const k of [...this.cache.keys()]) if (!seen.has(k)) this.cache.delete(k);
    return out;
  }
}

/** Quotes of a verse. */
export const quotesOfVerse = (all: QuoteRecord[], book: string, c: number, v: number): QuoteRecord[] => all.filter((r) => r.passages.some((p) => covers(p, book, c, v)));

/** Quotes of a commentary note: the footnote names the commentary and the verse it is on. */
export const quotesOfNote = (all: QuoteRecord[], commentary: string, book: string, c: number, v: number): QuoteRecord[] =>
  all.filter((r) => !!commentary && norm(r.notes).includes(norm(commentary)) && r.passages.some((p) => covers(p, book, c, v)));

/** Quotes of a passage of a work: the same words in a block quote. */
export function quotesOfText(all: QuoteRecord[], text: string): QuoteRecord[] {
  const t = norm(text);
  if (t.length < 20) return [];
  const probe = t.slice(0, 60);
  return all.filter((r) => {
    const q = norm(r.quote);
    return q.length >= 20 && (t.includes(q.slice(0, 60)) || q.includes(probe));
  });
}
