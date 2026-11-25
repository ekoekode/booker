import { setIcon, type EventRef } from "obsidian";
import { moduleLabel } from "../../scripture/store";
import type { Place } from "../../reader/place";
import { categoryOf, databaseLabel, databaseOf, databases, facets, filterWorks, groupWorks, sortWorks, workOf, yearText, type WorkFilter, type WorkSort } from "../../sources/catalog";
import { ALL_VOLUMES } from "../../sources/volumes";
import type { Pane, PaneCtx } from "./types";

/** The database id that stands for the commentary modules (they are not sources). */
export const COMMENTARIES = "@commentaries";
const WORKS_SHOWN = 400;

/** The shelf of databases, and the list of works in one. */
export class ShelfPane implements Pane {
  private filter: WorkFilter = {};
  private sort: WorkSort = "author";
  private ref: EventRef | null = null;

  constructor(private ctx: PaneCtx, private p: Extract<Place, { kind: "shelf" | "works" }>) {}

  place(): Place {
    return this.p;
  }
  source() {
    return this.p.kind === "works" ? (this.p.db === COMMENTARIES ? "Commentaries" : databaseLabel(this.p.db)) : "Libraries";
  }
  crumbs() {
    if (this.p.kind === "shelf") return [{ text: "Libraries" }];
    return [{ text: "Libraries", go: { kind: "shelf" } as Place }, { text: this.source() }];
  }
  placeLabel() {
    return null;
  }
  canPrev() {
    return false;
  }
  canNext() {
    return false;
  }
  prev() {}
  next() {}

  async load() {
    this.ctx.host.empty();
    // what is added to the library shows on the shelf at once
    if (!this.ref) this.ref = this.ctx.plugin.events.on("library", () => this.ctx.host.isConnected && void this.load());
    if (this.p.kind === "shelf") this.home();
    else if (this.p.db === COMMENTARIES) await this.commentaries();
    else this.works(this.p.db);
    this.ctx.changed();
  }

  private home() {
    const m = this.ctx.host.createDiv({ cls: "booker-reader-wide" });
    m.createEl("h2", { cls: "booker-reader-title", text: "Libraries" });
    const grid = m.createDiv({ cls: "booker-lib-cards" });
    const card = (title: string, note: string, icon: string, to: Place) => {
      const c = grid.createDiv({ cls: "booker-lib-card" });
      setIcon(c.createDiv({ cls: "booker-lib-card-icon" }), icon);
      c.createDiv({ cls: "booker-lib-card-title", text: title });
      c.createDiv({ cls: "booker-muted", text: note });
      c.addEventListener("click", () => this.ctx.go(to));
    };
    card("Bibles", "Read, search and follow verses", "book-open", { kind: "bible", module: "", book: "John", chapter: 1, verse: 0 });
    for (const d of databases(this.ctx.plugin.sources())) card(d.label, d.note, d.id === "Documents and books" ? "file-text" : "library", { kind: "works", db: d.id });
    void this.ctx.plugin.modules.commentaries().then((files) => {
      if (!files.length || !grid.isConnected) return;
      card("Commentaries", `${files.length} e-Sword and MySword module${files.length === 1 ? "" : "s"}`, "message-square-text", { kind: "works", db: COMMENTARIES });
    });
    if (!this.ctx.plugin.sources().length) m.createEl("p", { cls: "booker-muted", text: "No libraries or documents yet. Use Add source or Add a library." });
  }

  private async commentaries() {
    const m = this.ctx.host.createDiv({ cls: "booker-reader-wide" });
    m.createEl("h2", { cls: "booker-reader-title", text: "Commentaries" });
    for (const f of await this.ctx.plugin.modules.commentaries()) {
      const row = m.createDiv({ cls: "booker-lib-work" });
      row.createDiv({ cls: "booker-lib-item-title", text: moduleLabel(f.name) });
      row.addEventListener("click", () => this.ctx.go({ kind: "commentary", path: f.path }));
    }
  }

  private works(id: string) {
    const m = this.ctx.host.createDiv({ cls: "booker-reader-wide" });
    m.createEl("h2", { cls: "booker-reader-title", text: databaseLabel(id) });
    const pool = this.ctx.plugin.sources().filter((s) => databaseOf(s) === id);
    const fx = facets(pool.map(workOf));
    const ctl = m.createDiv({ cls: "booker-lib-filters" });
    const text = ctl.createEl("input", { type: "search", placeholder: "Filter works", attr: { "aria-label": "Filter works" } });
    text.value = this.filter.text ?? "";
    const select = (label: string, options: Array<[string, string]>, value: string, on: (v: string) => void) => {
      const s = ctl.createEl("select", { attr: { "aria-label": label } });
      s.createEl("option", { value: "", text: label });
      for (const [v, t] of options) s.createEl("option", { value: v, text: t });
      s.value = value;
      s.addEventListener("change", () => on(s.value));
    };
    const redo = () => list();
    select("Any author", fx.authors.map((a) => [a, a]), this.filter.author ?? "", (v) => ((this.filter.author = v || undefined), redo()));
    if (fx.volumes.size) select("Any volume", ALL_VOLUMES.filter((v) => fx.volumes.has(v)).map((v) => [v, v]), this.filter.volume ?? "", (v) => ((this.filter.volume = v || undefined), redo()));
    if (fx.categories.length > 1) select("Any category", fx.categories.map((c) => [c, c]), this.filter.category ?? "", (v) => ((this.filter.category = v || undefined), redo()));
    const yr = (ph: string, key: "yearFrom" | "yearTo") => {
      const i = ctl.createEl("input", { type: "number", cls: "booker-lib-year", placeholder: ph, attr: { "aria-label": ph } });
      const v = this.filter[key];
      if (v != null) i.value = String(v);
      i.addEventListener("change", () => {
        this.filter[key] = i.value.trim() === "" ? null : parseInt(i.value, 10);
        redo();
      });
    };
    if (fx.minYear !== null) {
      yr(`From year (${yearText(fx.minYear)})`, "yearFrom");
      yr(`To year (${yearText(fx.maxYear)})`, "yearTo");
    }
    const sort = ctl.createEl("select", { attr: { "aria-label": "Sort by" } });
    for (const [v, t] of [["author", "By author"], ["title", "By title"], ["date", "By date"]]) sort.createEl("option", { value: v, text: t });
    sort.value = this.sort;
    sort.addEventListener("change", () => {
      this.sort = sort.value as WorkSort;
      redo();
    });
    const count = m.createDiv({ cls: "booker-muted booker-lib-count" });
    const box = m.createDiv({ cls: "booker-lib-works" });
    const list = () => {
      this.filter.text = text.value;
      box.empty();
      const works = sortWorks(filterWorks(this.ctx.plugin.sources(), { ...this.filter, db: id }), this.sort);
      count.setText(works.length === pool.length ? `${works.length} works` : `${works.length} of ${pool.length} works`);
      let shown = 0;
      for (const g of groupWorks(works, this.sort)) {
        if (shown >= WORKS_SHOWN) break;
        if (g.heading) box.createDiv({ cls: "booker-lib-authorhead", text: g.heading });
        for (const w of g.works) {
          if (shown++ >= WORKS_SHOWN) break;
          const row = box.createDiv({ cls: "booker-lib-work" });
          row.createDiv({ cls: "booker-lib-item-title", text: w.source.title });
          const by = [this.sort === "author" ? "" : w.author, w.year !== null ? yearText(w.year) : "", w.volumeText, categoryOf(w.source) !== "writings" ? categoryOf(w.source) : ""].filter(Boolean).join(" · ");
          if (by) row.createDiv({ cls: "booker-muted", text: by });
          row.addEventListener("click", () => this.ctx.go({ kind: "work", uid: w.source.uid, entry: 0 }));
        }
      }
      if (works.length > shown) box.createDiv({ cls: "booker-muted booker-lib-more", text: `${works.length - shown} more. Narrow the list with the filters above.` });
      if (!works.length) box.createEl("p", { cls: "booker-muted", text: "No work matches these filters." });
    };
    text.addEventListener("input", list);
    list();
  }

  destroy() {
    if (this.ref) this.ctx.plugin.events.offref(this.ref);
    this.ref = null;
  }
}
