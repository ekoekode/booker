import { App, Menu, Modal, Notice, setIcon } from "obsidian";
import type BookerPlugin from "../main";
import type { Source } from "../sources/types";
import { SUPPORTED_KINDS } from "../library/classify";
import { importIncoming, readDropped, readPicked, reportImport, type ImportResult, type Incoming } from "../library/importer";
import { pickFiles } from "../scripture/store";
import { ConfirmModal } from "../ui";
import { DbMapModal } from "./dbMapModal";
import { IndexModal } from "./indexModal";
import { ResourceManager } from "./resourceManager";

export const VIEW_SIDE = "booker-side";

function el<K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = parent.createEl(tag, { cls });
  if (text !== undefined) e.setText(text);
  return e;
}

export type LibTab = "bibles" | "databases" | "documents";
export const LIB_TABS: Array<{ id: LibTab; label: string; icon: string }> = [
  { id: "bibles", label: "Bibles and commentaries", icon: "book-open" },
  { id: "databases", label: "Databases", icon: "database" },
  { id: "documents", label: "Documents", icon: "file-text" },
];
export const isLibTab = (t: unknown): t is LibTab => LIB_TABS.some((x) => x.id === t);

/** Open a file in the system file manager (desktop); elsewhere say where it is. */
function showFile(p: BookerPlugin, path: string) {
  const open = (p.app as any).showInFolder;
  if (typeof open === "function") open.call(p.app, path);
  else new Notice(path, 8000);
}

/** The library card (Bibles and commentaries, databases, documents in three tabs) and the importer card. The sidebar draws them; `redraw` asks it to draw one again. */
export class SidePanels {
  /** what the last drop did, kept across redraws so it can be read */
  private lastImport: ImportResult[] = [];

  constructor(private plugin: BookerPlugin, private redraw: (which: "library" | "importer") => void) {}

  private render() {
    this.redraw("library");
  }
  private refresh() {
    this.redraw("library");
    this.redraw("importer");
  }

  private action(parent: HTMLElement, label: string, icon: string, run: () => void, tip?: string) {
    const b = el(parent, "button", "booker-side-action");
    setIcon(el(b, "span", "booker-side-icon"), icon);
    el(b, "span", undefined, label);
    if (tip) b.setAttr("aria-label", tip);
    b.addEventListener("click", run);
    return b;
  }

  // ---------------------------------------------------------------- Library

  /** Draw the three-tab library into `body`. `onCounts` gets the text for the card's heading once it is known. */
  libraryCard(body: HTMLElement, tab: LibTab, setTab: (t: LibTab) => void, onCounts: (text: string) => void) {
    const p = this.plugin;
    const sources = p.sources();
    const dbs = sources.filter((s) => s.kind === "db");
    const docs = sources.filter((s) => s.kind !== "db");
    const bar = el(body, "div", "booker-side-libtabs");
    const counts: Record<LibTab, HTMLElement> = {} as never;
    for (const t of LIB_TABS) {
      const b = el(bar, "button", "booker-side-libtab" + (tab === t.id ? " is-active" : ""));
      b.setAttr("aria-label", t.label);
      b.setAttr("title", t.label);
      setIcon(el(b, "span", "booker-side-icon"), t.icon);
      counts[t.id] = el(b, "span", "booker-side-libcount");
      b.addEventListener("click", () => setTab(t.id));
    }
    const idx = el(bar, "button", "booker-side-libindex");
    setIcon(el(idx, "span", "booker-side-icon"), "database-zap");
    el(idx, "span", undefined, "Index");
    idx.setAttr("aria-label", "Index the library for search by meaning");
    idx.addEventListener("click", () => new IndexModal(p).open());
    counts.databases.setText(String(dbs.length));
    counts.documents.setText(String(docs.length));
    const list = el(body, "div", "booker-side-liblist");
    if (tab === "bibles") this.moduleList(list, (n) => {
      counts.bibles.setText(String(n));
      onCounts(`${n} · ${dbs.length} · ${docs.length}`);
    });
    else {
      void p.modules.list().then((all) => {
        const n = all.filter((m) => m.kind !== "dictionary" && m.kind !== "other").length;
        counts.bibles.setText(String(n));
        onCounts(`${n} · ${dbs.length} · ${docs.length}`);
      }).catch(() => undefined);
      if (tab === "databases") {
        if (!dbs.length) el(list, "p", "booker-muted", "Reference libraries and dictionaries you add appear here.");
        for (const s of dbs) this.databaseRow(list, s);
      } else {
        if (!docs.length) el(list, "p", "booker-muted", "Nothing here yet. Choose or drop a PDF, ePub, saved web page, Markdown or Word file below and it appears here.");
        for (const s of docs) this.documentRow(list, s);
      }
    }
  }

  // ---------------------------------------------------------------- Importer

  /** The importer card: one Choose source button and a drop target for files or a folder. The card's heading menu holds the less common ways in. */
  importerCard(body: HTMLElement) {
    const p = this.plugin;
    const zone = el(body, "div", "booker-dropzone");
    setIcon(el(zone, "span", "booker-dropzone-icon"), "upload");
    el(zone, "div", "booker-dropzone-title", "Drop files or a folder here");
    const status = el(body, "div", "booker-import-status");
    this.showResults(status, this.lastImport);
    zone.addEventListener("dragover", (ev) => {
      ev.preventDefault();
      zone.addClass("is-over");
    });
    zone.addEventListener("dragleave", () => zone.removeClass("is-over"));
    zone.addEventListener("drop", (ev) => {
      ev.preventDefault();
      zone.removeClass("is-over");
      const dt = ev.dataTransfer;
      if (dt) void this.runImport(status, readDropped(dt));
    });
    const choose = el(zone, "button", "mod-cta booker-side-choose");
    setIcon(el(choose, "span", "booker-side-icon"), "folder-plus");
    el(choose, "span", undefined, "Choose source");
    choose.setAttr("aria-label", "Choose files or a folder to add");
    choose.addEventListener("click", (ev) => {
      const menu = new Menu();
      menu.addItem((i) => i.setTitle("Files…").setIcon("files").onClick(() => void pickFiles([]).then((f) => f.length && this.runImport(status, readPicked(f)))));
      menu.addItem((i) => i.setTitle("Folder…").setIcon("folder-input").onClick(() => {
        const input = document.createElement("input");
        input.type = "file";
        (input as any).webkitdirectory = true;
        input.onchange = () => {
          const f = Array.from(input.files ?? []);
          if (f.length) void this.runImport(status, readPicked(f));
        };
        input.click();
      }));
      menu.showAtMouseEvent(ev);
    });
    const res = el(body, "button", "booker-side-resources");
    setIcon(el(res, "span", "booker-side-icon"), "download-cloud");
    el(res, "span", undefined, "Resource manager");
    res.setAttr("aria-label", "Models, libraries and works you can download");
    res.addEventListener("click", () => new ResourceManager(p).open());
  }

  /** The three-dot menu on the importer card's heading. */
  importerMenu(ev: MouseEvent) {
    const p = this.plugin;
    const menu = new Menu();
    menu.addItem((i) => i.setTitle("Add one with its details…").setIcon("file-plus").onClick(() => p.runCommand("add-source")));
    menu.addItem((i) => i.setTitle("Import bibliography…").setIcon("list-plus").onClick(() => p.runCommand("import-bibliography")));
    menu.addItem((i) => i.setTitle("Resource manager…").setIcon("download-cloud").onClick(() => new ResourceManager(p).open()));
    menu.addItem((i) => i.setTitle("Index all documents").setIcon("database").onClick(() => p.runCommand("index-sources")));
    menu.addSeparator();
    menu.addItem((i) => i.setTitle("What can I add?").setIcon("info").onClick(() => new WhatCanIAdd(p.app).open()));
    menu.showAtMouseEvent(ev);
  }

  private showResults(status: HTMLElement, results: ImportResult[]) {
    if (!results.length) return;
    const head = el(status, "div", "booker-import-head");
    el(head, "span", "booker-side-rowtitle", "Last import");
    const clear = el(head, "button", "clickable-icon");
    setIcon(clear, "x");
    clear.setAttr("aria-label", "Clear this list");
    clear.addEventListener("click", () => {
      this.lastImport = [];
      status.empty();
    });
    for (const r of results) {
      const row = el(status, "div", "booker-import-row is-" + r.status);
      setIcon(el(row, "span", "booker-side-icon"), r.status === "added" ? "check" : r.status === "skipped" ? "minus" : "alert-triangle");
      const text = el(row, "div");
      el(text, "div", "booker-side-rowtitle", r.name);
      el(text, "div", "booker-muted booker-side-rowsub", r.message);
    }
  }

  private async runImport(status: HTMLElement, reading: Promise<Incoming[]>) {
    status.empty();
    const msg = el(status, "div", "booker-muted", "Reading what you dropped…");
    try {
      const files = await reading;
      if (!files.length) return void msg.setText("Nothing to add.");
      msg.setText(`Adding ${files.length} file${files.length === 1 ? "" : "s"}…`);
      const results = await importIncoming(this.plugin, files);
      msg.remove();
      this.lastImport = results;
      this.showResults(status, results);
      reportImport(results);
      this.refresh();
    } catch (e) {
      msg.setText(`Booker could not read that. ${e instanceof Error ? e.message : e}`);
    }
  }

  /** A three-dot button on a row. */
  private dots(row: HTMLElement, fill: (menu: Menu) => void) {
    const b = el(row, "button", "clickable-icon");
    setIcon(b, "more-vertical");
    b.setAttr("aria-label", "More");
    b.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const menu = new Menu();
      fill(menu);
      menu.showAtMouseEvent(ev);
    });
  }

  private moduleList(box: HTMLElement, onCount: (n: number) => void) {
    const p = this.plugin;
    void p.modules.list().then((list) => {
      const mods = list.filter((m) => m.kind !== "dictionary" && m.kind !== "other");
      onCount(mods.length);
      if (!mods.length) return void el(box, "p", "booker-muted", "No Bibles yet. Choose or drop an e-Sword, MySword, OSIS, Zefania or USFX file below.");
      const def = p.scriptureData().defaultModule;
      for (const m of mods) {
        const isBible = m.kind === "bible" || m.kind === "xml";
        const row = el(box, "div", "booker-side-row booker-item-card");
        const main = el(row, "div", "booker-side-rowmain");
        el(main, "div", "booker-side-rowtitle", m.name.replace(/\.(bbl|cmt)\.mybible$|\.[^.]+$/i, ""));
        el(main, "div", "booker-muted booker-side-rowsub", `${isBible ? "Bible" : "Commentary"}${def === m.path ? " · default" : ""}`);
        row.addEventListener("click", () => void (isBible ? p.openPlace({ kind: "bible", module: m.path, book: "John", chapter: 1, verse: 0 }) : p.openLibrary(undefined, { path: m.path })));
        this.dots(row, (menu) => {
          if (isBible && def !== m.path)
            menu.addItem((i) => i.setTitle("Make the default Bible").setIcon("check").onClick(async () => {
              await p.saveScripture({ ...p.scriptureData(), defaultModule: m.path });
              this.render();
            }));
          menu.addItem((i) => i.setTitle("Open file location").setIcon("folder-open").onClick(() => showFile(p, m.path)));
          menu.addItem((i) => i.setTitle("Remove from the library…").setIcon("trash").onClick(() =>
            new ConfirmModal(p.app, "Remove from the library?", `${m.name} is deleted from the vault.`, "Remove", async () => {
              await p.modules.remove(m.path);
              this.render();
            }).open()
          ));
        });
      }
    }).catch(() => undefined);
  }

  private databaseRow(parent: HTMLElement, s: Source) {
    const p = this.plugin;
    const row = el(parent, "div", "booker-side-row booker-item-card");
    const main = el(row, "div", "booker-side-rowmain");
    el(main, "div", "booker-side-rowtitle", s.title);
    el(main, "div", "booker-muted booker-side-rowsub", [s.authors.join(", "), s.container ?? s.category, s.year].filter(Boolean).join(" · ") || "Database");
    row.addEventListener("click", () => void p.openSource(s));
    this.dots(row, (menu) => {
      menu.addItem((i) => i.setTitle("Open").setIcon("book-open").onClick(() => void p.openSource(s)));
      menu.addItem((i) => i.setTitle("Map Fields…").setIcon("sliders-horizontal").onClick(() => new DbMapModal(p, s, () => this.render()).open()));
      menu.addItem((i) => i.setTitle("Open file location").setIcon("folder-open").onClick(() => showFile(p, s.file)));
    });
  }

  private documentRow(parent: HTMLElement, s: Source) {
    const p = this.plugin;
    const row = el(parent, "div", "booker-side-row booker-item-card");
    const top = el(row, "div", "booker-side-rowmain");
    el(top, "div", "booker-side-rowtitle", s.title);
    el(top, "div", "booker-muted booker-side-rowsub", [s.authors.join(", "), s.year, s.kind.toUpperCase()].filter(Boolean).join(" · "));
    row.addEventListener("click", () => void p.openSource(s));
    const where = el(row, "button", "clickable-icon");
    setIcon(where, "list-tree");
    where.setAttr("aria-label", "Where this document is cited");
    where.addEventListener("click", (ev) => {
      ev.stopPropagation();
      void p.citedIn(s.citekey).then((hits) => {
        const menu = new Menu();
        if (!hits.length) menu.addItem((i) => i.setTitle("Not cited in any book yet").setDisabled(true));
        for (const h of hits.slice(0, 40))
          menu.addItem((i) =>
            i.setTitle(`${h.title}: ${h.snippet}`).onClick(async () => {
              const f = p.app.vault.getFileByPath(h.path);
              if (!f) return;
              await p.app.workspace.getLeaf("tab").openFile(f, { eState: { line: h.line - 1 } });
            })
          );
        menu.showAtMouseEvent(ev);
      });
    });
    const cite = el(row, "button", "clickable-icon");
    setIcon(cite, "quote");
    cite.setAttr("aria-label", "Insert citation in the note you are writing");
    cite.addEventListener("click", (ev) => {
      ev.stopPropagation();
      p.withEditor((ed) => ed.replaceSelection(`[@${s.citekey}, ]`));
    });
    this.dots(row, (menu) => {
      menu.addItem((i) => i.setTitle("Open").setIcon("book-open").onClick(() => void p.openSource(s)));
      menu.addItem((i) => i.setTitle("Open file location").setIcon("folder-open").onClick(() => showFile(p, s.file)));
    });
  }

}

/** What the importer understands, listed. */
class WhatCanIAdd extends Modal {
  constructor(app: App) {
    super(app);
  }
  onOpen() {
    this.titleEl.setText("What can I add?");
    for (const k of SUPPORTED_KINDS) {
      const r = el(this.contentEl, "div", "booker-side-kind");
      el(r, "div", "booker-side-rowtitle", `${k.label}  ·  ${k.extensions}`);
      el(r, "div", "booker-muted booker-side-rowsub", `${k.note} Kept in Library/${k.keptIn}.`);
    }
  }
  onClose() {
    this.contentEl.empty();
  }
}
