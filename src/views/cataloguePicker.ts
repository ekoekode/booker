import { Modal, Notice } from "obsidian";
import type BookerPlugin from "../main";
import { ConfirmModal } from "../ui";
import { formatDuration } from "../resources/ccel";
import { catalogueSource, estimateItems, type CatalogueSource, type CatItem } from "../resources/catalogueSources";
import { Pacer, HOST_DELAY_MS } from "../resources/fetcher";

/** Choose items to download from a website (CCEL works, Tertullian.org works, Fordham topics). Items you already have are marked and skipped. */
export class CataloguePicker extends Modal {
  private source: CatalogueSource;
  private items: CatItem[] = [];
  private done = new Set<string>();
  private picked = new Set<string>();
  private filter = "";
  private list!: HTMLElement;
  private foot!: HTMLElement;

  constructor(private plugin: BookerPlugin, sourceId: string) {
    super(plugin.app);
    this.source = catalogueSource(sourceId)!;
  }

  private get gap(): number {
    return Math.max(HOST_DELAY_MS[new URL(this.source.origin).host] ?? 1000, HOST_DELAY_MS[`www.${new URL(this.source.origin).host}`] ?? 0);
  }

  onOpen() {
    const { contentEl } = this;
    this.modalEl.addClass("booker-resources");
    contentEl.createEl("h3", { text: this.source.title });
    contentEl.createEl("p", { cls: "booker-muted", text: `${this.source.intro} Downloads run in the background and can be stopped; items already added are skipped next time.` });
    const bar = contentEl.createDiv({ cls: "booker-res-group" });
    const search = bar.createEl("input", { type: "text", cls: "booker-input", attr: { placeholder: "Filter by title or author" } });
    search.addEventListener("input", () => {
      this.filter = search.value.trim().toLowerCase();
      this.draw();
    });
    bar.createEl("button", { text: "Select shown" }).addEventListener("click", () => {
      for (const w of this.shown()) if (!this.done.has(w.id)) this.picked.add(w.id);
      this.draw();
    });
    bar.createEl("button", { text: "Clear" }).addEventListener("click", () => {
      this.picked.clear();
      this.draw();
    });
    this.list = contentEl.createDiv({ cls: "booker-res-list" });
    this.foot = contentEl.createDiv({ cls: "booker-res-group" });
    this.list.setText("Loading the list…");
    void this.load();
  }

  onClose() {
    this.contentEl.empty();
  }

  private async load() {
    try {
      this.items = await this.plugin.resources.catalogue(this.source.id);
      this.done = await this.plugin.resources.catalogueDone(this.source.id);
      this.draw();
    } catch (e) {
      this.list.setText(`Could not read the list: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private shown(): CatItem[] {
    const f = this.filter;
    return f ? this.items.filter((w) => `${w.title} ${w.note}`.toLowerCase().includes(f)) : this.items;
  }

  private draw() {
    this.list.empty();
    const rows = this.shown();
    for (const w of rows.slice(0, 200)) {
      const row = this.list.createDiv({ cls: "booker-res-row" + (this.done.has(w.id) ? " is-installed" : "") });
      const box = row.createEl("input", { type: "checkbox" });
      box.checked = this.picked.has(w.id) || this.done.has(w.id);
      box.disabled = this.done.has(w.id);
      box.addEventListener("change", () => {
        if (box.checked) this.picked.add(w.id);
        else this.picked.delete(w.id);
        this.drawFoot();
      });
      const text = row.createDiv({ cls: "booker-res-text" });
      text.createDiv({ cls: "booker-res-title", text: w.title });
      text.createDiv({ cls: "booker-muted", text: [w.note, this.done.has(w.id) ? "in your library" : ""].filter(Boolean).join(" · ") });
    }
    if (rows.length > 200) this.list.createDiv({ cls: "booker-muted", text: `${rows.length - 200} more: narrow the filter to see them.` });
    this.drawFoot();
  }

  private drawFoot() {
    this.foot.empty();
    const todo = this.items.filter((w) => this.picked.has(w.id) && !this.done.has(w.id));
    this.foot.createSpan({ cls: "booker-muted", text: todo.length ? `${todo.length} chosen · about ${formatDuration(estimateItems(todo, this.gap))}` : `${this.items.length} items, ${this.done.size} in your library` });
    const go = this.foot.createEl("button", { text: todo.length ? `Download ${todo.length}` : "Choose items", cls: "mod-cta" });
    go.disabled = !todo.length || !this.plugin.resources.available;
    go.addEventListener("click", () => {
      new Notice(`Booker: downloading ${todo.length} item${todo.length === 1 ? "" : "s"} in the background.`);
      void this.plugin.resources.installCatalogue(this.source.id, todo);
      this.close();
    });
    const everything = this.foot.createEl("button", { text: "Download all" });
    everything.disabled = !this.plugin.resources.available;
    everything.addEventListener("click", () => {
      const rest = this.items.filter((w) => !this.done.has(w.id));
      if (!rest.length) return void new Notice("Booker: everything here is already in your library.");
      new ConfirmModal(this.app, `Download all ${rest.length} remaining?`, `That takes about ${formatDuration(estimateItems(rest, this.gap))} and runs in the background. You can stop it from the hub's background tasks.`, "Download", () => {
        void this.plugin.resources.installCatalogue(this.source.id, rest);
        this.close();
      }).open();
    });
  }
}
