import { Modal, Notice, Setting } from "obsidian";
import type BookerPlugin from "../main";
import { applyNav, DEFAULT_NAV, describeDatabase, MAP_FIELDS, readMappedEntries, suggestMapping, type DbMap, type MapField } from "../sources/dbmap";
import { readNlibEntries } from "../sources/nlib";
import { entryLabel } from "../sources/tree";
import type { Source } from "../sources/types";

const FIELD_LABEL: Record<MapField, string> = {
  title: "Title (shown in the contents)",
  key: "Key or headword",
  text: "Text",
  locator: "Place (such as 3.12)",
  parent: "Parent entry (makes a tree)",
  level: "Kind of entry",
  order: "Order",
};

/** Choose which fields of a database Booker uses, and which of them show when browsing. The choice is saved next to the database. */
export class DbMapModal extends Modal {
  private tables: Record<string, string[]> = {};
  private isLibrary = false;
  private map: DbMap = { nav: { ...DEFAULT_NAV } };
  private bytes: Uint8Array | null = null;
  private previewEl: HTMLElement | null = null;

  constructor(private plugin: BookerPlugin, private source: Source, private onSaved: () => void) {
    super(plugin.app);
  }

  async onOpen() {
    this.contentEl.addClass("booker-dbmap");
    this.contentEl.createEl("p", { cls: "booker-muted", text: "Reading the database…" });
    try {
      this.bytes = new Uint8Array(await this.app.vault.adapter.readBinary(this.source.file));
      this.tables = await describeDatabase(this.bytes);
      this.isLibrary = !!this.tables.entries && !!this.tables.meta;
      this.map = (await this.plugin.sourceService.mapOf(this.source)) ?? (this.isLibrary ? { nav: { ...DEFAULT_NAV } } : suggestMapping(this.tables) ?? { nav: { ...DEFAULT_NAV } });
    } catch (e) {
      this.contentEl.empty();
      this.contentEl.createEl("p", { text: `Booker could not read this database. ${e instanceof Error ? e.message : e}` });
      return;
    }
    this.draw();
  }

  private draw() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: `Map Fields: ${this.source.title}` });
    if (!this.isLibrary) {
      new Setting(contentEl).setName("Table").setDesc("The table that holds the entries.").addDropdown((d) => {
        for (const t of Object.keys(this.tables)) d.addOption(t, t);
        d.setValue(this.map.table && this.tables[this.map.table] ? this.map.table : Object.keys(this.tables)[0] ?? "").onChange((v) => {
          this.map = { ...(suggestMapping({ [v]: this.tables[v] ?? [] }) ?? { nav: this.map.nav }), table: v, nav: this.map.nav };
          this.draw();
        });
      });
      const cols = this.tables[this.map.table ?? ""] ?? [];
      for (const f of MAP_FIELDS)
        new Setting(contentEl).setName(FIELD_LABEL[f]).addDropdown((d) => {
          d.addOption("", "(none)");
          for (const c of cols) d.addOption(c, c);
          d.setValue(this.map.columns?.[f] ?? "").onChange((v) => {
            const columns = { ...(this.map.columns ?? {}) };
            if (v) columns[f] = v;
            else delete columns[f];
            this.map = { ...this.map, columns };
            void this.preview();
          });
        });
    } else contentEl.createEl("p", { cls: "booker-muted", text: "This is a Booker library, so its fields are fixed. Choose what shows when you browse it." });

    contentEl.createEl("h4", { text: "Shown when browsing" });
    for (const [f, label] of [["title", "Title"], ["key", "Key or headword"], ["locator", "Place"]] as const)
      new Setting(contentEl).setName(label).addToggle((t) =>
        t.setValue(this.map.nav[f]).onChange((v) => {
          this.map = { ...this.map, nav: { ...this.map.nav, [f]: v } };
          void this.preview();
        })
      );
    contentEl.createEl("h4", { text: "Preview" });
    this.previewEl = contentEl.createDiv({ cls: "booker-dbmap-preview" });
    void this.preview();

    new Setting(contentEl)
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((b) =>
        b.setButtonText("Save").setCta().onClick(async () => {
          if (!this.isLibrary && !(this.map.table && this.map.columns?.text)) return void new Notice("Booker: choose the table and a Text field first.");
          await this.plugin.sourceService.saveMap(this.source, this.map);
          new Notice("Booker: saved. The database will be read again.");
          this.onSaved();
          this.close();
        })
      );
  }

  private async preview() {
    const box = this.previewEl;
    if (!box || !this.bytes) return;
    box.empty();
    try {
      const entries = this.isLibrary ? (await readNlibEntries(this.bytes)).slice(0, 6) : this.map.table && this.map.columns ? await readMappedEntries(this.bytes, this.map, 6) : [];
      if (!entries.length) return void box.createDiv({ cls: "booker-muted", text: "Nothing to show yet." });
      for (const e of applyNav(entries, this.map.nav)) box.createDiv({ text: entryLabel(e) });
    } catch (e) {
      box.createDiv({ cls: "booker-muted", text: e instanceof Error ? e.message : String(e) });
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}
