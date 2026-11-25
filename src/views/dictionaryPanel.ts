import { Notice, Setting, setIcon } from "obsidian";
import type BookerPlugin from "../main";
import { ENGLISH_RESOURCES } from "../resources/catalog";
import { formatSize, totalSize } from "../resources/types";
import type { Found } from "../dictionary/lookup";

/** The sidebar's Dictionary / Thesaurus card: look a word up, see its senses, and use a synonym. */
export class DictionaryPanel {
  private input!: HTMLInputElement;
  private out!: HTMLElement;
  private body!: HTMLElement;

  constructor(private plugin: BookerPlugin) {}

  draw(body: HTMLElement): HTMLInputElement {
    this.body = body;
    body.empty();
    const row = body.createDiv({ cls: "booker-dict-row" });
    this.input = row.createEl("input", { type: "text", placeholder: "Look up a word…", cls: "booker-input" });
    const go = row.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "Look up" } });
    setIcon(go, "search");
    go.addEventListener("click", () => void this.lookup(this.input.value));
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") void this.lookup(this.input.value);
    });
    this.out = body.createDiv({ cls: "booker-dict-out" });

    const opt = body.createDiv({ cls: "booker-dict-opt" });
    new Setting(opt)
      .setName("Suggest richer words as I write")
      .setDesc("A bar of SAT-level alternatives appears over a plain word as you write it.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.vocabSuggest).onChange(async (v) => {
          this.plugin.settings.vocabSuggest = v;
          await this.plugin.persist();
        })
      );

    this.plugin.onLookup = (w) => void this.lookup(w);
    void this.showState();
    if (this.plugin.pendingLookup) {
      const w = this.plugin.pendingLookup;
      this.plugin.pendingLookup = "";
      void this.lookup(w);
    }
    return this.input;
  }

  /** The state before any search: a download button when no dictionary is installed. */
  private async showState() {
    const idx = await this.plugin.english.load();
    // clear only now: redraws can overlap, and each one must start from an empty card
    this.out.empty();
    if (idx) {
      this.out.createDiv({ cls: "booker-muted", text: `${idx.size.toLocaleString()} words. Type one above, or select a word in your writing and use Look up.` });
      return;
    }
    const r = ENGLISH_RESOURCES[0];
    const box = this.out.createDiv({ cls: "booker-dict-missing" });
    box.createDiv({ text: "No English dictionary or thesaurus yet." });
    box.createDiv({ cls: "booker-muted", text: `${r.title}, about ${formatSize(totalSize(r)) === "0 B" ? "10 MB" : formatSize(totalSize(r))}. ${r.license}.` });
    const b = box.createEl("button", { cls: "mod-cta", text: this.plugin.resources.available ? "Download" : "Needs the desktop app" });
    b.disabled = !this.plugin.resources.available;
    b.addEventListener("click", () => {
      b.disabled = true;
      b.setText("Downloading…");
      void this.plugin.resources.installDictionary(r).then(() => {
        this.plugin.english.reset();
        void this.showState();
      });
    });
  }

  async lookup(raw: string) {
    const word = raw.trim();
    this.input.value = word;
    if (!word) return void this.showState();
    const idx = await this.plugin.english.load();
    if (!idx) return void this.showState();
    this.out.empty();
    const found = idx.find(word);
    if (!found) {
      this.out.createDiv({ cls: "booker-muted", text: `No entry for “${word}”.` });
      const near = idx.startingWith(word.toLowerCase());
      if (near.length) this.chips(this.out, "Did you mean", near);
      return;
    }
    this.show(found, word, idx.more(word, found.senses.flatMap((s) => s.synonyms)));
  }

  private show(f: Found, typed: string, more: string[] = []) {
    this.out.createEl("h4", { text: f.word + (f.word !== typed.toLowerCase() ? ` (from ${typed})` : "") });
    for (const s of f.senses) {
      const sense = this.out.createDiv({ cls: "booker-dict-sense" });
      sense.createSpan({ cls: "booker-dict-pos", text: s.pos });
      sense.createSpan({ text: ` ${s.gloss}` });
      if (s.synonyms.length) this.chips(sense, "", s.synonyms);
    }
    if (more.length) this.chips(this.out.createDiv({ cls: "booker-dict-sense" }), "More synonyms", more);
  }

  private chips(parent: HTMLElement, label: string, words: string[]) {
    const wrap = parent.createDiv({ cls: "booker-dict-chips" });
    if (label) wrap.createSpan({ cls: "booker-muted", text: `${label}: ` });
    for (const w of words) {
      const c = wrap.createEl("button", { cls: "booker-dict-chip", text: w, attr: { title: "Click to use it in your writing, or copy it" } });
      c.addEventListener("click", () => void this.use(w));
    }
  }

  /** Replace the selected word in the note you were writing in; with nothing selected, copy the word. */
  private async use(word: string) {
    const ed = this.plugin.lastEditor();
    if (ed && ed.somethingSelected()) {
      const sel = ed.getSelection();
      ed.replaceSelection(/^[A-Z]/.test(sel) ? word[0].toUpperCase() + word.slice(1) : word);
      return;
    }
    await navigator.clipboard.writeText(word).catch(() => undefined);
    new Notice(`Booker: copied “${word}”. Select a word in your writing to replace it with a click.`);
  }
}
