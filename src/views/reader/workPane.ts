import { ReadingSelect, type Taken } from "./readingSelect";
import { cutText } from "../../reader/partial";
import type { BarButton } from "./selectionBar";
import { markQuoted } from "./quotedMarks";
import { quotesOfText } from "../../library/quoted";
import { renameInline } from "./inlineRename";
import { MarkdownRenderer, Notice } from "obsidian";
import { flagsOf } from "../../reader/copySettings";
import { linkify } from "../../linkify";
import type { Place } from "../../reader/place";
import { databaseLabel, databaseOf } from "../../sources/catalog";
import { levelChoices, type Level } from "../../sources/levels";
import { locatorOf, type NlibEntry } from "../../sources/nlib";
import type { Source } from "../../sources/types";
import { buildTree, entryLabel, type Tree } from "../../sources/tree";
import { findRanges, type SearchMode } from "../../reader/searchOptions";
import { SummaryModal } from "../summaryModal";
import { nextPick, sortedPicks, wireContextMenu, type PickState } from "./passagePick";
import { footnoteFor, type Quotation } from "../../reader/quote";
import { copyQuote, wireQuoteClip } from "./quoteClip";
import { showSelectionBar, unwrapMarks, wrapRanges } from "./selectionBar";
import type { Pane, PaneCtx } from "./types";

type WorkPlace = Extract<Place, { kind: "work" }>;

/** A work read entry by entry: levels as drop-downs in the Place popover. */
export class WorkPane implements Pane {
  private src: Source | null = null;
  private entries: NlibEntry[] = [];
  private tree: Tree | null = null;
  private current: NlibEntry | null = null;
  private reading!: HTMLElement;
  private bar: { hide(): void } | null = null;
  private terms: { terms: string[]; mode: SearchMode } | null = null;

  constructor(private ctx: PaneCtx, private p: WorkPlace) {}

  place(): WorkPlace {
    return { kind: "work", uid: this.p.uid, entry: this.current?.id ?? 0 };
  }
  source() {
    return this.src?.title ?? "Work";
  }
  crumbs() {
    const s = this.src;
    if (!s) return [];
    const db = databaseOf(s);
    return [{ text: "Libraries", go: { kind: "shelf" } as Place }, { text: databaseLabel(db), go: { kind: "works", db } as Place }, { text: s.title }];
  }
  placeLabel() {
    const e = this.current;
    if (!e) return null;
    const l = entryLabel(e);
    return l.length > 34 ? `${l.slice(0, 32)}…` : l;
  }

  async load() {
    const c = this.ctx;
    c.host.empty();
    const s = c.plugin.sources().find((x) => x.uid === this.p.uid);
    const status = c.host.createEl("p", { cls: "booker-muted", text: "Opening…" });
    if (!s) return void status.setText("That work is no longer in the library.");
    this.src = s;
    try {
      if (s.kind === "db") this.entries = await c.plugin.sourceService.entries(s);
      else {
        const ix = await c.plugin.sourceService.index(s, (m) => status.setText(m));
        this.entries = ix.chunks.map((ch, i) => ({ id: i + 1, parent: null, level: "piece", locator: ch.loc, key: "", title: ch.loc, text: ch.text }));
      }
      this.tree = buildTree(this.entries);
    } catch (e) {
      return void status.setText(e instanceof Error ? e.message : String(e));
    }
    c.host.empty();
    this.reading = c.host.createDiv({ cls: "booker-reader-text booker-lib-reading" });
    this.sel = new ReadingSelect({
      root: this.reading,
      unitSel: ".booker-lib-text > p",
      units: () => this.paras(),
      body: (el) => el,
      quote: (taken) => this.quoteOf(taken),
      buttons: (taken, done) => this.buttons(taken, done),
    });
    wireContextMenu(this.reading, () => (this.sel.taken().length ? this.quoteOf(this.sel.taken()) : null), (t) => new SummaryModal(c.plugin, t, this.src?.title ?? "", "written").open());
    const first = this.p.entry ? this.entries.find((e) => e.id === this.p.entry) : this.entries.find((e) => e.text.trim());
    if (first) this.select(first);
    else this.intro();
    c.changed();
  }

  moveTo(p: Place): boolean {
    if (p.kind !== "work" || p.uid !== this.p.uid || !this.tree) return false;
    const e = p.entry ? this.entries.find((x) => x.id === p.entry) : this.entries.find((x) => x.text.trim());
    if (!e) return false;
    this.select(e);
    return true;
  }

  /** Give the work a new title: it is kept in the properties of its source note. */
  private async rename(name: string) {
    const s = this.src!;
    const f = s.note ? this.ctx.app.vault.getFileByPath(s.note) : null;
    if (!f) throw new Error("This work has no source note to rename.");
    await this.ctx.app.fileManager.processFrontMatter(f, (fm) => {
      fm.title = name;
    });
    s.title = name;
    this.ctx.changed();
  }

  private intro() {
    const s = this.src!;
    this.reading.empty();
    renameInline(this.reading.createEl("h2", { cls: "booker-reader-title", text: s.title }), () => s.title, (v) => this.rename(v));
    this.reading.createDiv({ cls: "booker-muted", text: [s.authors.join(", "), s.year, `${this.entries.length} ${s.kind === "db" ? "entries" : "pieces"}`].filter(Boolean).join(" · ") });
  }

  private at() {
    return this.current ? this.entries.indexOf(this.current) : -1;
  }
  canPrev() {
    return this.at() > 0;
  }
  canNext() {
    const i = this.at();
    return i >= 0 && i < this.entries.length - 1;
  }
  prev() {
    this.ctx.go({ kind: "work", uid: this.p.uid, entry: this.entries[this.at() - 1].id });
  }
  next() {
    this.ctx.go({ kind: "work", uid: this.p.uid, entry: this.entries[this.at() + 1].id });
  }

  private levels(): Level[] {
    if (!this.tree || !this.current) return [];
    if (this.src?.kind !== "db") {
      const options = this.entries.slice(0, 500).map((e) => ({ target: e.id, text: e.title }));
      return options.length > 1 ? [{ label: "Piece", options, selected: this.current.id }] : [];
    }
    return levelChoices(this.entries, this.tree, this.current);
  }

  picker(into: HTMLElement, close: () => void) {
    into.empty();
    const box = into.createDiv({ cls: "booker-reader-levels" });
    const levels = this.levels();
    if (!levels.length) box.createDiv({ cls: "booker-muted", text: "This work has no sections to choose from." });
    for (const lv of levels) {
      box.createDiv({ cls: "booker-reader-picker-head", text: lv.label });
      const sel = box.createEl("select", { attr: { "aria-label": lv.label } });
      for (const o of lv.options) sel.createEl("option", { value: String(o.target), text: o.text.length > 70 ? `${o.text.slice(0, 68)}…` : o.text });
      sel.value = String(lv.selected);
      sel.addEventListener("change", () => {
        close();
        this.ctx.go({ kind: "work", uid: this.p.uid, entry: +sel.value });
      });
    }
  }

  private select(e: NlibEntry) {
    this.current = e;
    const s = this.src!;
    const r = this.reading;
    r.empty();
    const byId = this.tree?.byId ?? new Map<number, NlibEntry>();
    const loc = s.kind === "db" ? locatorOf(e, byId) : "";
    const title = s.kind === "db" ? entryLabel(e) : e.title;
    renameInline(r.createDiv({ cls: "booker-reader-kicker", text: s.title }), () => s.title, (v) => this.rename(v));
    r.createEl("h2", { cls: "booker-reader-title", text: title });
    if (loc && loc !== title && !loc.endsWith(title)) r.createDiv({ cls: "booker-muted booker-reader-loc", text: loc });
    if (e.text.length > 600) {
      const sum = r.createEl("a", { text: "Summarize this section", cls: "booker-bible-more" });
      sum.addEventListener("click", () => new SummaryModal(this.ctx.plugin, e.text, title, "written").open());
    }
    if (s.kind !== "db") {
      const open = r.createEl("a", { text: "Highlights and quotes", cls: "booker-bible-more" });
      open.addEventListener("click", () => void this.ctx.plugin.openSourceViewer(s, { chunk: Math.max(0, e.id - 1) }));
    }
    this.sel?.reset();
    const text = r.createDiv({ cls: "booker-lib-text" });
    const paras = e.text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    if (!paras.length) text.createEl("p", { cls: "booker-muted", text: "This is a heading. Choose a section from the Place menu or the contents." });
    this.ctx.render.unload();
    this.ctx.render.load();
    void MarkdownRenderer.render(this.ctx.app, paras.join("\n\n"), text, "", this.ctx.render).then(() => {
      linkify(text, this.ctx.plugin, { citations: false });
      void this.paintQuoted(text);
      if (this.terms) this.highlight(this.terms.terms, this.terms.mode);
    });
    this.ctx.host.scrollTo({ top: 0 });
    this.ctx.changed();
  }

  // ------------------------------------------------------------ selecting words

  private sel!: ReadingSelect;

  private paras(): HTMLElement[] {
    return Array.from(this.reading?.querySelectorAll<HTMLElement>(".booker-lib-text > p") ?? []);
  }

  /** Where the words in view are from: the section, and its place in a database. */
  private citation(): string {
    const e = this.current;
    return [e ? entryLabel(e) : "", this.src?.kind === "db" && e ? locatorOf(e, this.tree?.byId ?? new Map()) : ""].filter((x, i, a) => x && a.indexOf(x) === i).join(", ");
  }

  /** The quotation for what is taken: whole paragraphs, or the words with the cut ends marked. */
  private quoteOf(taken: Taken[]): Quotation | null {
    const text = taken.map(cutText).filter(Boolean).join("\n\n");
    return text && this.src ? { text, footnote: footnoteFor(this.src.title, this.citation()), ...flagsOf(this.ctx.copy()) } : null;
  }

  private buttons(taken: Taken[], done: () => void): BarButton[] {
    const s = this.src!;
    const e = this.current;
    const q = () => this.quoteOf(taken);
    const words = () => taken.map((t) => t.full.slice(t.start, t.end).replace(/\s+/g, " ").trim()).filter(Boolean).join("\n\n");
    const citation = this.citation();
    return [
      { label: "Insert", tip: "Write this into the most recent note, with a footnote", run: () => ((x) => (done(), x && void this.ctx.plugin.insertQuoted(x)))(q()) },
      {
        label: "Bookmark",
        icon: "bookmark",
        tip: "Add this to your bookmarks",
        run: () => {
          done();
          void this.ctx.plugin.stores
            .addToBucket({ text: words(), citation: citation || s.title, archiveSource: s.title, book: e ? entryLabel(e) : "", chapter: e && s.kind === "db" ? locatorOf(e, this.tree?.byId ?? new Map()) : "", kind: "reference", fileKind: s.kind, uid: s.uid, place: JSON.stringify({ kind: "work", uid: s.uid, entry: e?.id ?? 0 }) })
            .then((r) => new Notice(r.added ? "Booker: added to bookmarks." : "Booker: already in your bookmarks."));
        },
      },
      { label: "Summarize", tip: "Summarize these words with AI", run: () => (done(), new SummaryModal(this.ctx.plugin, words(), s.title, "written").open()) },
      { label: "Copy", run: () => ((x) => (done(), x && copyQuote(x)))(q()) },
    ];
  }

  /** Paragraphs quoted in your writing get a colour and a Go to button. */
  private async paintQuoted(text: HTMLElement) {
    const all = await this.ctx.plugin.quoted.records();
    text.querySelectorAll<HTMLElement>(":scope > p").forEach((p) => p.isConnected && markQuoted(this.ctx.plugin, p, quotesOfText(all, (p.textContent ?? "").replace(/Go to \(\d+\)$/, ""))));
  }

  // ------------------------------------------------------------ search on this page

  highlight(terms: string[], mode: SearchMode): number {
    this.clearHighlight();
    this.terms = { terms, mode };
    const body = this.reading?.querySelector<HTMLElement>(".booker-lib-text");
    if (!body) return 0;
    const marks = wrapRanges(body, findRanges(body.textContent ?? "", terms, mode).map(([start, end]) => ({ start, end, cls: "booker-find" })));
    marks[0]?.scrollIntoView({ block: "center" });
    return marks.length;
  }

  clearHighlight() {
    this.terms = null;
    const body = this.reading?.querySelector<HTMLElement>(".booker-lib-text");
    if (body) unwrapMarks(body, "mark.booker-find");
  }

  destroy() {
    this.sel?.destroy();
  }
}
