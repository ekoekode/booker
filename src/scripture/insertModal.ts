/** The Insert scripture window: type a reference or some words, see the passage as it will look, press Enter. */
import { App, Component, MarkdownRenderer, Modal, Notice, Setting, debounce } from "obsidian";
import { BOOK_BY_OSIS } from "./books";
import { DEFAULT_STYLE, formatInsert, verseParts, type VerseStyle } from "./format";
import { styleNameOf, type SavedStyles } from "./savedStyles";
import { NamePrompt } from "../ui";
import type { BibleModule } from "./module";
import { plain } from "./module";
import { formatPassage, parseRefs, type Passage } from "./ref";
import type { ModuleFile, ModuleStore } from "./store";

export interface ScriptureData {
  folder: string;
  defaultModule?: string;
  style: VerseStyle;
  /** styles the user has named */
  savedStyles?: SavedStyles;
  /** which side of the Bible reader the references tab opens on */
  refsSide?: "left" | "right";
  /** the semantic model chosen in settings; the default one when empty */
  semanticModel?: string;
  /** uids of sources left out of searching by meaning */
  semanticSkip?: string[];
  /** the Reader's text size, as a multiple of the normal size */
  readerSize?: number;
  /** how words copied from a reader are written (see the Copy settings window) */
  copy?: Partial<import("../reader/copySettings").CopySettings>;
  /** the order the cards of a word study page are shown in: "berean" and the path of each dictionary; the last arrangement made */
  wordCardOrder?: string[];
}

/** Lets the window set this book's own Bible and verse style. */
export interface BookScope {
  name: string;
  /** the style name is given when the current style has been saved */
  apply(module: string, styleName: string | undefined): Promise<void>;
}

export const DEFAULT_SCRIPTURE: ScriptureData = { folder: "Booker/Bibles", style: DEFAULT_STYLE };

export class InsertScriptureModal extends Modal {
  private files: ModuleFile[] = [];
  private mod: BibleModule | null = null;
  private moduleId: string;
  private input!: HTMLInputElement;
  private preview!: HTMLElement;
  private hits!: HTMLElement;
  private parts!: HTMLElement;
  private status!: HTMLElement;
  private passages: Passage[] | null = null;
  private partFrom = -1;
  private partTo = -1;
  private render = new Component();
  private style: VerseStyle;

  constructor(app: App, private store: ModuleStore, private data: ScriptureData, private save: () => Promise<void>, private insert: (text: string) => void, initial = "", private read?: (ref: string) => void, private book?: BookScope, private commentary?: (ref: string) => void) {
    super(app);
    this.style = { ...DEFAULT_STYLE, ...data.style };
    this.moduleId = data.defaultModule ?? "";
    this.initial = initial;
  }
  private initial: string;
  private pv = 0;

  async onOpen() {
    const { contentEl } = this;
    this.render.load();
    contentEl.addClass("booker-scripture");
    contentEl.createEl("h3", { text: "Insert scripture" });
    this.files = await this.store.bibles();
    if (!this.files.length) {
      contentEl.createEl("p", { text: `No Bible modules found. Add an e-Sword (.bblx), MySword (.bbl.mybible), OSIS, Zefania or USFX file with Booker: Add Bible module, or put it in the folder “${this.data.folder}”.` });
      new Setting(contentEl).addButton((b) => b.setButtonText("Close").onClick(() => this.close()));
      return;
    }
    if (!this.files.some((f) => f.path === this.moduleId)) this.moduleId = this.files[0].path;

    const top = contentEl.createDiv({ cls: "booker-scripture-top" });
    const select = top.createEl("select");
    for (const f of this.files) select.createEl("option", { text: f.name.replace(/\.[^.]+$/, "").replace(/\.(bbl|mybible)$/i, ""), value: f.path });
    select.value = this.moduleId;
    select.onchange = () => {
      this.moduleId = select.value;
      this.data.defaultModule = this.moduleId;
      void this.save();
      void this.openModule().then(() => this.update());
    };
    this.input = top.createEl("input", { type: "text", placeholder: "John 3:16-18, 1 Cor 13:4-7a, or words to search for" });
    this.input.value = this.initial;
    const go = debounce(() => this.update(), 120, true);
    this.input.addEventListener("input", () => {
      this.partFrom = this.partTo = -1;
      go();
    });
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.doInsert();
      }
    });

    this.status = contentEl.createDiv({ cls: "booker-muted booker-scripture-status" });
    this.parts = contentEl.createDiv({ cls: "booker-scripture-parts" });
    this.hits = contentEl.createDiv({ cls: "booker-scripture-hits" });
    this.preview = contentEl.createDiv({ cls: "booker-scripture-preview markdown-rendered" });

    this.styleControls(contentEl);
    new Setting(contentEl)
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((b) => b.setButtonText("Read in the Bible reader").onClick(() => {
        const ref = this.input.value.trim();
        this.close();
        this.read?.(ref);
      }))
      .addButton((b) => b.setButtonText("Commentary").setTooltip("See the commentaries on this verse").onClick(() => {
        const ref = this.input.value.trim();
        this.close();
        this.commentary?.(ref);
      }))
      .addButton((b) => b.setButtonText("Insert").setCta().onClick(() => this.doInsert()));

    await this.openModule();
    this.update();
    window.setTimeout(() => this.input.focus(), 30);
  }

  private async openModule() {
    this.status.setText("Opening…");
    this.mod = null;
    const f = this.files.find((x) => x.path === this.moduleId);
    if (!f) return;
    try {
      this.mod = await this.store.load(f);
      this.status.setText("");
    } catch (e) {
      this.status.setText(e instanceof Error ? e.message : String(e));
    }
  }

  private styleHost!: HTMLElement;

  private styleControls(el: HTMLElement) {
    this.styleHost = el.createDiv();
    this.drawStyle();
  }

  /** the named-style row: pick a saved style, save the current one, delete, or use it for this book */
  private savedRow(el: HTMLElement) {
    const row = el.createDiv({ cls: "booker-scripture-saved" });
    row.createSpan({ text: "Saved styles " });
    const saved = this.data.savedStyles ?? {};
    const names = Object.keys(saved).sort();
    const current = styleNameOf(saved, this.style);
    const sel = row.createEl("select");
    sel.createEl("option", { text: current ? "—" : "Custom", value: "" });
    for (const n of names) sel.createEl("option", { text: n, value: n });
    sel.value = current ?? "";
    sel.onchange = () => {
      if (!sel.value) return;
      this.style = { ...DEFAULT_STYLE, ...saved[sel.value] };
      this.data.style = this.style;
      void this.save();
      this.drawStyle();
      this.update();
    };
    const btn = (text: string, fn: () => void, title?: string) => {
      const b = row.createEl("button", { text });
      if (title) b.title = title;
      b.onclick = fn;
      return b;
    };
    btn("Save as…", () =>
      new NamePrompt(this.app, "Name this verse style", "For example Sermon quotes or Study notes.", (name) => {
        this.data.savedStyles = { ...(this.data.savedStyles ?? {}), [name]: { ...this.style } };
        void this.save();
        this.drawStyle();
      }, current ?? "", false, "Save").open()
    );
    if (current) btn("Delete", () => {
      const next = { ...(this.data.savedStyles ?? {}) };
      delete next[current];
      this.data.savedStyles = next;
      void this.save();
      this.drawStyle();
    });
    if (this.book)
      btn("Use for this book", () => {
        const name = styleNameOf(this.data.savedStyles, this.style);
        void this.book!.apply(this.moduleId, name).then(() => new Notice(`Booker: “${this.book!.name}” will write verses from this Bible${name ? ` in the style “${name}”` : ""}.${name ? "" : " Save the style first to include it."}`));
      }, `Write verses in ${this.book.name} from this Bible and style`);
  }

  private drawStyle() {
    const el = this.styleHost;
    el.empty();
    this.savedRow(el);
    const grid = el.createDiv({ cls: "booker-scripture-style" });
    let box: HTMLElement = grid;
    const group = (title: string) => {
      const g = grid.createDiv({ cls: "booker-scripture-group" });
      g.createDiv({ cls: "booker-scripture-grouptitle", text: title });
      box = g.createDiv({ cls: "booker-scripture-fields" });
    };
    const sel = <K extends keyof VerseStyle>(label: string, key: K, options: Record<string, string>) => {
      box.createSpan({ text: label, cls: "booker-scripture-label" });
      const s = box.createEl("select");
      for (const [v, t] of Object.entries(options)) s.createEl("option", { text: t, value: v });
      s.value = String(this.style[key]);
      s.onchange = () => {
        (this.style as any)[key] = s.value === "true" ? true : s.value === "false" ? false : s.value;
        this.data.style = this.style;
        void this.save();
        this.update();
      };
    };
    group("Text");
    sel("Layout", "layout", { block: "Block quote", inline: "Inline quote", plain: "Plain text" });
    sel("Each verse", "lines", { false: "Runs on", true: "New line" });
    sel("Words of Jesus", "jesus", { plain: "Plain", italic: "Italic" });
    group("Verse numbers and reference");
    sel("Verse numbers", "numbers", { none: "None", super: "Raised", bracket: "[16]", plain: "16" });
    sel("Reference", "reference", { after: "After", before: "Before", paren: "In brackets", none: "None" });
    sel("Book names", "naming", { full: "John", sbl: "SBL (1 Cor)", short: "Short" });
    sel("Translation", "translation", { plain: "John 3:16 KJV", paren: "John 3:16 (KJV)", off: "Leave off" });
  }

  private update() {
    this.hits.empty();
    this.parts.empty();
    if (!this.mod) return void this.preview.empty();
    const text = this.input.value.trim();
    this.passages = null;
    if (!text) {
      this.preview.empty();
      this.status.setText("Type a reference or some words.");
      return;
    }
    const refs = parseRefs(text);
    if (refs && refs.every((p) => BOOK_BY_OSIS.has(p.book))) {
      this.passages = this.withParts(refs);
      const out = formatInsert(this.mod, this.passages, this.style);
      if (!out) {
        this.preview.empty();
        this.status.setText(`${this.mod.name} has no ${formatPassage(refs[0], BOOK_BY_OSIS.get(refs[0].book)!)}.`);
        return;
      }
      this.status.setText(`${this.mod.name}`);
      this.partChips(refs);
      // the new preview is made beside the old one and swapped in, so typing does not flash it empty
      const tmp = document.createElement("div");
      const mine = ++this.pv;
      void MarkdownRenderer.render(this.app, out, tmp, "", this.render).then(() => {
        if (mine === this.pv) this.preview.replaceChildren(...Array.from(tmp.childNodes));
      });
      return;
    }
    // not a reference: search the text
    this.pv++;
    this.preview.empty();
    const words = text.split(/\s+/).filter((w) => w.length > 1);
    const hits = this.mod.search(words, 40);
    this.status.setText(hits.length ? `${hits.length}${hits.length === 40 ? "+" : ""} verses contain ${words.join(" and ")}. Press one to use it.` : "No verses found.");
    for (const h of hits) {
      const b = BOOK_BY_OSIS.get(h.book)!;
      const row = this.hits.createDiv({ cls: "booker-scripture-hit" });
      row.createEl("b", { text: `${b.name} ${h.c}:${h.v} ` });
      row.createSpan({ text: plain(this.mod.verse(h.book, h.c, h.v) ?? []) });
      row.onclick = () => {
        this.input.value = `${b.name} ${h.c}:${h.v}`;
        this.partFrom = this.partTo = -1;
        this.update();
        this.input.focus();
      };
    }
  }

  /** a, b and c chips for a lone verse; the chosen pieces become part letters on the reference */
  private partChips(refs: Passage[]) {
    const p = refs[0];
    if (refs.length !== 1 || !this.mod || p.from.v === null || p.from.v !== p.to.v || p.from.c !== p.to.c) return;
    const segs = this.mod.verse(p.book, p.from.c, p.from.v);
    if (!segs) return;
    const parts = verseParts(segs);
    if (parts.length < 2) return;
    this.parts.createSpan({ text: "Use only part of the verse: ", cls: "booker-muted" });
    parts.forEach((ps, i) => {
      const chip = this.parts.createEl("button", { text: "abc"[i], cls: "booker-scripture-chip" });
      chip.title = plain(ps);
      const on = this.partFrom >= 0 && i >= this.partFrom && i <= this.partTo;
      chip.toggleClass("is-on", on);
      chip.onclick = () => {
        if (this.partFrom < 0 || (this.partFrom === this.partTo && this.partFrom === i)) {
          if (this.partFrom === i && this.partTo === i) this.partFrom = this.partTo = -1;
          else this.partFrom = this.partTo = i;
        } else if (i < this.partFrom) this.partFrom = i;
        else this.partTo = i;
        this.update();
      };
    });
  }

  private withParts(refs: Passage[]): Passage[] {
    if (this.partFrom < 0 || refs.length !== 1) return refs;
    const p = refs[0];
    if (p.from.v === null || p.from.v !== p.to.v) return refs;
    const l = (i: number) => "abc"[i];
    return [{ ...p, from: { ...p.from, part: l(this.partFrom) }, to: { ...p.to, part: l(this.partTo) } }];
  }

  private doInsert() {
    if (!this.mod || !this.passages) return void new Notice("Type a reference first, such as John 3:16.");
    const out = formatInsert(this.mod, this.passages, this.style);
    if (!out) return void new Notice("That passage is not in this module.");
    this.data.defaultModule = this.moduleId;
    this.data.style = this.style;
    void this.save();
    this.close();
    this.insert(out);
  }

  onClose() {
    this.render.unload();
    this.contentEl.empty();
  }
}

