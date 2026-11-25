import { Component, ItemView, Menu, setIcon, WorkspaceLeaf } from "obsidian";
import type BookerPlugin from "../../main";
import { History, placeFromState, samePlace, type Place } from "../../reader/place";
import { suggest, type Suggestion } from "../../reader/suggest";
import { BOOKS } from "../../scripture/books";
import { interpret, opensByItself } from "../../scripture/omnibox";
import { makePane } from "./makePane";
import { drawResults } from "./resultsPane";
import { drawSavedSearches, SaveSearchModal } from "./savedSearchUi";
import { CopySettingsModal, currentDefault } from "../copySettingsModal";
import type { CopySettings } from "../../reader/copySettings";
import { highlightTerms, MODES, SCOPES, type Scope, type SearchMode } from "../../reader/searchOptions";
import { COMMENTARIES } from "./shelfPane";
import type { Pane, PaneCtx } from "./types";
import { databaseOf, databases } from "../../sources/catalog";

export const VIEW_BIBLE = "booker-bible";

const SCALES = [0.85, 0.92, 1, 1.1, 1.22, 1.38];
const CANON = BOOKS.filter((b) => !b.extra).map((b) => b.osis);

/**
 * One reader for the Bible, commentaries and the whole library. A bar across the top says where you are (Source and
 * Place), steps through it, and holds the one box that goes to a passage, opens a work or searches; below it a pane
 * draws whatever the place is. The reader keeps its own history, so Back returns from a commentary to the verse.
 */
export class ReaderView extends ItemView {
  private history = new History();
  private pane: Pane | null = null;
  private token = 0;
  private searchToken = 0;
  private render = new Component();
  private pending: Place | null = null;
  private lastBible: Place = { kind: "bible", module: "", book: "John", chapter: 1, verse: 0 };
  private books: string[] = CANON;
  private bibles: Array<{ path: string; name: string }> = [];
  private commentaries: Array<{ path: string; name: string }> = [];

  private root!: HTMLElement;
  private back!: HTMLButtonElement;
  private fwd!: HTMLButtonElement;
  private sourceBtn!: HTMLButtonElement;
  private placeBtn!: HTMLButtonElement;
  private prevBtn!: HTMLButtonElement;
  private nextBtn!: HTMLButtonElement;
  private refsBtn!: HTMLElement;
  private box!: HTMLInputElement;
  private scopeSel!: HTMLSelectElement;
  private modeSel!: HTMLSelectElement;
  private status!: HTMLElement;
  private sugg!: HTMLElement;
  private crumbsEl!: HTMLElement;
  private paneHost!: HTMLElement;
  private resultsHost!: HTMLElement;
  private pop: { el: HTMLElement; off: () => void } | null = null;
  private suggestions: Suggestion[] = [];
  private picked = 0;
  private timer = 0;

  constructor(leaf: WorkspaceLeaf, private plugin: BookerPlugin) {
    super(leaf);
  }

  getViewType() {
    return VIEW_BIBLE;
  }
  getDisplayText() {
    return "Reader";
  }
  getIcon() {
    return "book-open";
  }

  getState() {
    return { place: this.pane?.place() ?? this.history.current ?? this.pending ?? { kind: "shelf" } };
  }

  async setState(state: any, result: any) {
    await super.setState(state, result);
    const place = placeFromState(state);
    if (!this.paneHost) {
      this.pending = place;
      return;
    }
    if (this.pane && samePlace(this.pane.place(), place)) return;
    this.history.push(place);
    await this.show(place);
  }

  // ------------------------------------------------------------ layout

  async onOpen() {
    this.render.load();
    const root = (this.root = this.contentEl);
    root.empty();
    root.addClass("booker-reader");
    this.applyScale();
    const bar = root.createDiv({ cls: "booker-reader-bar" });
    const icon = (parent: HTMLElement, name: string, tip: string, run: (e: MouseEvent) => void, label = "") => {
      const b = parent.createEl("button", { cls: "clickable-icon booker-reader-btn", attr: { "aria-label": tip } });
      setIcon(b.createSpan(), name);
      if (label) b.createSpan({ text: label, cls: "booker-reader-btn-text" });
      b.addEventListener("click", run);
      return b;
    };
    this.sourceBtn = icon(bar, "library", "Choose what to read: a Bible, a commentary or a library", () => this.sourcePop(), "Libraries");
    this.sourceBtn.addClass("booker-reader-source");
    const where = bar.createDiv({ cls: "booker-reader-group" });
    this.prevBtn = icon(where, "chevron-left", "Previous", () => this.pane?.prev());
    this.placeBtn = icon(where, "chevrons-up-down", "Choose where to read", () => this.placePop(), "");
    this.placeBtn.addClass("booker-reader-place");
    this.nextBtn = icon(where, "chevron-right", "Next", () => this.pane?.next());
    const right = bar.createDiv({ cls: "booker-reader-group booker-reader-right" });
    this.refsBtn = icon(right, "panel-right-open", "Open the references tab beside this reader (the side is chosen in the tab's ⋯ menu)", () => void this.plugin.openRefs(this.leaf, this.plugin.scriptureData().refsSide === "left"));

    const row = root.createDiv({ cls: "booker-reader-boxrow" });
    const hist = row.createDiv({ cls: "booker-reader-group" });
    this.back = icon(hist, "arrow-left", "Back", () => this.stepHistory(-1));
    this.fwd = icon(hist, "arrow-right", "Forward", () => this.stepHistory(1));
    const boxWrap = row.createDiv({ cls: "booker-reader-boxwrap" });
    setIcon(boxWrap.createSpan({ cls: "booker-reader-boxicon" }), "search");
    this.box = boxWrap.createEl("input", { type: "text", cls: "booker-reader-box", attr: { placeholder: "Go to a verse or book, open a work, or search…", "aria-label": "Go to a passage, open a work or search" } });
    const pick = (icon: string, tip: string) => {
      const w = boxWrap.createDiv({ cls: "booker-reader-pick", attr: { title: tip } });
      setIcon(w.createSpan({ cls: "booker-reader-pickicon" }), icon);
      setIcon(w.createSpan({ cls: "booker-reader-pickarrow" }), "chevron-down");
      return w;
    };
    this.scopeSel = pick("layers", "Where to search").createEl("select", { cls: "booker-reader-scope dropdown", attr: { "aria-label": "Search in" } });
    for (const x of SCOPES) this.scopeSel.createEl("option", { value: x.id, text: x.label });
    this.scopeSel.value = "work";
    this.modeSel = pick("wand", "How to match").createEl("select", { cls: "booker-reader-scope dropdown", attr: { "aria-label": "How to match" } });
    for (const x of MODES) {
      const o = this.modeSel.createEl("option", { value: x.id, text: x.label });
      if (x.id === "semantic") {
        o.disabled = true;
        o.text = "Semantic (no model)";
        void this.plugin.semanticIndex.available().then((ok) => {
          o.disabled = !ok;
          o.text = ok ? "Semantic (meaning)" : o.text;
        });
      }
    }
    for (const [s, what] of [[this.scopeSel, "Where to search"], [this.modeSel, "How to match"]] as const) {
      const tip = () => (s.parentElement!.title = `${what}: ${s.selectedOptions[0]?.text ?? ""}`);
      s.addEventListener("change", tip);
      window.setTimeout(tip, 0);
    }
    const saved = boxWrap.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "Saved searches" } });
    setIcon(saved, "bookmark");
    saved.addEventListener("click", () => this.savedPop(saved));
    this.sugg = row.createDiv({ cls: "booker-reader-suggest" });
    this.sugg.hide();
    this.box.addEventListener("input", () => this.typing());
    this.box.addEventListener("keydown", (e) => this.boxKey(e));
    this.box.addEventListener("blur", () => window.setTimeout(() => this.sugg.hide(), 150));
    this.box.addEventListener("focus", () => this.typing());

    this.status = root.createDiv({ cls: "booker-reader-status booker-muted" });
    this.status.hide();
    this.crumbsEl = root.createDiv({ cls: "booker-reader-crumbs" });
    const main = root.createDiv({ cls: "booker-reader-main" });
    this.paneHost = main.createDiv({ cls: "booker-reader-pane" });
    this.resultsHost = main.createDiv({ cls: "booker-reader-pane booker-reader-results" });
    this.resultsHost.hide();
    new ResizeObserver(() => root.toggleClass("is-narrow", root.clientWidth < 640)).observe(root);
    this.registerDomEvent(document, "pointerdown", (e) => this.pop && !this.pop.el.contains(e.target as Node) && !(e.target as HTMLElement).closest(".booker-reader-bar") && this.closePop());

    void this.loadLists();
    const first = this.pending ?? this.history.current ?? placeFromState({});
    this.pending = null;
    this.history.push(first);
    await this.show(first);
  }

  async onClose() {
    this.token++;
    this.searchToken++;
    this.closePop();
    this.pane?.destroy();
    this.render.unload();
  }

  private async loadLists() {
    const m = this.plugin.modules;
    this.bibles = await Promise.all((await m.bibles()).map(async (f) => ({ path: f.path, name: await m.title(f) })));
    this.commentaries = await Promise.all((await m.commentaries()).map(async (f) => ({ path: f.path, name: await m.title(f) })));
  }

  // ------------------------------------------------------------ places

  private ctx(): PaneCtx {
    return {
      plugin: this.plugin,
      app: this.app,
      host: this.paneHost,
      render: this.render,
      go: (p, o) => this.go(p, o),
      openWord: (w) => void this.plugin.openWordStudy(w, this.leaf),
      changed: () => this.changed(),
      copy: () => this.copyOverride ?? currentDefault(this.plugin),
    };
  }

  /** Draw the page again, so the marks for what your notes quote come or go. */
  refreshQuoted() {
    const p = this.pane?.place();
    if (p) void this.show(p);
  }

  /** Go to a place: a step in the history, or (replace) only note where the pane now is. */
  go(place: Place, opts: { replace?: boolean } = {}) {
    if (opts.replace) {
      this.history.replace(place);
      this.app.workspace.requestSaveLayout();
      this.drawBar();
      return;
    }
    this.history.push(place);
    void this.show(place);
  }

  private stepHistory(by: number) {
    const p = by < 0 ? this.history.back() : this.history.forward();
    if (p) void this.show(p);
  }

  /** Show a place without touching the history: in the pane that is open if it can, else in a new one. */
  private async show(place: Place) {
    this.hideResults();
    this.closePop();
    if (this.pane?.moveTo?.(place)) {
      this.history.replace(this.pane.place());
      this.changed();
      this.app.workspace.requestSaveLayout();
      return;
    }
    const my = ++this.token;
    this.pane?.destroy();
    const ctx = this.ctx();
    this.paneHost.empty();
    const pane = makePane(place, ctx);
    this.pane = pane;
    this.drawBar();
    await pane.load();
    if (my !== this.token) return;
    this.history.replace(pane.place());
    this.changed();
    this.app.workspace.requestSaveLayout();
  }

  /** The pane moved: redraw what the bar says. */
  private changed() {
    const p = this.pane?.place();
    if (p?.kind === "bible") this.lastBible = p;
    this.drawBar();
  }

  private drawBar() {
    const pane = this.pane;
    this.back.disabled = !this.history.canBack;
    this.fwd.disabled = !this.history.canForward;
    if (!pane) return;
    const p = pane.place();
    this.sourceBtn.querySelector(".booker-reader-btn-text")?.setText(pane.source());
    const label = pane.placeLabel();
    this.placeBtn.toggle(label !== null);
    this.prevBtn.toggle(label !== null);
    this.nextBtn.toggle(label !== null);
    this.placeBtn.querySelector(".booker-reader-btn-text")?.remove();
    if (label !== null) this.placeBtn.createSpan({ text: label, cls: "booker-reader-btn-text" });
    this.prevBtn.disabled = !pane.canPrev();
    this.nextBtn.disabled = !pane.canNext();
    this.refsBtn.toggle(p.kind === "bible");
    const books = pane.books?.();
    if (books?.length) this.books = books;
    this.crumbsEl.empty();
    const crumbs = pane.crumbs();
    this.crumbsEl.toggle(crumbs.length > 1);
    crumbs.forEach((c, i) => {
      if (i) this.crumbsEl.createSpan({ cls: "booker-muted", text: "›" });
      if (c.go) {
        const go = c.go;
        this.crumbsEl.createEl("a", { text: c.text }).addEventListener("click", () => this.go(go));
      } else this.crumbsEl.createSpan({ text: c.text, cls: "booker-reader-here" });
    });
  }

  // ------------------------------------------------------------ popovers, drawer, menus

  private closePop() {
    this.pop?.off();
    this.pop?.el.remove();
    this.pop = null;
  }

  private popOver(anchor: HTMLElement, cls: string, fill: (el: HTMLElement) => void) {
    if (this.pop) {
      const same = this.pop.el.hasClass(cls);
      this.closePop();
      if (same) return;
    }
    const el = this.root.createDiv({ cls: `booker-reader-pop ${cls}` });
    fill(el);
    const r = this.root.getBoundingClientRect();
    const a = anchor.getBoundingClientRect();
    el.style.top = `${a.bottom - r.top + 4}px`;
    el.style.left = `${Math.max(8, Math.min(a.left - r.left, r.width - el.offsetWidth - 8))}px`;
    const key = (e: KeyboardEvent) => e.key === "Escape" && this.closePop();
    document.addEventListener("keydown", key);
    this.pop = { el, off: () => document.removeEventListener("keydown", key) };
  }

  private placePop() {
    const pane = this.pane;
    if (!pane?.picker) return;
    this.popOver(this.placeBtn, "booker-reader-pop-place", (el) => pane.picker!(el, () => this.closePop()));
  }

  private sourcePop() {
    this.popOver(this.sourceBtn, "booker-reader-pop-source", (el) => {
      const row = (text: string, note: string, current: boolean, run: () => void) => {
        const r = el.createDiv({ cls: "booker-reader-pop-row" + (current ? " is-current" : "") });
        r.createSpan({ text });
        if (note) r.createSpan({ cls: "booker-muted", text: note });
        r.addEventListener("click", () => {
          this.closePop();
          run();
        });
      };
      const cur = this.pane?.place();
      const head = (t: string) => el.createDiv({ cls: "booker-reader-picker-head", text: t });
      row("All libraries", "", cur?.kind === "shelf", () => this.go({ kind: "shelf" }));
      if (this.bibles.length) head("Bibles");
      for (const b of this.bibles) row(b.name, "", cur?.kind === "bible" && cur.module === b.path, () => this.go({ ...this.lastBible, kind: "bible", module: b.path, verse: 0 } as Place));
      if (this.commentaries.length) head("Commentaries");
      for (const c of this.commentaries) row(c.name, "", cur?.kind === "commentary" && cur.path === c.path, () => this.go({ kind: "commentary", path: c.path, ...(this.lastBible.kind === "bible" && { book: this.lastBible.book, chapter: this.lastBible.chapter, verse: this.lastBible.verse, ...(this.lastBible.verseTo && { verseTo: this.lastBible.verseTo }) }) }));
      const dbs = databases(this.plugin.sources());
      if (dbs.length) head("Libraries");
      for (const d of dbs) row(d.label, d.note, (cur?.kind === "works" && cur.db === d.id) || (cur?.kind === "work" && this.plugin.sources().some((s) => s.uid === cur.uid && databaseOf(s) === d.id)), () => this.go({ kind: "works", db: d.id }));
      if (this.commentaries.length) row("Browse commentaries", "", cur?.kind === "works" && cur.db === COMMENTARIES, () => this.go({ kind: "works", db: COMMENTARIES }));
    });
  }

  /** the reader's menu is the tab's ⋯ menu */
  onPaneMenu(menu: Menu, source: string) {
    super.onPaneMenu(menu, source);
    menu.addSeparator();
    this.moreMenu(menu);
    if (this.pane?.place().kind === "bible") {
      menu.addSeparator();
      this.refsSideMenu(menu);
    }
  }

  private refsSideMenu(menu: Menu) {
    for (const [id, label] of [["right", "Open references on the right"], ["left", "Open references on the left"]] as const) {
      menu.addItem((i) =>
        i.setTitle(label).setChecked((this.plugin.scriptureData().refsSide ?? "right") === id).onClick(async () => {
          await this.plugin.saveScripture({ ...this.plugin.scriptureData(), refsSide: id });
          await this.plugin.openRefs(this.leaf, id === "left", true);
        })
      );
    }
  }

  private scaleIndex() {
    const s = this.plugin.scriptureData().readerSize ?? 1;
    return Math.max(0, SCALES.findIndex((x) => x >= s - 0.001));
  }

  private applyScale() {
    this.root?.style.setProperty("--booker-reader-scale", String(SCALES[this.scaleIndex()]));
  }

  private async setScale(i: number) {
    const size = SCALES[Math.min(SCALES.length - 1, Math.max(0, i))];
    await this.plugin.saveScripture({ ...this.plugin.scriptureData(), readerSize: size });
    this.applyScale();
  }

  /** copy settings chosen for this window only; gone when it closes */
  private copyOverride: CopySettings | null = null;

  private moreMenu(menu: Menu) {
    menu.addItem((i) => i.setTitle("Copy settings…").setIcon("copy").onClick(() => new CopySettingsModal(this.plugin, this.copyOverride ?? currentDefault(this.plugin), (s) => (this.copyOverride = s)).open()));
    menu.addItem((i) => i.setTitle("Larger text").setIcon("a-large-small").onClick(() => void this.setScale(this.scaleIndex() + 1)));
    menu.addItem((i) => i.setTitle("Smaller text").setIcon("a-large-small").onClick(() => void this.setScale(this.scaleIndex() - 1)));
    menu.addItem((i) => i.setTitle("Normal text size").onClick(() => void this.setScale(2)));
    menu.addSeparator();
    menu.addItem((i) => i.setTitle("Show what my notes quote").setIcon("quote").setChecked(this.plugin.settings.showQuoted).onClick(() => void this.plugin.toggleQuoted()));
    menu.addItem((i) => i.setTitle("Bookmarks").setIcon("bookmark").onClick(() => void this.plugin.openView("booker-bucket")));
    menu.addItem((i) => i.setTitle("Open a document…").setIcon("file-text").onClick(() => void this.plugin.pickSource((s) => void this.plugin.openSource(s))));
    menu.addItem((i) => i.setTitle("Add a Bible module…").setIcon("book-plus").onClick(() => void this.plugin.addBibleModules()));
  }

  // ------------------------------------------------------------ the one box

  private typing() {
    window.clearTimeout(this.timer);
    const text = this.box.value;
    this.suggestions = suggest(text, { books: this.books, sources: this.plugin.sources(), bibles: this.bibles, commentaries: this.commentaries });
    this.picked = 0;
    this.drawSuggestions();
    const t = interpret(text, this.books);
    if (opensByItself(t, text)) this.timer = window.setTimeout(() => this.choose(this.suggestions[0]), 700);
  }

  private drawSuggestions() {
    const s = this.sugg;
    s.empty();
    if (!this.suggestions.length) return s.hide();
    s.show();
    this.suggestions.forEach((x, i) => {
      const row = s.createDiv({ cls: "booker-reader-sugg" + (i === this.picked ? " is-picked" : "") });
      setIcon(row.createSpan({ cls: "booker-reader-sugg-icon" }), x.kind === "passage" || x.kind === "book" ? "book-open" : x.kind === "search" ? "search" : x.kind === "bible" ? "book-open" : "library");
      row.createSpan({ text: x.label, cls: "booker-reader-sugg-label" });
      if (x.kind === "open") row.createSpan({ cls: "booker-muted booker-reader-sugg-note", text: x.note });
      row.addEventListener("mousedown", (e) => {
        e.preventDefault();
        this.choose(x);
      });
    });
  }

  private boxKey(e: KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const n = this.suggestions.length;
      if (!n) return;
      this.picked = (this.picked + (e.key === "ArrowDown" ? 1 : n - 1)) % n;
      this.drawSuggestions();
    } else if (e.key === "Enter") {
      e.preventDefault();
      this.choose(this.suggestions[this.picked]);
    } else if (e.key === "Escape") {
      this.box.value = "";
      this.sugg.hide();
      this.box.blur();
    }
  }

  private choose(s: Suggestion | undefined) {
    window.clearTimeout(this.timer);
    if (!s) return;
    const b = this.lastBible.kind === "bible" ? this.lastBible : { module: "", book: "John", chapter: 1, verse: 0 };
    const inBible = this.pane?.place().kind === "bible" ? (this.pane.place() as Extract<Place, { kind: "bible" }>).module : b.module;
    if (s.kind === "search") {
      this.sugg.hide();
      return void this.search(s.text);
    }
    this.box.value = "";
    this.sugg.hide();
    if (s.kind === "passage") this.go({ kind: "bible", module: inBible, book: s.book, chapter: s.chapter, verse: s.verse });
    else if (s.kind === "book") this.go({ kind: "bible", module: inBible, book: s.book, chapter: 1, verse: 0 });
    else if (s.kind === "bible") this.go({ kind: "bible", module: s.path, book: b.book, chapter: b.chapter, verse: 0 });
    else this.go(s.place);
  }

  // ------------------------------------------------------------ search

  private hideResults() {
    this.searchToken++;
    this.resultsHost?.hide();
    this.paneHost?.show();
    this.status?.hide();
    this.pane?.clearHighlight?.();
  }

  /** Run a search from outside, as a saved search or a bookmark does. */
  runSearch(query: string, scope: string, mode: string) {
    this.scopeSel.value = scope;
    this.modeSel.value = mode;
    this.box.value = query;
    this.search(query);
  }

  private savedPop(anchor: HTMLElement) {
    this.popOver(anchor, "booker-reader-pop-saved", (el) =>
      drawSavedSearches(el, this.plugin, (x) => {
        this.closePop();
        this.scopeSel.value = x.scope;
        this.modeSel.value = x.mode;
        this.box.value = x.query;
        this.search(x.query);
      })
    );
  }

  private saveCurrent(text: string) {
    new SaveSearchModal(this.plugin, { query: text, scope: this.scopeSel.value as Scope, mode: this.modeSel.value as SearchMode }, () => undefined).open();
  }

  private search(text: string) {
    const my = ++this.searchToken;
    this.closePop();
    const scope = this.scopeSel.value as Scope;
    const mode = this.modeSel.value as SearchMode;
    if (scope === "page") {
      this.hideResults();
      const n = this.pane?.highlight?.(highlightTerms(text), mode === "semantic" ? "fuzzy" : mode) ?? 0;
      this.status.setText(n ? `${n} match${n === 1 ? "" : "es"} on this page` : "Nothing on this page.");
      this.status.show();
      return;
    }
    this.status.hide();
    this.paneHost.hide();
    this.resultsHost.show();
    void drawResults({
      plugin: this.plugin,
      host: this.resultsHost,
      query: text,
      scope,
      mode,
      place: this.pane?.place() ?? { kind: "shelf" },
      go: (p) => this.go(p),
      close: () => this.hideResults(),
      save: () => this.saveCurrent(text),
      alive: () => my === this.searchToken,
    });
  }
}
