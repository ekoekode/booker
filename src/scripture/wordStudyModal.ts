import { App, Modal, Notice, Setting } from "obsidian";
import type { DictEntry } from "./esword";
import type { ModuleFile, ModuleStore } from "./store";
import { entryText } from "./esword";
import { findEntries, formatStudy, guessStudy, type Study, type StudyLayout } from "./wordstudy";

/** Look a word up in a lexicon you own (an e-Sword or MySword dictionary) and insert it as a word study. */
export class WordStudyModal extends Modal {
  private files: ModuleFile[] = [];
  private entries: DictEntry[] = [];
  private study: Study = { hebrew: "", translit: "", gloss: "", strongs: "" };
  private layout: StudyLayout = "inline";
  private list!: HTMLElement;
  private fields!: HTMLElement;
  private status!: HTMLElement;

  constructor(app: App, private store: ModuleStore, private insert: (text: string) => void, private initial = "") {
    super(app);
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.addClass("booker-scripture");
    contentEl.createEl("h3", { text: "Insert a word study" });
    this.files = await this.store.dictionaries();
    if (!this.files.length) {
      contentEl.createEl("p", { text: "No dictionaries or lexicons found. Add an e-Sword (.dctx) or MySword (.dct.mybible) lexicon, such as a Strong's, with Booker: Add Bible module (it takes any module)." });
      return;
    }
    const top = contentEl.createDiv({ cls: "booker-scripture-top" });
    const sel = top.createEl("select");
    for (const f of this.files) sel.createEl("option", { text: f.name.replace(/\.[^.]+$/, ""), value: f.path });
    const input = top.createEl("input", { type: "text", placeholder: "H430, a Hebrew word, or an English word" });
    input.value = this.initial;
    this.status = contentEl.createDiv({ cls: "booker-muted booker-scripture-status" });
    this.list = contentEl.createDiv({ cls: "booker-scripture-hits" });
    this.fields = contentEl.createDiv();
    const load = async () => {
      this.status.setText("Opening…");
      try {
        this.entries = (await this.store.loadDictionary(this.files.find((f) => f.path === sel.value)!)).entries;
        this.status.setText(`${this.entries.length} entries.`);
        run();
      } catch (e) {
        this.status.setText(e instanceof Error ? e.message : String(e));
      }
    };
    const run = () => {
      this.list.empty();
      const found = findEntries(this.entries, input.value);
      for (const e of found) {
        const row = this.list.createDiv({ cls: "booker-scripture-hit" });
        row.createEl("b", { text: `${e.word} ` });
        row.createSpan({ text: entryText(e.text).replace(/\s+/g, " ").slice(0, 140) });
        row.onclick = () => {
          this.study = guessStudy(e);
          this.drawFields();
        };
      }
      if (found.length === 1 && input.value.trim()) {
        this.study = guessStudy(found[0]);
        this.drawFields();
      }
    };
    sel.onchange = () => void load();
    let t = 0;
    input.addEventListener("input", () => {
      window.clearTimeout(t);
      t = window.setTimeout(run, 150);
    });
    await load();
    this.drawFields();
    window.setTimeout(() => input.focus(), 30);
  }

  private drawFields() {
    const el = this.fields;
    el.empty();
    const text = (name: string, key: keyof Study, rtl = false) =>
      new Setting(el).setName(name).addText((t) => {
        t.setValue(this.study[key]).onChange((v) => {
          this.study[key] = v.trim();
          preview.setText(formatStudy(this.study, this.layout));
        });
        if (rtl) t.inputEl.dir = "rtl";
      });
    text("Hebrew", "hebrew", true);
    text("Transliteration", "translit");
    text("Meaning", "gloss");
    text("Strong's number", "strongs");
    new Setting(el).setName("Layout").addDropdown((d) =>
      d
        .addOptions({ inline: "In the line of text", block: "Block quote" })
        .setValue(this.layout)
        .onChange((v) => {
          this.layout = v as StudyLayout;
          preview.setText(formatStudy(this.study, this.layout));
        })
    );
    const preview = el.createDiv({ cls: "booker-scripture-preview" });
    preview.setText(formatStudy(this.study, this.layout));
    new Setting(el)
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((b) =>
        b.setButtonText("Insert").setCta().onClick(() => {
          const out = formatStudy(this.study, this.layout);
          if (!out) return void new Notice("Booker: nothing to insert yet.");
          this.close();
          this.insert(out);
        })
      );
  }

  onClose() {
    this.contentEl.empty();
  }
}
