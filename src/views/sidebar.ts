import { ItemView, WorkspaceLeaf, debounce, setIcon } from "obsidian";
import { drawCard, type Card } from "./cards";
import type BookerPlugin from "../main";
import { inLibrary } from "../library/paths";
import { InspectorPanel } from "./inspector";
import { SearchPanel } from "./searchPanel";
import { DictionaryPanel } from "./dictionaryPanel";
import { isLibTab, SidePanels, type LibTab } from "./side";

export const VIEW_SIDEBAR = "booker-sidebar";
/** Where a command asks the sidebar to go: each names the card to open. */
export type SidebarTab = "inspector" | "search" | "library" | "dictionary";
type CardKey = "search" | "info" | "library" | "importer" | "dictionary";
const CARD_OF: Record<SidebarTab, CardKey> = { inspector: "info", search: "search", library: "library", dictionary: "dictionary" };
const isTab = (t: unknown): t is SidebarTab => t === "inspector" || t === "search" || t === "library" || t === "dictionary";

/** What saved state asks for: which cards are open, which library tab, and a card to bring into view. Pure. Old saved workspaces say `tab`, and "documents" or "reference" meant the library. */
export function readSidebarState(state: any, current: { open: Record<CardKey, boolean>; libTab: LibTab }): { open: Record<CardKey, boolean>; libTab: LibTab; reveal: CardKey | null } {
  const open = { ...current.open, ...(state?.open && typeof state.open === "object" ? pickBooleans(state.open) : {}) };
  const tab = state?.tab === "documents" || state?.tab === "reference" ? "library" : state?.tab;
  let reveal: CardKey | null = null;
  if (isTab(tab)) {
    reveal = CARD_OF[tab];
    open[reveal] = true;
  }
  return { open, libTab: isLibTab(state?.libTab) ? state.libTab : current.libTab, reveal };
}

function pickBooleans(o: any): Partial<Record<CardKey, boolean>> {
  const out: Partial<Record<CardKey, boolean>> = {};
  for (const k of ["search", "info", "library", "importer", "dictionary"] as const) if (typeof o[k] === "boolean") out[k] = o[k];
  return out;
}

/** The one right-hand Booker panel: a stack of foldable cards like the hub. Search on top, then the open note's details, your library in three tabs, and the importer. */
export class SidebarView extends ItemView {
  private unfolded: Record<CardKey, boolean> = { search: true, info: true, library: true, importer: true, dictionary: false };
  private libTab: LibTab = "bibles";
  private cards: Partial<Record<CardKey, Card>> = {};
  private inspector: InspectorPanel | null = null;
  private search: SearchPanel;
  private dictionary: DictionaryPanel;
  private side: SidePanels;
  private searchInput: HTMLInputElement | null = null;
  private focusSearch = false;
  private reveal: CardKey | null = null;
  private library = debounce(() => this.drawLibrary(), 400, true);

  constructor(leaf: WorkspaceLeaf, private plugin: BookerPlugin) {
    super(leaf);
    this.search = new SearchPanel(plugin);
    this.dictionary = new DictionaryPanel(plugin);
    this.side = new SidePanels(plugin, (which) => (which === "library" ? this.drawLibrary() : this.drawImporter()));
  }
  getViewType() {
    return VIEW_SIDEBAR;
  }
  getDisplayText() {
    return "Booker";
  }
  getIcon() {
    return "library";
  }
  getState() {
    return { open: this.unfolded, libTab: this.libTab };
  }
  async setState(state: any, result: any) {
    const next = readSidebarState(state, { open: this.unfolded, libTab: this.libTab });
    this.unfolded = next.open;
    this.libTab = next.libTab;
    this.reveal = next.reveal;
    this.focusSearch = state?.tab === "search";
    await super.setState(state, result);
    this.render();
  }

  async onOpen() {
    this.contentEl.addClass("booker-side");
    const { vault, workspace, metadataCache } = this.plugin.app;
    for (const ev of ["create", "delete", "rename", "modify"] as const) this.registerEvent((vault as any).on(ev, (f: any) => inLibrary(f.path) && this.library()));
    this.registerEvent(workspace.on("file-open", () => this.noteChanged()));
    this.registerEvent(workspace.on("active-leaf-change", () => this.noteChanged()));
    this.registerEvent(metadataCache.on("changed", (f) => this.noteChanged(f.path)));
    this.render();
  }

  private noteChanged(path?: string) {
    this.inspector?.changed(path);
  }

  private toggled = (key: string, open: boolean) => {
    this.unfolded[key as CardKey] = open;
    this.plugin.app.workspace.requestSaveLayout();
  };

  private render() {
    const root = this.contentEl;
    root.empty();
    this.cards = {};
    this.inspector = null;
    const stack = root.createDiv({ cls: "booker-hub is-sidebar booker-side-stack" }).createDiv({ cls: "booker-hub-body" });
    const make = (key: CardKey, title: string, icon: string, sub = "") => (this.cards[key] = drawCard(stack, key, title, icon, sub, this.unfolded[key], this.toggled));
    const s = make("search", "Search", "search");
    this.searchInput = this.search.draw(s.body);
    const info = make("info", "File info", "text-cursor-input");
    this.inspector = new InspectorPanel(this.plugin, info.body, () => this.leaf, (text, kind, action) => {
      // the kind of note sits at the right of the heading, as a pill, with the note's action beside it
      info.sub.setText(text ?? "");
      info.sub.toggleClass("booker-pill", !!text);
      info.sub.dataset.kind = kind ?? "";
      info.summary.querySelector(".booker-hub-act")?.remove();
      if (!action) return;
      const b = info.summary.createEl("button", { cls: "clickable-icon booker-hub-act", attr: { "aria-label": action.label, title: action.label } });
      setIcon(b, action.icon);
      b.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        action.run();
      });
    });
    void this.inspector.render();
    const dict = make("dictionary", "Dictionary and thesaurus", "book-a");
    this.dictionary.draw(dict.body);
    make("library", "Library", "library");
    this.drawLibrary();
    const imp = make("importer", "Add to the library", "folder-plus");
    const more = imp.summary.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "More ways to add" } });
    setIcon(more, "more-vertical");
    more.addEventListener("click", (ev) => this.side.importerMenu(ev));
    this.drawImporter();
    if (this.focusSearch) {
      this.searchInput?.focus();
      this.focusSearch = false;
    }
    if (this.reveal) {
      // scroll the panel itself: scrollIntoView would also shift the sidebar's tab strip out of place
      const card = this.cards[this.reveal]?.card;
      if (card) this.contentEl.scrollTo({ top: Math.max(0, card.getBoundingClientRect().top - this.contentEl.getBoundingClientRect().top + this.contentEl.scrollTop - 8), behavior: "smooth" });
      this.reveal = null;
    }
  }

  /** The library card's three tabs and the list under them, drawn alone. */
  private drawLibrary() {
    const c = this.cards.library;
    if (!c) return;
    c.body.empty();
    this.side.libraryCard(
      c.body,
      this.libTab,
      (t) => {
        this.libTab = t;
        this.drawLibrary();
        this.plugin.app.workspace.requestSaveLayout();
      },
      () => undefined,
    );
  }

  private drawImporter() {
    const c = this.cards.importer;
    if (!c) return;
    c.body.empty();
    this.side.importerCard(c.body);
  }
}

/** An old panel type from a saved workspace: it opens the sidebar on the matching tab and removes itself. */
export class LegacyPanel extends ItemView {
  constructor(leaf: WorkspaceLeaf, private plugin: BookerPlugin, private type: string, private tab: SidebarTab) {
    super(leaf);
  }
  getViewType() {
    return this.type;
  }
  getDisplayText() {
    return "Booker";
  }
  getIcon() {
    return "library";
  }
  async onOpen() {
    const { workspace } = this.plugin.app;
    workspace.onLayoutReady(() => {
      this.leaf.detach();
      void this.plugin.openSidebar(this.tab);
    });
  }
}
