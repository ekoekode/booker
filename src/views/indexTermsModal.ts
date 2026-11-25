import { App, Modal, Notice, Setting } from "obsidian";
import { buildIndex, indexTerms, mergeTerms, removeTerm, renameTerm, termNames } from "../export/bookIndex";
import { indexSources, updateIndexPage, type Project } from "../project/vaultOps";
import { ListPicker } from "../ui";

/** The words and names in a book's index: where each one appears, and rename, merge, remove or add. */
export class IndexTermsModal extends Modal {
  private terms: string[] = [];
  private hits = new Map<string, string[]>();

  constructor(app: App, private proj: Project) {
    super(app);
  }

  async onOpen() {
    this.titleEl.setText(`Index: ${this.proj.name}`);
    this.terms = indexTerms(this.app.metadataCache.getFileCache(this.proj.file)?.frontmatter?.indexTerms);
    await this.scan();
    this.draw();
    if (this.terms.length) await updateIndexPage(this.app, this.proj);
  }

  private async scan() {
    this.sources = await indexSources(this.app, this.proj);
    this.count();
  }

  private sources: { where: string; text: string }[] = [];

  private count() {
    this.hits.clear();
    for (const t of this.terms) {
      const found = buildIndex([t], this.sources)[0];
      this.hits.set(t, found?.where ?? []);
    }
  }

  private async save(next: string[]) {
    this.terms = next;
    await this.app.fileManager.processFrontMatter(this.proj.file, (fm) => {
      if (next.length) fm.indexTerms = next;
      else delete fm.indexTerms;
    });
    this.count();
    this.draw();
    // the Index page in the back matter follows the terms
    await updateIndexPage(this.app, this.proj);
  }

  private draw() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("p", { cls: "booker-muted", text: "These words and names are printed in the index at the back, with the chapters they appear in. Renaming changes what is printed and keeps the old spelling matching; merging makes one entry cover both." });
    const add = new Setting(contentEl).setName("Add a term");
    add.addText((t) => {
      t.setPlaceholder("Word or name");
      t.inputEl.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") return;
        const v = t.getValue().trim();
        if (v && !v.includes("|") && !this.terms.some((x) => termNames(x).some((n) => n.toLowerCase() === v.toLowerCase()))) void this.save([...this.terms, v]);
      });
    });
    if (!this.terms.length) contentEl.createEl("p", { cls: "booker-muted", text: "No terms yet. Add one above, or right-click a word in a scene and choose Add to the index." });
    const sorted = [...this.terms].sort((a, b) => termNames(a)[0].localeCompare(termNames(b)[0], undefined, { sensitivity: "base" }));
    for (const entry of sorted) {
      const names = termNames(entry);
      const where = this.hits.get(entry) ?? [];
      const row = new Setting(contentEl).setName(names[0]).setDesc(`${names.length > 1 ? `Also: ${names.slice(1).join(", ")}. ` : ""}${where.length ? where.join(", ") : "Not found in the text, so it will not print."}`);
      row.addButton((b) => b.setButtonText("Rename").onClick(() => this.rename(entry)));
      if (this.terms.length > 1) row.addButton((b) => b.setButtonText("Merge into…").onClick(() => this.merge(entry)));
      row.addButton((b) => b.setIcon("trash").setTooltip("Remove from the index").onClick(() => void this.save(removeTerm(this.terms, entry))));
    }
    new Setting(contentEl).addButton((b) => b.setButtonText("Done").setCta().onClick(() => this.close()));
  }

  private rename(entry: string) {
    const m = new Modal(this.app);
    m.titleEl.setText("Print as");
    const input = m.contentEl.createEl("input", { type: "text", value: termNames(entry)[0] });
    input.style.width = "100%";
    const go = () => {
      const next = renameTerm(this.terms, entry, input.value);
      m.close();
      if (next === this.terms) return void new Notice("Booker: use a name without a bar (|).");
      void this.save(next);
    };
    input.addEventListener("keydown", (e) => e.key === "Enter" && go());
    new Setting(m.contentEl).addButton((b) => b.setButtonText("Rename").setCta().onClick(go));
    m.open();
    input.select();
  }

  private merge(entry: string) {
    new ListPicker(this.app, this.terms.filter((t) => t !== entry), (t) => termNames(t)[0], `Merge “${termNames(entry)[0]}” into…`, (into) => void this.save(mergeTerms(this.terms, entry, into))).open();
  }

  onClose() {
    this.contentEl.empty();
  }
}
