import { findRanges, type SearchMode } from "../../reader/searchOptions";
import { moduleLabel } from "../../scripture/store";
import { unwrapMarks, wrapRanges } from "./selectionBar";
import { linkify } from "../../linkify";
import type { Place } from "../../reader/place";
import { BOOK_BY_OSIS } from "../../scripture/books";
import type { LiveCommentary } from "../../scripture/esword";
import { drawPassagePicker } from "./picker";
import { footnoteFor } from "../../reader/quote";
import { wireQuoteUnits, type QuoteUnit } from "./quoteUnits";
import { markQuoted } from "./quotedMarks";
import { quotesOfNote } from "../../library/quoted";
import type { Pane, PaneCtx } from "./types";

type CmtPlace = Extract<Place, { kind: "commentary" }>;

/** A commentary read as a book: a chapter of notes, the verse asked for marked. */
export class CommentaryPane implements Pane {
  private c: LiveCommentary | null = null;
  private name = "Commentary";
  private have: string[] = [];
  private book = "";
  private chapter = 1;
  private verse = 0;
  private verseTo = 0;
  private quoting: { reset(): void; destroy(): void } | null = null;

  constructor(private ctx: PaneCtx, private p: CmtPlace) {
    this.book = p.book ?? "";
    this.chapter = p.chapter ?? 1;
    this.verse = p.verse ?? 0;
    this.verseTo = p.verseTo ?? 0;
  }

  place(): CmtPlace {
    return { kind: "commentary", path: this.p.path, ...(this.book && { book: this.book }), chapter: this.chapter, ...(this.verse && { verse: this.verse }), ...(this.verseTo && { verseTo: this.verseTo }) };
  }
  source() {
    return this.name;
  }
  crumbs() {
    return [{ text: "Libraries", go: { kind: "shelf" } as Place }, { text: "Commentaries", go: { kind: "works", db: "@commentaries" } as Place }, { text: this.name }];
  }
  placeLabel() {
    return this.book ? `${BOOK_BY_OSIS.get(this.book)?.name ?? this.book} ${this.chapter}` : null;
  }

  async load() {
    const h = this.ctx.host;
    h.empty();
    const status = h.createEl("p", { cls: "booker-muted", text: "Opening…" });
    const file = (await this.ctx.plugin.modules.commentaries()).find((f) => f.path === this.p.path);
    if (!file) return void status.setText("That commentary is not in the Bibles folder any more.");
    this.name = moduleLabel(file.name);
    try {
      this.c = await this.ctx.plugin.modules.loadCommentary(file);
    } catch (e) {
      return void status.setText(`Could not read this commentary. ${e instanceof Error ? e.message : e}`);
    }
    this.have = this.c.books();
    if (!this.have.includes(this.book)) this.book = this.have[0] ?? "";
    if (!this.book) return void status.setText("This commentary has no notes.");
    const chs = this.c.chapters(this.book);
    if (!chs.includes(this.chapter)) this.chapter = chs[0] ?? 1;
    this.show();
  }

  moveTo(p: Place): boolean {
    if (p.kind !== "commentary" || p.path !== this.p.path || !this.c) return false;
    this.book = p.book && this.have.includes(p.book) ? p.book : this.book;
    const chs = this.c.chapters(this.book);
    this.chapter = p.chapter && chs.includes(p.chapter) ? p.chapter : chs[0] ?? 1;
    this.verse = p.verse ?? 0;
    this.verseTo = p.verseTo ?? 0;
    this.show();
    return true;
  }

  private spots(): Array<{ book: string; chapter: number }> {
    const out: Array<{ book: string; chapter: number }> = [];
    for (const b of this.have) for (const c of this.c!.chapters(b)) out.push({ book: b, chapter: c });
    return out;
  }
  private index() {
    return this.spots().findIndex((s) => s.book === this.book && s.chapter === this.chapter);
  }
  canPrev() {
    return !!this.c && this.index() > 0;
  }
  canNext() {
    return !!this.c && this.index() < this.spots().length - 1;
  }
  prev() {
    const s = this.spots()[this.index() - 1];
    if (s) this.ctx.go({ kind: "commentary", path: this.p.path, ...s });
  }
  next() {
    const s = this.spots()[this.index() + 1];
    if (s) this.ctx.go({ kind: "commentary", path: this.p.path, ...s });
  }

  picker(into: HTMLElement, close: () => void) {
    const c = this.c;
    if (!c) return;
    drawPassagePicker(into, {
      books: this.have,
      chapters: (b) => c.chapters(b),
      book: this.book,
      chapter: this.chapter,
      onPick: (book, chapter) => {
        close();
        this.ctx.go({ kind: "commentary", path: this.p.path, book, chapter });
      },
    });
  }

  private show() {
    const c = this.c!;
    const h = this.ctx.host;
    h.empty();
    const reading = h.createDiv({ cls: "booker-reader-text" });
    reading.createDiv({ cls: "booker-reader-kicker", text: this.name });
    reading.createEl("h2", { cls: "booker-reader-title", text: `${BOOK_BY_OSIS.get(this.book)?.name ?? this.book} ${this.chapter}` });
    const rows = c.chapterRows(this.book, this.chapter);
    if (!rows.length) reading.createEl("p", { cls: "booker-muted", text: "No notes on this chapter." });
    let target: HTMLElement | null = null;
    const units = new Map<HTMLElement, QuoteUnit>();
    const shown: Array<[HTMLElement, number]> = [];
    const bookName = BOOK_BY_OSIS.get(this.book)?.name ?? this.book;
    for (const r of rows) {
      const note = reading.createDiv({ cls: "booker-lib-cmtnote" });
      const verses = r.from === 0 ? "" : r.to > r.from ? `:${r.from}-${r.to}` : `:${r.from}`;
      const ref = `${bookName} ${this.chapter}${verses}`;
      units.set(note, { text: r.text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean).join("\n\n"), footnote: footnoteFor(this.name, `on ${ref}`), citation: `on ${ref}`, source: this.name, book: bookName, chapter: String(this.chapter), place: { kind: "commentary", path: this.p.path, book: this.book, chapter: this.chapter, ...(r.from > 0 && { verse: r.from }) } });
      shown.push([note, r.from || 1]);
      const last = Math.max(this.verse, this.verseTo);
      const covers = this.verse > 0 && r.from <= last && (r.to >= this.verse || r.to === 0);
      note.toggleClass("is-target", covers);
      if (covers && !target) target = note;
      note.createDiv({ cls: "booker-lib-cmtref", text: r.from === 0 ? "Chapter" : r.to > r.from ? `Verses ${r.from}–${r.to}` : `Verse ${r.from}` });
      const body = note.createDiv({ cls: "booker-lib-text" });
      for (const para of r.text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)) body.createEl("p", { text: para });
      linkify(body, this.ctx.plugin, { citations: false });
    }
    this.quoting?.destroy();
    this.quoting = wireQuoteUnits(this.ctx.plugin, reading, ".booker-lib-cmtnote", (el) => units.get(el) ?? null);
    void this.ctx.plugin.quoted.records().then((all) => shown.forEach(([n, v]) => n.isConnected && markQuoted(this.ctx.plugin, n, quotesOfNote(all, this.name, this.book, this.chapter, v))));
    if (target) target.scrollIntoView({ block: "start" });
    else h.scrollTo({ top: 0 });
    this.ctx.changed();
  }

  highlight(terms: string[], mode: SearchMode): number {
    this.clearHighlight();
    const body = this.ctx.host.querySelector<HTMLElement>(".booker-reader-text");
    if (!body) return 0;
    const marks = wrapRanges(body, findRanges(body.textContent ?? "", terms, mode).map(([start, end]) => ({ start, end, cls: "booker-find" })));
    marks[0]?.scrollIntoView({ block: "center" });
    return marks.length;
  }

  clearHighlight() {
    const body = this.ctx.host.querySelector<HTMLElement>(".booker-reader-text");
    if (body) unwrapMarks(body, "mark.booker-find");
  }

  destroy() {
    this.quoting?.destroy();
  }
}
