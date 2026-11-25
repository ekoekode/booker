import { App, Modal, Notice, Setting } from "obsidian";
import { extractEpub } from "../sources/extract";
import { kindOfFile, type NewSource } from "../sources/library";
import type { Result } from "../sources/service";
import type { Source, SourceType } from "../sources/types";
import { pickFiles } from "../scripture/store";
import { classify } from "../library/classify";

/** Add a source: choose the file, check the citation details, add. */
export class AddSourceModal extends Modal {
  private file: File | null = null;
  private meta = { title: "", authors: "", year: "", publisher: "", place: "", edition: "", container: "", category: "", volume: "", issue: "", pages: "", url: "", type: "book" as SourceType };

  constructor(app: App, private onAdd: (meta: NewSource, data: ArrayBuffer, ext: string) => Promise<void>) {
    super(app);
  }

  onOpen() {
    this.render();
  }

  private render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: "Add a source" });
    new Setting(contentEl)
      .setName("File")
      .setDesc(this.file ? this.file.name : "A PDF, ePub, Markdown or text file, a saved web page, a CCEL ThML / TEI XML file, or a database: a Booker library (.nlib) or an e-Sword dictionary (.dctx).")
      .addButton((b) =>
        b.setButtonText(this.file ? "Choose another…" : "Choose file…").onClick(async () => {
          const f = (await pickFiles(["pdf", "epub", "md", "markdown", "txt", "html", "htm", "xhtml", "xml", "thml", "nlib", "dctx", "mybible"]))[0];
          if (!f) return;
          if (!kindOfFile(f.name)) {
            const c = classify(f.name);
            return void new Notice(c.module ? "Booker: that is a Bible or commentary module. Drop it on the library drop zone in the Documents tab." : "Booker: that kind of file is not supported.");
          }
          this.file = f;
          const m = this.meta;
          if (!m.title) m.title = f.name.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ");
          if (/\.(nlib|dctx)$/i.test(f.name)) {
            try {
              const { readDatabase } = await import("../sources/nlib");
              const d = await readDatabase(new Uint8Array(await f.arrayBuffer()), f.name);
              Object.assign(m, { title: d.meta.title, authors: d.meta.authors.join("; "), year: d.meta.year ?? "", publisher: d.meta.publisher ?? "", place: d.meta.place ?? "", edition: d.meta.edition ?? "", container: d.meta.container ?? "", category: d.meta.category ?? "", volume: d.meta.volume ?? "", url: d.meta.url ?? "", type: d.meta.type });
            } catch (e) {
              new Notice(`Booker: could not read that database. ${e instanceof Error ? e.message : e}`);
            }
          }
          if (/\.epub$/i.test(f.name)) {
            try {
              const e = await extractEpub(await f.arrayBuffer());
              if (e.title) m.title = e.title;
              if (e.author && !m.authors) m.authors = e.author;
            } catch {
              /* the details can be typed */
            }
          }
          this.render();
        })
      );
    const text = (name: string, key: keyof typeof this.meta, desc = "") =>
      new Setting(contentEl).setName(name).setDesc(desc).addText((t) => t.setValue(String(this.meta[key])).onChange((v) => ((this.meta as any)[key] = v.trim())));
    new Setting(contentEl).setName("Kind").addDropdown((d) =>
      d
        .addOptions({ book: "Book", chapter: "Chapter in a book", article: "Journal article", web: "Web page" })
        .setValue(this.meta.type)
        .onChange((v) => {
          this.meta.type = v as SourceType;
          this.render();
        })
    );
    text("Title", "title");
    text("Author(s)", "authors", "Separate several with a semicolon: John Calvin; Ford Lewis Battles");
    text("Year", "year");
    if (this.meta.type === "book" || this.meta.type === "chapter") {
      text("Publisher", "publisher");
      text("Place", "place");
      text("Edition", "edition", "Such as 2nd");
    }
    if (this.meta.type !== "book") text(this.meta.type === "chapter" ? "In (book title)" : "Journal or site", "container");
    if (this.meta.type === "article") {
      text("Volume", "volume");
      text("Issue", "issue");
    }
    if (this.meta.type !== "web") text("Pages", "pages", "For an article or chapter, the page range");
    if (this.meta.type === "web") text("Web address", "url");
    new Setting(contentEl)
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((b) =>
        b.setButtonText("Add").setCta().onClick(async () => {
          const f = this.file;
          if (!f) return void new Notice("Booker: choose a file first.");
          if (!this.meta.title) return void new Notice("Booker: give the source a title.");
          const m = this.meta;
          const meta: NewSource = {
            title: m.title,
            authors: m.authors.split(";").map((x) => x.trim()).filter(Boolean),
            ...(m.year && { year: m.year }),
            ...(m.publisher && { publisher: m.publisher }),
            ...(m.place && { place: m.place }),
            ...(m.edition && { edition: m.edition }),
            ...(m.container && { container: m.container }),
            ...(m.category && { category: m.category }),
            ...(m.volume && { volume: m.volume }),
            ...(m.issue && { issue: m.issue }),
            ...(m.pages && { pages: m.pages }),
            ...(m.url && { url: m.url }),
            type: m.type,
            kind: kindOfFile(f.name)!,
          };
          b.setDisabled(true).setButtonText("Adding…");
          try {
            await this.onAdd(meta, await f.arrayBuffer(), f.name.split(".").pop()!.toLowerCase());
            this.close();
          } catch (e) {
            b.setDisabled(false).setButtonText("Add");
            new Notice(`Booker: could not add the source. ${e instanceof Error ? e.message : e}`);
          }
        })
      );
  }

  onClose() {
    this.contentEl.empty();
  }
}

/** Search every source (or one) and open a result at its place. */
export class SearchSourcesModal extends Modal {
  constructor(
    app: App,
    private sources: Source[],
    private run: (sources: Source[], q: string, progress: (m: string) => void) => Promise<Result[]>,
    private openResult: (r: Result) => void
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("booker-scripture");
    contentEl.createEl("h3", { text: "Search sources" });
    if (!this.sources.length) {
      contentEl.createEl("p", { text: "No sources yet. Add one with Booker: Add source." });
      return;
    }
    const top = contentEl.createDiv({ cls: "booker-scripture-top" });
    const scope = top.createEl("select");
    scope.createEl("option", { text: "All sources", value: "" });
    for (const s of this.sources) scope.createEl("option", { text: s.title, value: s.uid });
    const input = top.createEl("input", { type: "text", placeholder: 'Words, "an exact phrase", -excluded' });
    const status = contentEl.createDiv({ cls: "booker-muted booker-scripture-status" });
    const list = contentEl.createDiv({ cls: "booker-scripture-hits booker-src-results" });
    let seq = 0;
    const go = async () => {
      const q = input.value.trim();
      const my = ++seq;
      list.empty();
      if (!q) return status.setText("");
      status.setText("Searching…");
      const scoped = scope.value ? this.sources.filter((s) => s.uid === scope.value) : this.sources;
      const res = await this.run(scoped, q, (m) => my === seq && status.setText(m));
      if (my !== seq) return;
      status.setText(res.length ? `${res.length}${res.length >= 60 ? "+" : ""} passages.` : "Nothing found.");
      for (const r of res) {
        const row = list.createDiv({ cls: "booker-scripture-hit" });
        row.createEl("b", { text: `${r.source.title} · ${r.chunk.loc}` });
        row.createDiv({ text: r.snippet });
        row.onclick = () => {
          this.close();
          this.openResult(r);
        };
      }
    };
    let t = 0;
    input.addEventListener("input", () => {
      window.clearTimeout(t);
      t = window.setTimeout(() => void go(), 200);
    });
    scope.onchange = () => void go();
    window.setTimeout(() => input.focus(), 30);
  }

  onClose() {
    this.contentEl.empty();
  }
}
