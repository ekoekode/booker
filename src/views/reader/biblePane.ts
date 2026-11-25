import { markQuoted } from "./quotedMarks";
import { quotesOfVerse } from "../../library/quoted";
import { Menu, Notice, setIcon } from "obsidian";
import { flagsOf, formatVerses } from "../../reader/copySettings";
import type { Place } from "../../reader/place";
import { BOOK_BY_OSIS } from "../../scripture/books";
import type { BibleModule, Seg } from "../../scripture/module";
import type { ModuleFile } from "../../scripture/store";
import { forChapter, splitVerse, type BibleHighlight } from "../../library/bibleHighlights";
import { findRanges, type SearchMode } from "../../reader/searchOptions";
import { verseSpan } from "../../scripture/selection";
import { drawPassagePicker } from "./picker";
import { nextPick, sortedPicks, spans, wireContextMenu, type PickState } from "./passagePick";
import { footnoteFor, type Quotation } from "../../reader/quote";
import { copyQuote, wireQuoteClip } from "./quoteClip";
import { ResourceManager } from "../resourceManager";
import { SummaryModal } from "../summaryModal";
import { unwrapMarks, wrapRanges, type BarButton, type Part, type Wrap } from "./selectionBar";
import { ReadingSelect, type Taken } from "./readingSelect";
import { cutText } from "../../reader/partial";
import type { Pane, PaneCtx } from "./types";

type BiblePlace = Extract<Place, { kind: "bible" }>;

/** A Bible chapter, one verse selectable; the selected verse is announced to the References tab. */
export class BiblePane implements Pane {
  private files: ModuleFile[] = [];
  private mod: BibleModule | null = null;
  private moduleId: string;
  private book: string;
  private chapter: number;
  private verse: number;
  private verseTo: number;
  private text!: HTMLElement;
  private select!: ReadingSelect;
  private offHl: (() => void) | null = null;
  /** the word-for-word strips that are open, by verse */
  private strips = new Map<number, HTMLElement>();

  constructor(private ctx: PaneCtx, p: BiblePlace) {
    this.moduleId = p.module;
    this.book = p.book;
    this.chapter = p.chapter;
    this.verse = p.verse;
    this.verseTo = p.verseTo ?? 0;
  }

  place(): BiblePlace {
    return { kind: "bible", module: this.moduleId, book: this.book, chapter: this.chapter, verse: this.verse, ...(this.verseTo > this.verse && { verseTo: this.verseTo }) };
  }
  source() {
    return this.mod?.abbr || this.mod?.name || "Bible";
  }
  crumbs() {
    return [];
  }
  placeLabel() {
    return `${BOOK_BY_OSIS.get(this.book)?.name ?? this.book} ${this.chapter}`;
  }

  async load() {
    const c = this.ctx;
    c.host.empty();
    this.text = c.host.createDiv({ cls: "booker-reader-text booker-bible-text" });
    this.select = new ReadingSelect({
      root: this.text,
      unitSel: ".booker-bible-verse",
      units: () => this.rows(),
      body: (el) => el.querySelector<HTMLElement>(".booker-bible-vtext") ?? el,
      changed: (indices, how) => how !== "set" && this.picked(indices),
      quote: (taken) => this.quoteOf(taken),
      buttons: (taken, done) => this.buttons(taken, done),
    });
    wireContextMenu(this.text, () => this.select.taken().length ? this.quoteOf(this.select.taken()) : null, (t) => new SummaryModal(c.plugin, t, this.placeLabel(), "written").open());
    this.offHl = c.plugin.stores.highlightData.onChange(() => void this.paintHighlights());
    this.files = await c.plugin.modules.bibles();
    if (!this.files.length) {
      this.text.createEl("p", { text: `No Bible modules found. Put an e-Sword, MySword or XML Bible in “${c.plugin.scriptureData().folder}”, or use Booker: Add Bible module.` });
      return;
    }
    if (!this.moduleId) this.moduleId = c.plugin.scriptureData().defaultModule ?? "";
    await this.useModule(this.moduleId);
    this.show();
  }

  private async useModule(path: string) {
    const f = this.files.find((x) => x.path === path) ?? this.files[0];
    if (!f) return;
    this.moduleId = f.path;
    try {
      this.mod = await this.ctx.plugin.modules.load(f);
    } catch (e) {
      this.mod = null;
      new Notice(`Booker: could not read ${f.name}. ${e instanceof Error ? e.message : e}`);
    }
  }

  moveTo(p: Place): boolean {
    if (p.kind !== "bible" || (p.module && p.module !== this.moduleId)) return false;
    this.book = p.book;
    this.chapter = p.chapter;
    this.verse = p.verse;
    this.verseTo = p.verseTo ?? 0;
    this.show();
    return true;
  }

  books() {
    return this.mod?.books() ?? [];
  }
  canPrev() {
    return !!this.mod;
  }
  canNext() {
    return !!this.mod;
  }
  prev() {
    this.step(-1);
  }
  next() {
    this.step(1);
  }

  private step(by: number) {
    if (!this.mod) return;
    const books = this.mod.books();
    let i = books.indexOf(this.book);
    let c = this.chapter + by;
    if (c < 1) {
      i = (i - 1 + books.length) % books.length;
      c = this.mod.chapterCount(books[i]);
    } else if (c > this.mod.chapterCount(this.book)) {
      i = (i + 1) % books.length;
      c = 1;
    }
    this.ctx.go({ ...this.place(), book: books[i], chapter: c, verse: 0 });
  }

  picker(into: HTMLElement, close: () => void) {
    const mod = this.mod;
    if (!mod) return;
    drawPassagePicker(into, {
      books: mod.books(),
      chapters: (b) => Array.from({ length: mod.chapterCount(b) }, (_, i) => i + 1),
      book: this.book,
      chapter: this.chapter,
      onPick: (b, c) => {
        close();
        this.ctx.go({ ...this.place(), book: b, chapter: c, verse: 0 });
      },
    });
  }

  private segs(segs: Seg[], into: HTMLElement) {
    for (const s of segs) {
      if (s.i) into.createEl("i", { text: s.t });
      else if (s.jesus) into.createSpan({ cls: "booker-bible-jesus", text: s.t });
      else into.appendText(s.t);
    }
  }

  private show() {
    const mod = this.mod;
    if (!mod) return;
    if (!mod.books().includes(this.book)) this.book = mod.books()[0] ?? this.book;
    // a Bible with only some chapters opens at the first it has
    if (!mod.verseCount(this.book, this.chapter)) {
      const first = Array.from({ length: Math.max(mod.chapterCount(this.book), 0) }, (_, i) => i + 1).find((c) => mod.verseCount(this.book, c) > 0);
      if (first) this.chapter = first;
    }
    const name = BOOK_BY_OSIS.get(this.book)?.name ?? this.book;
    const t = this.text;
    t.empty();
    this.strips.clear();
    t.parentElement?.scrollTo({ top: 0 });
    t.createDiv({ cls: "booker-reader-kicker", text: name });
    t.createEl("h2", { cls: "booker-reader-title", text: `Chapter ${this.chapter}` });
    const n = mod.verseCount(this.book, this.chapter);
    if (!n) t.createEl("p", { cls: "booker-muted", text: "This chapter is not in this Bible." });
    let sel: HTMLElement | null = null;
    for (let v = 1; v <= n; v++) {
      const segs = mod.verse(this.book, this.chapter, v);
      if (!segs) continue;
      const row = t.createEl("p", { cls: "booker-bible-verse", attr: { "data-v": String(v) } });
      row.createEl("sup", { text: String(v) });
      this.segs(segs, row.createSpan({ cls: "booker-bible-vtext" }));
      if (v === this.verse) sel = row;
    }
    if (sel) sel.scrollIntoView({ block: "center" });
    else {
      this.verse = 0;
      this.verseTo = 0;
    }
    const at: number[] = [];
    this.rows().forEach((r, i) => {
      const v = Number(r.dataset.v);
      if (this.verse > 0 && v >= this.verse && v <= Math.max(this.verse, this.verseTo)) at.push(i);
    });
    this.select.set(at);
    this.announce();
    this.ctx.changed();
    void this.paintHighlights();
    void this.paintQuoted();
  }

  /** Verses quoted in your writing get a colour and a Go to button. */
  private async paintQuoted() {
    const all = await this.ctx.plugin.quoted.records();
    for (const r of this.rows()) {
      if (!r.isConnected) return;
      markQuoted(this.ctx.plugin, r, quotesOfVerse(all, this.book, this.chapter, Number(r.dataset.v)));
    }
  }

  private rows(): HTMLElement[] {
    return Array.from(this.text.querySelectorAll<HTMLElement>(".booker-bible-verse"));
  }

  /** Tell the References tab where the reader is. */
  private announce() {
    if (this.ctx.silent) return;
    this.ctx.plugin.selection.set({ book: this.book, chapter: this.chapter, verse: this.verse, ...(this.verseTo > this.verse && { verseTo: this.verseTo }) });
  }

  /** Set what the reader is "at" from the picked verses, first to last; the References tab follows. */
  private picked(indices: number[]) {
    const rows = this.rows();
    const list = indices.map((i) => Number(rows[i]?.dataset.v)).filter(Boolean).sort((a, b) => a - b);
    this.verse = list[0] ?? 0;
    this.verseTo = list.length > 1 ? list[list.length - 1] : 0;
    this.announce();
    this.ctx.go(this.place(), { replace: true });
  }

  private sourceName(): string {
    return this.mod?.abbr || this.mod?.name || "";
  }

  /** The quotation for what is taken: every verse it touches, the cut ends of partly taken verses marked with an ellipsis. */
  private quoteOf(taken: Taken[]): Quotation | null {
    const verses = taken.map((t) => ({ chapter: this.chapter, verse: Number(t.el.dataset.v), text: cutText(t) })).filter((v) => v.text);
    const text = formatVerses(verses, this.ctx.copy());
    return text ? { text, footnote: footnoteFor(this.sourceName(), this.citationOf(verses.map((v) => v.verse))), ...flagsOf(this.ctx.copy()) } : null;
  }

  private citationOf(verses: number[]): string {
    const name = BOOK_BY_OSIS.get(this.book)?.name ?? this.book;
    return `${name} ${this.chapter}:${spans([...new Set(verses)].sort((a, b) => a - b))}`;
  }

  private buttons(taken: Taken[], done: () => void): BarButton[] {
    const q = () => this.quoteOf(taken);
    const verses = [...new Set(taken.map((t) => Number(t.el.dataset.v)))];
    const studying = verses.length > 0 && verses.every((v) => this.strips.has(v));
    const parts: Part[] = taken.map((t) => ({ verse: Number(t.el.dataset.v), start: t.start, end: t.end, text: t.full.slice(t.start, t.end) }));
    const words = () => taken.map((t) => t.full.slice(t.start, t.end).trim()).join(" ");
    const cite = this.citationOf(parts.map((p) => p.verse));
    return [
      {
        label: "Commentary",
        icon: "book-open-text",
        tip: "See the commentaries on these verses",
        run: () => (done(), void this.ctx.plugin.openCommentary({ book: this.book, chapter: this.chapter, verse: Math.min(...verses), ...(verses.length > 1 && { verseTo: Math.max(...verses) }) })),
      },
      { label: "Insert", tip: "Write this into the most recent note, with a footnote", run: () => ((q) => (done(), q && void this.ctx.plugin.insertQuoted(q)))(q()) },
      {
        label: "Word study",
        icon: "languages",
        on: studying,
        tip: studying ? "Close the word study above these verses" : "Show the Hebrew or Greek, word for word, above these verses",
        run: () => (done(), void this.toggleWords(taken.map((t) => t.el), !studying)),
      },
      ...(this.strips.size > 1 || (this.strips.size && !studying)
        ? [{ label: "Close all", icon: "x", tip: "Close every word study line in this chapter", run: () => (done(), [...this.strips.keys()].forEach((v) => this.closeStrip(v))) }]
        : []),
      { label: "Highlight", tip: "Colour these words", run: (e) => this.highlightMenu(e, parts) },
      {
        label: "Bookmark",
        icon: "bookmark",
        tip: "Add this to your bookmarks",
        run: () => {
          done();
          void this.ctx.plugin.stores
            .addToBucket({ text: words(), citation: cite, archiveSource: this.sourceName(), book: BOOK_BY_OSIS.get(this.book)?.name ?? this.book, chapter: String(this.chapter), kind: "verse", fileKind: "bible", place: JSON.stringify({ kind: "bible", module: this.moduleId, book: this.book, chapter: this.chapter, verse: parts[0]?.verse ?? 0, ...(parts.length > 1 && { verseTo: parts[parts.length - 1].verse }) }) })
            .then((r) => new Notice(r.added ? "Booker: added to bookmarks." : "Booker: already in your bookmarks."));
        },
      },
      { label: "Summarize", tip: "Summarize these words with AI", run: () => (done(), new SummaryModal(this.ctx.plugin, words(), cite, "written").open()) },
      { label: "Copy", run: () => ((x) => (done(), x && copyQuote(x)))(q()) },
    ];
  }

  private closeStrip(v: number) {
    this.strips.get(v)?.remove();
    this.strips.delete(v);
  }

  /** Put the original-language words directly above each chosen verse (on), or take them away again (off). Open ones stay while other verses are picked. */
  private async toggleWords(rows: HTMLElement[], on: boolean) {
    const plugin = this.ctx.plugin;
    for (const row of rows) {
      const v = Number(row.dataset.v);
      if (!on) {
        this.closeStrip(v);
        continue;
      }
      if (this.strips.has(v)) continue;
      const strip = createDiv({ cls: "booker-ws" });
      this.strips.set(v, strip);
      row.before(strip);
      const x = strip.createEl("button", { cls: "booker-ws-x", attr: { "aria-label": "Close this word study" } });
      setIcon(x, "x");
      x.addEventListener("click", (e) => {
        e.stopPropagation();
        this.closeStrip(v);
      });
      const inner = strip.createDiv({ cls: "booker-ws-in" });
      const ready = await plugin.wordData.available();
      const words = ready ? await plugin.wordData.verse(this.book, this.chapter, v) : null;
      if (!strip.isConnected) continue;
      if (!words) {
        inner.createSpan({ cls: "booker-muted", text: ready ? "No word-for-word data for this verse." : "The Hebrew and Greek word-for-word data is not downloaded yet." });
        if (!ready) inner.createEl("button", { text: "Resource manager" }).addEventListener("click", () => new ResourceManager(plugin).open());
      } else {
        const rtl = words[0].s.startsWith("H") && words[0].l !== "Greek";
        const line = inner.createDiv({ cls: "booker-ws-words", attr: { dir: rtl ? "rtl" : "ltr" } });
        words.forEach((w, i) => {
          const b = line.createEl("button", { cls: "booker-ws-word", attr: { style: `--i:${i}`, "aria-label": `Word study: ${w.t}` } });
          b.createSpan({ cls: "booker-ws-orig", text: w.t, attr: { lang: w.s.startsWith("H") ? "he" : "grc" } });
          if (w.tr) b.createSpan({ cls: "booker-ws-tr", text: w.tr });
          b.createSpan({ cls: "booker-ws-en", text: w.g });
          if (w.s) b.createSpan({ cls: "booker-ws-num", text: w.s });
          b.addEventListener("click", (e) => {
            e.stopPropagation();
            const place = { kind: "word" as const, strongs: w.s, text: w.t, translit: w.tr, gloss: w.g, parse: w.p };
            if (this.ctx.openWord) this.ctx.openWord(place);
            else this.ctx.go(place);
          });
        });
      }
      window.requestAnimationFrame(() => strip.addClass("is-open"));
    }
  }

  private highlightMenu(e: MouseEvent, parts: Part[]) {
    const menu = new Menu();
    for (const c of ["yellow", "blue", "green", "pink"])
      menu.addItem((i) => i.setTitle(c[0].toUpperCase() + c.slice(1)).onClick(() => void this.addHighlights(parts, c)));
    menu.addItem((i) => i.setTitle("Remove highlight").setIcon("eraser").onClick(() => void this.removeHighlights(parts)));
    menu.showAtMouseEvent(e);
  }

  private async addHighlights(parts: Part[], color: string) {
    this.select.hide();
    window.getSelection()?.removeAllRanges();
    for (const p of parts) await this.ctx.plugin.stores.addHighlight({ module: this.moduleId, book: this.book, chapter: this.chapter, verse: p.verse, start: p.start, end: p.end, text: p.text, color });
  }

  private async removeHighlights(parts: Part[]) {
    this.select.hide();
    window.getSelection()?.removeAllRanges();
    const all = (await this.ctx.plugin.stores.highlightData.get()).items;
    for (const p of parts)
      for (const h of all) if (h.module === this.moduleId && h.book === this.book && h.chapter === this.chapter && h.verse === p.verse && h.start < p.end && p.start < h.end) await this.ctx.plugin.stores.removeHighlight(h.id);
  }

  /** Colour the highlights saved for this chapter. */
  private async paintHighlights() {
    if (!this.text?.isConnected) return;
    const data = await this.ctx.plugin.stores.highlightData.get();
    const by = forChapter(data, this.moduleId, this.book, this.chapter);
    for (const row of this.rows()) {
      const body = row.querySelector<HTMLElement>(".booker-bible-vtext");
      if (!body) continue;
      unwrapMarks(body, "mark[data-hl]");
      const marks: BibleHighlight[] = by.get(Number(row.dataset.v)) ?? [];
      let at = 0;
      const wraps: Wrap[] = [];
      for (const piece of splitVerse(body.textContent ?? "", marks)) {
        if (piece.mark) wraps.push({ start: at, end: at + piece.text.length, cls: `booker-hl-${piece.mark.color}`, data: { hl: piece.mark.id } });
        at += piece.text.length;
      }
      wrapRanges(body, wraps);
    }
  }

  // ------------------------------------------------------------ search on this page

  highlight(terms: string[], mode: SearchMode): number {
    this.clearHighlight();
    let n = 0;
    let first: HTMLElement | null = null;
    for (const body of Array.from(this.text.querySelectorAll<HTMLElement>(".booker-bible-vtext"))) {
      const found = findRanges(body.textContent ?? "", terms, mode);
      const marks = wrapRanges(body, found.map(([start, end]) => ({ start, end, cls: "booker-find" })));
      if (marks.length && !first) first = marks[0];
      n += marks.length;
    }
    first?.scrollIntoView({ block: "center" });
    return n;
  }

  clearHighlight() {
    for (const body of Array.from(this.text?.querySelectorAll<HTMLElement>(".booker-bible-vtext") ?? [])) unwrapMarks(body, "mark.booker-find");
  }

  destroy() {
    this.select?.destroy();
    this.offHl?.();
  }
}
