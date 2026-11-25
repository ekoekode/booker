import { App, Modal, Setting } from "obsidian";
import { fileToMarkdown } from "../import/toMarkdown";
import { DEFAULT_ACT_WORDS, planMarkdownImport, planTotals, type ImportOptions, type ImportPlan } from "../project/mdImport";
import { importMarkdownPlan, profileFor, Project } from "../project/vaultOps";
import { wordsFor } from "../profiles/words";
import { notifyError } from "../ui";
import type BookerPlugin from "../main";

/** Pick a Markdown file, see what it will become, and add it to the project as chapters and numbered sections. */
export class ImportMarkdownModal extends Modal {
  private plan: ImportPlan | null = null;
  private fileName = "";
  private markdown = "";
  private opts: ImportOptions = { chapterLevel: 0, actWords: DEFAULT_ACT_WORDS, breakPattern: "" };

  constructor(app: App, private proj: Project, private plugin: BookerPlugin | undefined, private onDone: () => void) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    const w = wordsFor(profileFor(this.proj));
    // what a heading becomes, and what a break splits: without a middle level a heading is one item and breaks stay inside it
    const head = (w.hasMid ? w.mid : w.item).toLowerCase();
    const headMany = (w.hasMid ? w.midMany : w.itemMany).toLowerCase();
    const part = w.hasMid ? w.item.toLowerCase() : "section";
    const partMany = w.hasMid ? w.itemMany.toLowerCase() : "sections";
    const top = w.top.toLowerCase();
    const topMany = w.topMany.toLowerCase();
    contentEl.createEl("h3", { text: "Import a manuscript" });
    contentEl.createEl("p", { cls: "booker-muted", text: `Pick a Markdown, text, Word (.docx), OpenDocument (.odt), Rich Text (.rtf) or ePub file. Headings become ${head} titles. ${w.hasTop ? `A heading that starts with Part or ${w.top} starts a new ${top}. ` : ""}Lines of ***, --- or * * * ${w.hasMid ? `split a ${head} into ${partMany}, which are numbered ${w.item} 1, ${w.item} 2… through the book` : "stay inside the heading's text"}. The imported text is added after what the project already has.` });
    const input = contentEl.createEl("input", { type: "file", attr: { accept: ".md,.markdown,.txt,.docx,.odt,.rtf,.epub" } });
    const tree = contentEl.createDiv({ cls: "booker-import-tree" });
    let go: { setDisabled(d: boolean): unknown } | undefined;
    const render = () => {
      tree.empty();
      if (this.fileName && !this.markdown.trim()) {
        this.plan = null;
        tree.createDiv({ cls: "booker-muted", text: `${this.fileName}: nothing to import. The file has no text.` });
        go?.setDisabled(true);
        return;
      }
      if (!this.markdown) return;
      this.plan = planMarkdownImport(this.markdown, this.opts);
      const t = planTotals(this.plan);
      tree.createDiv({ cls: "booker-muted", text: t.sections ? `${this.fileName}: ${w.hasTop ? `${t.acts} ${t.acts === 1 ? top : topMany}, ` : ""}${t.chapters} ${t.chapters === 1 ? head : headMany}, ${w.hasMid ? `${t.sections} ${t.sections === 1 ? part : partMany}, ` : ""}${t.words.toLocaleString()} words.` : `${this.fileName}: nothing to import.` });
      const list = tree.createDiv({ cls: "booker-import-list" });
      let shown = 0;
      for (const act of this.plan.acts) {
        if (act.title !== undefined) list.createDiv({ cls: "booker-import-act", text: act.title });
        for (const c of act.chapters) {
          if (shown++ >= 60) break;
          list.createDiv({ cls: "booker-import-chapter", text: `${c.title}${w.hasMid ? ` · ${c.sections.length} ${c.sections.length === 1 ? part : partMany}` : ""}` });
        }
      }
      if (shown > 60) list.createDiv({ cls: "booker-muted", text: "…and more." });
      go?.setDisabled(!t.sections);
    };
    new Setting(contentEl)
      .setName(`${head.charAt(0).toUpperCase()}${head.slice(1)} titles come from`)
      .setDesc(`Headings down to this level start a ${head}; deeper headings stay inside its text.`)
      .addDropdown((d) =>
        d
          .addOptions({ "0": "Every heading", "1": "Heading 1 (#)", "2": "Headings 1 to 2", "3": "Headings 1 to 3" })
          .setValue("0")
          .onChange((v) => {
            this.opts.chapterLevel = Number(v);
            render();
          })
      );
    if (w.hasTop)
    new Setting(contentEl)
      .setName(`${w.topMany} start with the word`)
      .setDesc(`A heading beginning with one of these words starts a ${top}. Separate words with commas; leave empty for no ${topMany}.`)
      .addText((t) =>
        t.setValue(DEFAULT_ACT_WORDS).onChange((v) => {
          this.opts.actWords = v;
          render();
        })
      );
    new Setting(contentEl)
      .setName(`Extra ${part} break`)
      .setDesc(`Optional. A line that also splits ${partMany}, such as # # # (plain text, or a regular expression). *** and --- always work.`)
      .addText((t) =>
        t.setPlaceholder("# # #").onChange((v) => {
          this.opts.breakPattern = v;
          render();
        })
      );
    input.addEventListener("change", async () => {
      const f = input.files?.[0];
      if (!f) return;
      this.fileName = f.name;
      try {
        this.markdown = await fileToMarkdown(f.name, { text: () => f.text(), bytes: () => f.arrayBuffer() });
      } catch (e) {
        this.markdown = "";
        this.plan = null;
        tree.empty();
        go?.setDisabled(true);
        return notifyError(e, "read the file");
      }
      render();
    });
    new Setting(contentEl)
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((b) => {
        b.setButtonText("Import").setCta().setDisabled(true).onClick(async () => {
          if (!this.plan) return;
          const plan = this.plan;
          b.setDisabled(true);
          try {
            const run = () => importMarkdownPlan(this.app, this.proj, plan);
            const r = this.plugin ? await this.plugin.undoable(`Imported ${this.fileName}`, this.proj, [], run) : await run();
            this.close();
            this.onDone();
            return r;
          } catch (e) {
            b.setDisabled(false);
            notifyError(e, "import the manuscript");
          }
        });
        go = b;
      });
  }

  onClose() {
    this.contentEl.empty();
  }
}
