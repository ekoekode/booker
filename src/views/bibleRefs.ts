import { ItemView, Menu, Notice, setIcon, WorkspaceLeaf } from "obsidian";
import { CopySettingsModal, currentDefault } from "./copySettingsModal";
import type { CopySettings } from "../reader/copySettings";
import { quickScripture } from "../scripture/quick";
import { linkify } from "../linkify";
import { renderInline } from "./inlineMarkup";
import type BookerPlugin from "../main";
import { BOOK_BY_OSIS } from "../scripture/books";
import { footnoteFor } from "../reader/quote";
import { wireQuoteUnits, type QuoteUnit } from "./reader/quoteUnits";
import { makePane } from "./reader/makePane";
import type { Pane, PaneCtx } from "./reader/types";
import type { Place } from "../reader/place";
import { markQuoted } from "./reader/quotedMarks";
import type { BarButton } from "./reader/selectionBar";
import { quotesOfNote, type QuoteRecord } from "../library/quoted";
import { placeFromState } from "../reader/place";
import { lastVerse, verseSpan, type Selection } from "../scripture/selection";

export const VIEW_BIBLE_REFS = "booker-bible-refs";

const SNIPPET = 320;
const createDiv = (o: { cls: string; text: string }) => activeDocument.createDiv(o);
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

const HINT = "Click a verse in the Bible reader to see the commentaries linked to it.";

/** One hit from a search of the documents: shown as a card that opens the document at that place. */
export function docHitCard(plugin: BookerPlugin, into: HTMLElement, h: { source: { title: string }; chunk: { loc: string }; snippet: string; chunkNo: number }) {
  const r = into.createDiv({ cls: "booker-bible-hit" });
  renderInline(r.createEl("div", { cls: "booker-bible-hit-title" }), `${h.source.title} — ${h.chunk.loc}`);
  renderInline(r.createEl("div", { cls: "booker-muted" }), h.snippet);
  r.addEventListener("click", () => void plugin.openHit(h as any));
}

/**
 * References for the verse selected in the Bible reader, in a tab of their own: every commentary module in the Bibles
 * folder, and a search of your documents for that reference. It follows the reader until you pin it.
 */
export class BibleRefsView extends ItemView {
  private sel: Selection | null = null;
  private pinned = false;
  private body!: HTMLElement;
  private pinBtn!: HTMLElement;
  private token = 0;
  private off: (() => void) | null = null;
  /** copy settings chosen for this window only */
  private copyOverride: CopySettings | null = null;
  private quoting: { reset(): void; destroy(): void } | null = null;
  private noteData = new Map<HTMLElement, QuoteUnit>();
  /** what the window shows: "" all commentaries; c:path one commentary; b:path a Bible; w:db a library; d:uid a document */
  private source = "";
  /** the word shown in the Word study tab */
  private word: Extract<Place, { kind: "word" }> | null = null;
  private srcSel!: HTMLSelectElement;
  private embedded: Pane | null = null;
  private nav!: HTMLElement;

  constructor(leaf: WorkspaceLeaf, private plugin: BookerPlugin) {
    super(leaf);
  }

  getViewType() {
    return VIEW_BIBLE_REFS;
  }
  getDisplayText() {
    return "Bible references";
  }
  getIcon() {
    return "book-open-text";
  }

  getState() {
    return { book: this.sel?.book, chapter: this.sel?.chapter, verse: this.sel?.verse, verseTo: this.sel?.verseTo, pinned: this.pinned, source: this.source, ...(this.word && { word: this.word }) };
  }
  async setState(state: any, result: any) {
    await super.setState(state, result);
    this.pinned = !!state?.pinned;
    // only a Bible, a commentary or a word study can follow the reader
    this.source = typeof state?.source === "string" && /^(?:[bc]:.|ws$)/.test(state.source) ? state.source : "";
    const w = state?.word ? placeFromState({ place: state.word }) : null;
    if (w?.kind === "word") this.word = w;
    if (state?.book && BOOK_BY_OSIS.has(state.book) && state.chapter) {
      this.sel = { book: state.book, chapter: state.chapter, verse: state.verse ?? 0, ...(state.verseTo > (state.verse ?? 0) && { verseTo: state.verseTo }) };
    }
    if (this.body) {
      this.drawPin();
      void this.drawSources();
      void this.render();
    }
  }

  async onOpen() {
    const root = this.contentEl;
    root.empty();
    root.addClass("booker-refs");
    const bar = root.createDiv({ cls: "booker-refs-bar" });
    this.srcSel = bar.createEl("select", { cls: "dropdown booker-refs-source", attr: { "aria-label": "What this window shows" } });
    this.srcSel.addEventListener("change", () => {
      this.source = this.srcSel.value;
      this.app.workspace.requestSaveLayout();
      void this.render();
    });
    void this.drawSources();
    const more = bar.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "More" } });
    setIcon(more, "more-horizontal");
    more.addEventListener("click", (e) => {
      const menu = new Menu();
      menu.addItem((i) => i.setTitle("Copy settings…").setIcon("copy").onClick(() => new CopySettingsModal(this.plugin, this.copyOverride ?? currentDefault(this.plugin), (s) => (this.copyOverride = s)).open()));
      menu.addItem((i) => i.setTitle("Show what my notes quote").setIcon("quote").setChecked(this.plugin.settings.showQuoted).onClick(() => void this.plugin.toggleQuoted()));
      menu.addItem((i) => i.setTitle("Bookmarks").setIcon("bookmark").onClick(() => void this.plugin.openView("booker-bucket")));
      menu.showAtMouseEvent(e);
    });
    this.pinBtn = bar.createEl("button", { cls: "clickable-icon" });
    this.pinBtn.addEventListener("click", () => {
      this.pinned = !this.pinned;
      this.drawPin();
      // Unpinning catches up with wherever the reader is now.
      if (!this.pinned) this.follow(this.plugin.selection.get());
      this.app.workspace.requestSaveLayout();
    });
    this.body = root.createDiv({ cls: "booker-refs-body" });
    this.quoting = wireQuoteUnits(this.plugin, this.body, ".booker-bible-note", (el) => this.noteData.get(el) ?? null, () => this.copyOverride ?? currentDefault(this.plugin));
    this.drawPin();
    this.off = this.plugin.selection.subscribe((s) => this.follow(s));
    // A tab opened from a restored layout has its own saved place; a fresh one starts at the reader's.
    if (!this.sel) this.sel = this.plugin.selection.get();
    await this.render();
  }

  async onClose() {
    this.token++;
    this.embedded?.destroy();
    this.quoting?.destroy();
    this.off?.();
    this.off = null;
  }

  private follow(s: Selection | null) {
    if (this.pinned || !s) return;
    this.sel = { ...s };
    this.app.workspace.requestSaveLayout();
    if (this.source === "ws") return;
    const e = this.embedded?.place();
    // a Bible shown here turns to the chapter and verse of the one being read
    if (this.source.startsWith("b:") && e?.kind === "bible" && this.embedded?.moveTo?.({ kind: "bible", module: e.module, book: s.book, chapter: s.chapter, verse: s.verse, ...(s.verseTo && { verseTo: s.verseTo }) })) return void this.drawNav();
    void this.render();
  }

  /** The choices for what this window shows: every Bible, commentary, library and document. */
  private async drawSources() {
    const p = this.plugin;
    const bibles = await Promise.all((await p.modules.bibles()).map(async (b): Promise<[string, string]> => [`b:${b.path}`, await p.modules.title(b)]));
    const comms = await Promise.all((await p.modules.commentaries()).map(async (c): Promise<[string, string]> => [`c:${c.path}`, await p.modules.title(c)]));
    const sel = this.srcSel;
    sel.empty();
    sel.createEl("option", { value: "", text: "All commentaries" });
    for (const [label, items] of [["Bibles", bibles], ["Commentaries", comms]] as const) {
      if (!items.length) continue;
      const g = sel.createEl("optgroup", { attr: { label } });
      for (const [value, text] of items) g.createEl("option", { value, text });
    }
    sel.createEl("option", { value: "ws", text: "Word study" });
    sel.value = this.source;
    if (sel.value !== this.source) sel.value = "";
  }

  /** Show the commentaries for a verse (or a run of verses), whatever this window was showing. */
  showCommentary(sel: Selection) {
    this.sel = { ...sel };
    this.source = "";
    this.app.workspace.requestSaveLayout();
    if (this.body) {
      void this.drawSources();
      void this.render();
    }
  }

  /** Open a word in this window's Word study tab. */
  showWord(w: Extract<Place, { kind: "word" }>) {
    this.word = w;
    this.source = "ws";
    this.app.workspace.requestSaveLayout();
    if (this.body) void this.render();
  }

  /** A Bible, library or document drawn with the same panes the Reader uses; a Bible keeps to the chapter being read. */
  private async renderEmbedded(my: number) {
    this.embedded?.destroy();
    this.embedded = null;
    this.nav = this.body.createDiv({ cls: "booker-refs-nav" });
    const host = this.body.createDiv({ cls: "booker-refs-embed" });
    const reader = this.plugin.selection.get();
    const s = this.sel ?? reader;
    let place: Place;
    if (this.source === "ws") {
      if (!this.word) {
        this.nav.remove();
        host.createEl("p", { cls: "booker-muted", text: "Turn on Word study for a verse in the Reader and click a word to study it here." });
        return;
      }
      place = this.word;
    } else if (this.source.startsWith("b:")) place = { kind: "bible", module: this.source.slice(2), book: s?.book ?? "John", chapter: s?.chapter ?? 1, verse: s?.verse ?? 0, ...(s?.verseTo && { verseTo: s.verseTo }) };
    else if (this.source.startsWith("w:")) place = { kind: "works", db: this.source.slice(2) };
    else place = { kind: "work", uid: this.source.slice(2), entry: 0 };
    const make = async (p: Place) => {
      if (this.embedded?.moveTo?.(p)) return this.drawNav();
      this.embedded?.destroy();
      host.empty();
      const ctx: PaneCtx = {
        plugin: this.plugin,
        app: this.app,
        host,
        render: this,
        silent: true,
        go: (q, o) => {
          if (o?.replace) return;
          if (q.kind === "word") this.word = q;
          void make(q);
        },
        openWord: (q) => this.showWord(q),
        changed: () => this.drawNav(),
        copy: () => this.copyOverride ?? currentDefault(this.plugin),
      };
      const pane = makePane(p, ctx);
      this.embedded = pane;
      this.drawNav();
      await pane.load();
      this.drawNav();
    };
    await make(place);
    if (my !== this.token) return;
  }

  private drawNav() {
    const pane = this.embedded;
    if (!this.nav || !pane) return;
    this.nav.empty();
    // a word has nothing to step through, so it gets no bar
    this.nav.toggle(pane.place().kind !== "word");
    if (pane.place().kind === "word") return;
    const btn = (icon: string, tip: string, on: () => void, enabled: boolean) => {
      const b = this.nav.createEl("button", { cls: "clickable-icon", attr: { "aria-label": tip } });
      setIcon(b, icon);
      b.disabled = !enabled;
      b.addEventListener("click", on);
    };
    for (const c of pane.crumbs()) if (c.go) {
      const go = c.go;
      const a = this.nav.createEl("a", { text: c.text, cls: "booker-muted" });
      a.addEventListener("click", () => pane.moveTo?.(go) || void this.openEmbeddedPlace(go));
    }
    btn("chevron-left", "Previous", () => pane.prev(), pane.canPrev());
    const where = this.nav.createEl("button", { cls: "booker-refs-navlabel booker-refs-where", text: [pane.source(), pane.placeLabel()].filter(Boolean).join(" · ") });
    if (pane.picker) where.addEventListener("click", () => this.togglePicker(pane));
    btn("chevron-right", "Next", () => pane.next(), pane.canNext());
  }

  private pickerBox: HTMLElement | null = null;

  /** The book and chapter picker the Reader has, opened under the navigation bar. */
  private togglePicker(pane: Pane) {
    if (this.pickerBox?.isConnected) return this.closePicker();
    const box = document.createElement("div");
    box.className = "booker-refs-picker";
    this.nav.after(box);
    this.pickerBox = box;
    pane.picker!(box, () => this.closePicker());
  }

  private closePicker() {
    this.pickerBox?.remove();
    this.pickerBox = null;
  }

  private async openEmbeddedPlace(p: Place) {
    this.source = p.kind === "works" ? `w:${p.db}` : this.source;
    await this.render();
  }

  refreshQuoted() {
    void this.render();
  }

  private drawPin() {
    this.pinBtn.empty();
    setIcon(this.pinBtn, this.pinned ? "pin" : "pin-off");
    this.pinBtn.setAttr("aria-label", this.pinned ? "Pinned: not following the reader. Press to follow again" : "Following the reader. Press to keep this verse");
    this.pinBtn.toggleClass("is-active", this.pinned);
  }

  /** Commentaries for the selected verse: each module's notes, and a search of the documents for the reference. */
  private async render() {
    const my = ++this.token;
    const s = this.sel;
    this.quoting?.reset();
    this.noteData.clear();
    this.embedded?.destroy();
    this.embedded = null;
    this.body.empty();
    this.srcSel && (this.srcSel.value = this.source);
    if (/^(?:[bwd]:|ws$)/.test(this.source)) return this.renderEmbedded(my);
    if (!s) {
      this.body.createEl("p", { cls: "booker-muted", text: HINT });
      return;
    }
    const name = BOOK_BY_OSIS.get(s.book)?.name ?? s.book;
    // with no verse picked the whole chapter's notes are shown, so the window still follows the chapter being read
    const ref = s.verse ? `${name} ${s.chapter}:${verseSpan(s)}` : `${name} ${s.chapter}`;
    const head = this.body.createDiv({ cls: "booker-bible-side-head" });
    head.createEl("strong", { text: ref });
    const tools = head.createDiv({ cls: "booker-bible-side-tools" });
    const tool = (icon: string, label: string, tip: string, run: () => void) => {
      const b = tools.createEl("button", { cls: "booker-ref-btn", attr: { "aria-label": tip, title: tip } });
      setIcon(b.createSpan(), icon);
      b.createSpan({ cls: "booker-ref-btn-text", text: label });
      b.addEventListener("click", run);
    };
    if (s.verse) tool("text-quote", "Insert", "Write this verse into the open note", () => void this.plugin.insertVerseIntoNote(ref));
    if (s.verse) tool("superscript", "With footnote", "Write this verse with a footnote naming the Bible", () => void this.plugin.insertVerseIntoNote(ref, true));
    tool("bookmark", "Bookmark", s.verse ? "Add this verse to your bookmarks" : "Add this chapter to your bookmarks", async () => {
      const text = ((await quickScripture(this.plugin, ref)) ?? "").replace(/^>\s?/gm, "").trim();
      const r = await this.plugin.stores.addToBucket({ text: text || ref, citation: ref, archiveSource: "", book: name, chapter: String(s.chapter), kind: "verse", fileKind: "bible", place: JSON.stringify({ kind: "bible", module: "", book: s.book, chapter: s.chapter, verse: s.verse, ...(s.verseTo && s.verseTo > s.verse && { verseTo: s.verseTo }) }) });
      new Notice(r.added ? "Booker: added to bookmarks." : "Booker: already in your bookmarks.");
    });
    const wrap = this.body.createDiv();
    const quoted = await this.plugin.quoted.records();
    const files = (await this.plugin.modules.commentaries()).filter((f) => !this.source.startsWith("c:") || f.path === this.source.slice(2));
    if (my !== this.token) return;
    if (!files.length) wrap.createEl("p", { cls: "booker-muted", text: `No commentary modules found in “${this.plugin.scriptureData().folder}”. Commentaries (.cmtx, .cmt.mybible) listed there appear here.` });
    for (const f of files) {
      if (my !== this.token) return;
      const title = await this.plugin.modules.title(f);
      const sec = wrap.createDiv({ cls: "booker-bible-comm" });
      sec.createEl("h4", { text: title });
      try {
        const c = await this.plugin.modules.loadCommentary(f);
        if (my !== this.token) return;
        // each note once, with the first verse it was found for
        const seen = new Map<string, { v: number; ref: string }>();
        if (s.verse) {
          for (const v of range(s.verse, lastVerse(s))) for (const n of c.at(s.book, s.chapter, v)) if (!seen.has(n)) seen.set(n, { v, ref });
        } else if (c.books().includes(s.book)) {
          for (const r of c.chapterRows(s.book, s.chapter)) if (!seen.has(r.text)) seen.set(r.text, { v: r.from || 1, ref: `${name} ${s.chapter}${r.from ? `:${r.to > r.from ? `${r.from}-${r.to}` : r.from}` : ""}` });
        }
        if (!seen.size) sec.createEl("p", { cls: "booker-muted", text: s.verse ? "Nothing on this verse." : "Nothing on this chapter." });
        for (const [n, w] of seen) this.note(sec, n, w.ref, title, { path: f.path, v: w.v }, quoted);
        if (seen.size) sec.querySelector("h4")!.appendText(` (${seen.size})`);
      } catch (e) {
        sec.createEl("p", { cls: "booker-muted", text: `Could not read this commentary. ${e instanceof Error ? e.message : e}` });
      }
    }
  }

  /** One note from a commentary: its first line is who and where, the rest is the text. What can be done with it is in the popup that opens when it is clicked. */
  private note(into: HTMLElement, raw: string, ref: string, commentary: string, at: { path: string; v: number }, quoted: QuoteRecord[]) {
    const [who, ...rest] = raw.split("\n\n");
    const body = rest.join("\n\n");
    const card = into.createDiv({ cls: "booker-bible-note" });
    const t = (body || who).trim();
    const s = this.sel!;
    const bookName = BOOK_BY_OSIS.get(s.book)?.name ?? "";
    const p = card.createEl("div", { cls: "booker-bible-note-text", text: t.length > SNIPPET ? `${t.slice(0, SNIPPET).trimEnd()}…` : t });
    if (body) card.insertBefore(card.createDiv({ cls: "booker-bible-note-who", text: who }), p);
    linkify(p, this.plugin, { citations: false });
    let open = false;
    const extras = (): BarButton[] => [
      ...(t.length > SNIPPET
        ? [{
            label: open ? "Show less" : "Read more",
            icon: open ? "chevron-up" : "chevron-down",
            run: () => {
              open = !open;
              p.setText(open ? t : `${t.slice(0, SNIPPET).trimEnd()}…`);
              linkify(p, this.plugin, { citations: false });
            },
          }]
        : []),
      { label: "Open commentary", icon: "book-open-text", tip: "Read this commentary as a book, at the verse this note starts on", run: () => void this.plugin.openLibrary(undefined, { path: at.path, book: s.book, chapter: s.chapter, verse: at.v }) },
    ];
    this.noteData.set(card, {
      text: t,
      footnote: footnoteFor([body ? who : "", commentary && `in ${commentary}`].filter(Boolean).join(", "), `on ${ref}`),
      citation: `on ${ref}`,
      source: commentary,
      book: bookName,
      chapter: String(s.chapter),
      place: { kind: "commentary", path: at.path, book: s.book, chapter: s.chapter, verse: at.v },
      extras,
    });
    markQuoted(this.plugin, card, quotesOfNote(quoted, commentary, s.book, s.chapter, at.v));
  }
}
