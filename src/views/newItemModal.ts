import { App, Modal, Setting } from "obsidian";
import { levelName, type Profile } from "../profiles/profile";
import { actTitle, chapterTitle, type Labels } from "../project/format";
import { actChoices, chapterChoices, HubScene, newActNumber, newChapterNumber } from "../project/hubModel";

export interface SceneChoice {
  title: string;
  act: number | string;
  chapter: number | string;
  /** true when the chapter is a new one (the numbering is done when it is created) */
  newChapter?: boolean;
  /** names to save for a newly made act / chapter (empty when none was typed) */
  actName?: string;
  chapterName?: string;
}

export type NewKind = "act" | "chapter" | "scene";

const NEW = "__new__";

const numeric = (v: string): number | string => (/^-?\d+$/.test(v) ? Number(v) : v);

/** New act, chapter or scene: one row of Act, Chapter and Scene. What is being made is a text box for its name; the levels above it are dropdowns saying where it goes; the levels below are greyed out. */
export class NewItemModal extends Modal {
  private act = "";
  private chapter = "";
  private actName = "";
  private chapterName = "";
  private sceneName = "";
  /** the act / chapter dropdown is on "New…" */
  private actIsNew = false;
  private chapterIsNew = false;
  private chapterSel!: HTMLSelectElement;
  private chapterBox!: HTMLElement;
  private chapterNameBox!: HTMLElement;
  private done = false;

  constructor(app: App, private scenes: HubScene[], private labels: Labels, private kind: NewKind, private at: { act: number | string; chapter?: number | string } | undefined, private onSubmit: (c: SceneChoice) => void, private profile?: Profile) {
    super(app);
    this.act = at ? String(at.act) : "";
    this.chapter = at?.chapter !== undefined ? String(at.chapter) : "";
  }

  private word(depth: number) {
    return this.profile ? levelName(this.profile, depth === 2 ? this.profile.levels.length - 1 : depth) : ["Act", "Chapter", "Scene"][depth];
  }

  private bare() {
    return !!this.profile && this.profile.levels.length < 2;
  }

  private flat() {
    return !!this.profile && this.profile.levels.length < 3;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("booker-newitem");
    const level = this.kind === "act" ? 0 : this.kind === "chapter" ? 1 : 2;
    contentEl.createEl("h3", { text: `New ${this.word(level).toLowerCase()}` });
    const row = contentEl.createDiv({ cls: "booker-newitem-row" });
    if (this.bare()) row.addClass("is-one");
    else if (this.flat()) row.addClass("is-two");
    const cell = (title: string) => {
      const c = row.createDiv({ cls: "booker-newitem-cell" });
      c.createEl("label", { text: title });
      return c;
    };
    const text = (c: HTMLElement, placeholder: string, on: (v: string) => void) => {
      const i = c.createEl("input", { type: "text", placeholder });
      i.addEventListener("input", () => on(i.value));
      i.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          this.submit();
        }
      });
      return i;
    };
    let focus: HTMLInputElement | undefined;
    const pick = (i: HTMLInputElement) => (focus ??= i);

    const acts = actChoices(this.scenes);
    if (this.bare()) {
      if (acts.length) this.act = String(acts[0]);
    } else {
      const actCell = cell(this.word(0));
      if (this.kind === "act" || !acts.length) {
        this.actIsNew = true;
        pick(text(actCell, `${this.word(0)} name (optional)`, (v) => (this.actName = v)));
      } else {
        const sel = actCell.createEl("select", { cls: "dropdown" });
        for (const a of acts) sel.createEl("option", { value: String(a), text: actTitle(a, this.labels, this.word(0)) });
        sel.createEl("option", { value: NEW, text: `New ${this.word(0).toLowerCase()}…` });
        if (!acts.some((a) => String(a) === this.act)) this.act = String(acts[acts.length - 1]);
        sel.value = this.act;
        const nameBox = actCell.createDiv({ cls: "booker-newitem-name" });
        nameBox.hide();
        text(nameBox, `${this.word(0)} name (optional)`, (v) => (this.actName = v));
        sel.addEventListener("change", () => {
          this.actIsNew = sel.value === NEW;
          if (!this.actIsNew) this.act = sel.value;
          nameBox.toggle(this.actIsNew);
          if (this.actIsNew) nameBox.querySelector("input")?.focus();
          this.fillChapters();
        });
      }
    }

    if (!this.flat()) {
      const chapterCell = cell(this.word(1));
      this.chapterBox = chapterCell;
      if (this.kind === "chapter" || this.kind === "act" || this.actIsNew || !acts.length) {
        this.chapterIsNew = true;
        const i = text(chapterCell, `${this.word(1)} name (optional)`, (v) => (this.chapterName = v));
        if (this.kind === "chapter") pick(i);
      } else {
        this.chapterSel = chapterCell.createEl("select", { cls: "dropdown" });
        this.chapterNameBox = chapterCell.createDiv({ cls: "booker-newitem-name" });
        this.chapterNameBox.hide();
        text(this.chapterNameBox, `${this.word(1)} name (optional)`, (v) => (this.chapterName = v));
        this.fillChapters();
        this.chapterSel.addEventListener("change", () => {
          this.chapterIsNew = this.chapterSel.value === NEW;
          if (!this.chapterIsNew) this.chapter = this.chapterSel.value;
          this.chapterNameBox.toggle(this.chapterIsNew);
          if (this.chapterIsNew) this.chapterNameBox.querySelector("input")?.focus();
        });
      }
    }

    const sceneCell = cell(this.word(2));
    const i = text(sceneCell, this.kind === "scene" ? `${this.word(2)} title` : `First ${this.word(2).toLowerCase()} title (optional)`, (v) => (this.sceneName = v));
    if (this.kind === "scene") pick(i);
    window.setTimeout(() => focus?.focus(), 30);

    new Setting(contentEl).addButton((b) => b.setButtonText("Create").setCta().onClick(() => this.submit()));
  }

  /** Chapters of the chosen act, plus "New…". A new act has no chapters yet, so the dropdown turns into a name box. */
  private fillChapters() {
    const sel = this.chapterSel;
    if (!sel) return;
    sel.empty();
    const existing = this.actIsNew ? [] : chapterChoices(this.scenes, this.act);
    for (const c of existing) sel.createEl("option", { value: String(c), text: chapterTitle(c, this.labels, this.word(1)) });
    sel.createEl("option", { value: NEW, text: `New ${this.word(1).toLowerCase()}…` });
    if (!existing.some((c) => String(c) === this.chapter)) this.chapter = existing.length ? String(existing[existing.length - 1]) : "";
    this.chapterIsNew = !existing.length;
    sel.value = this.chapterIsNew ? NEW : this.chapter;
    this.chapterNameBox?.toggle(this.chapterIsNew);
    sel.toggle(!this.actIsNew);
    if (this.actIsNew) {
      this.chapterIsNew = true;
      this.chapterNameBox?.show();
    }
  }

  private submit() {
    if (this.done) return;
    this.done = true;
    const title = this.sceneName.trim();
    const noActs = !actChoices(this.scenes).length;
    this.close();
    const actIsNew = this.kind === "act" || noActs || this.actIsNew;
    const actName = actIsNew && !this.bare() ? this.actName.trim() || undefined : undefined;
    const chapterName = this.chapterName.trim() || undefined;
    if (actIsNew) {
      this.onSubmit({ title, act: newActNumber(this.scenes), chapter: newChapterNumber(this.scenes), newChapter: true, actName, chapterName });
      return;
    }
    const act = numeric(this.act);
    if (this.kind === "chapter") {
      this.onSubmit({ title, act, chapter: newChapterNumber(this.scenes), newChapter: true, chapterName });
      return;
    }
    const existing = this.flat() || (this.chapter !== "" && !this.chapterIsNew);
    this.onSubmit({ title, act, chapter: existing && this.chapter !== "" ? numeric(this.chapter) : this.flat() ? 1 : newChapterNumber(this.scenes), newChapter: !existing && !this.flat(), chapterName: existing ? undefined : chapterName });
  }

  onClose() {
    this.contentEl.empty();
  }
}
