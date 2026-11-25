import { App, Modal, Notice, Setting, TFolder } from "obsidian";
import { FolderPicker } from "../ui";
import { parseStoryDate } from "../dates";
import { allProfiles, DEFAULT_PROFILE, levelName, profileById } from "../profiles/profile";
import { STYLES } from "../citations/styles";
import type { SeriesInfo } from "../project/series";
import type BookerPlugin from "../main";
import { ResourcesPanel } from "./resourceManager";
import { levelsFromNames, MAX_LEVELS, presetNames } from "../profiles/structure";
import type { Level } from "../profiles/profile";
import type { Schedule } from "../backup/plan";
import { canUseAnyFolder } from "../backup/service";

export interface NewProject {
  name: string;
  /** the folder the book is made in (ignored when it joins an existing series, which has its own folder) */
  root: string;
  series?: { folder?: string; newName?: string };
  /** where the book's timeline starts (a date as typed), or empty */
  timelineStart: string;
  /** the id of the kind of book (its profile) */
  profile: string;
  /** how citations are written; the kind of book's own style unless changed */
  citationStyle: string;
  /** empty chapters (sections or entries in a two-level book) to start with */
  starterChapters: number;
  /** the levels of the book and what they are called */
  levels: Level[];
  /** a name for the first top-level part (act, series, week…), or empty */
  firstActName: string;
  /** automatic backups of this book: on unless switched off, to a folder, on a schedule */
  backup: { enabled: boolean; dir: string; schedule: Exclude<Schedule, "manual"> };
}

const USUAL = "__usual__";
const STANDALONE = "";
const NEW_SERIES = "__new__";

const STEPS = ["Your book", "Structure", "Series & place", "Citations & timeline", "Backups", "Downloads", "Review"] as const;

const SCHEDULES: Record<Exclude<Schedule, "manual">, string> = { hourly: "Every hour", daily: "Every day", weekly: "Every week" };

/** Start a book in a few short cards: name and kind, structure, series, citations and timeline, backups, then a summary. Next moves on; Back keeps what was typed. */
export class NewProjectModal extends Modal {
  private name = "";
  private where: string;
  private seriesName = "";
  private start = "";
  private profile = DEFAULT_PROFILE;
  private citation = "";
  private starter = 0;
  private names: string[] = ["act", "chapter", "scene"];
  private firstAct = "";
  private step = 0;
  private backupOn = true;
  private backupSchedule: Exclude<Schedule, "manual"> = "daily";
  private holder!: HTMLElement;
  private panel: ResourcesPanel | null = null;

  constructor(app: App, private series: SeriesInfo[], private onSubmit: (p: NewProject) => void, preferSeries?: string, private root = "Booker", private backupDir = "", private plugin?: BookerPlugin) {
    super(app);
    this.where = preferSeries ?? STANDALONE;
    this.resetStructure();
  }

  private prof() {
    return profileById(allProfiles(), this.profile);
  }

  onOpen() {
    this.modalEl.addClass("booker-wizard");
    this.contentEl.createEl("h3", { text: "New project" });
    this.holder = this.contentEl.createDiv();
    this.draw();
  }

  /** Why this card cannot be left yet, or null. */
  private blocker(step: number): string | null {
    if (step === 0 && !this.name.trim()) return "Give the book a name to continue.";
    if (step === 2 && this.where === NEW_SERIES && !this.seriesName.trim()) return "Name the new series to continue.";
    if (step === 3 && this.start.trim() && !parseStoryDate(this.start.trim())) return "The timeline start is not understood. Fix it or leave it empty.";
    if (step === 4 && this.backupOn && !this.backupDir.trim()) return "Choose a backup folder, or turn automatic backups off.";
    return null;
  }

  private go(to: number) {
    if (to > this.step) for (let i = this.step; i < to; i++) {
      const why = this.blocker(i);
      if (why) {
        this.step = i;
        this.draw();
        new Notice(`Booker: ${why}`);
        return;
      }
    }
    this.step = Math.max(0, Math.min(STEPS.length - 1, to));
    this.draw();
  }

  private draw() {
    const h = this.holder;
    h.empty();
    const dots = h.createDiv({ cls: "booker-wizard-steps" });
    STEPS.forEach((label, i) => {
      const d = dots.createEl("button", { cls: `booker-wizard-dot${i === this.step ? " is-current" : ""}${i < this.step ? " is-done" : ""}`, text: String(i + 1), attr: { "aria-label": label, title: label } });
      d.addEventListener("click", () => this.go(i));
    });
    h.createEl("h4", { cls: "booker-wizard-title", text: `${this.step + 1} of ${STEPS.length} · ${STEPS[this.step]}` });
    const card = h.createDiv({ cls: "booker-wizard-card" });
    this.panel?.destroy();
    this.panel = null;
    [this.cardBasics, this.cardStructure, this.cardSeries, this.cardCitations, this.cardBackups, this.cardDownloads, this.cardReview][this.step].call(this, card);
    const nav = new Setting(h);
    nav.settingEl.addClass("booker-wizard-nav");
    nav.addButton((b) => b.setButtonText("Back").setDisabled(this.step === 0).onClick(() => this.go(this.step - 1)));
    if (this.step < STEPS.length - 1) nav.addButton((b) => b.setButtonText("Next").setCta().onClick(() => this.go(this.step + 1)));
    else nav.addButton((b) => b.setButtonText("Create book").setCta().onClick(() => this.submit()));
  }

  private enterToNext(input: HTMLInputElement) {
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.go(this.step + 1);
      }
    });
  }

  private cardBasics(el: HTMLElement) {
    el.createEl("p", { cls: "booker-muted", text: "A project is one book. Books of a series share their characters and places, and can be viewed together." });
    new Setting(el).setName("Book name").addText((t) => {
      t.setPlaceholder("Name").setValue(this.name).onChange((v) => (this.name = v));
      this.enterToNext(t.inputEl);
      window.setTimeout(() => t.inputEl.focus(), 30);
    });
    new Setting(el)
      .setName("Kind of book")
      .setDesc(this.prof().description ?? "")
      .addDropdown((d) => {
        for (const p of allProfiles()) d.addOption(p.id, p.name);
        d.setValue(this.profile);
        d.onChange((v) => {
          this.profile = v;
          this.citation = "";
          this.resetStructure();
          const desc = d.selectEl.closest(".setting-item")?.querySelector(".setting-item-description");
          if (desc) desc.textContent = this.prof().description ?? "";
        });
      });
  }

  private cardStructure(el: HTMLElement) {
    el.createEl("p", { cls: "booker-muted", text: "How the book is divided. Each level has a name you can change; you can rename them later too." });
    const starterRow = new Setting(el).setDesc("Optional. Makes this many empty ones to start from; you can add and rename more later.");
    const syncStarter = () => {
      const levels = levelsFromNames(this.names);
      starterRow.setName(`Starting ${levelName({ ...this.prof(), levels }, levels.length > 2 ? 1 : levels.length - 1, true).toLowerCase()}`);
    };
    const holder = el.createDiv({ cls: "booker-structure" });
    const row = new Setting(holder).setName("Levels");
    const ctl = row.controlEl.createDiv({ cls: "booker-levels" });
    const minus = ctl.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "Remove a level" }, text: "−" });
    const boxes = ctl.createDiv({ cls: "booker-levels-names" });
    const plus = ctl.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "Add a level" }, text: "+" });
    const firstRow = new Setting(holder).setName("First part").addText((t) => t.setPlaceholder("Name (optional)").setValue(this.firstAct).onChange((v) => (this.firstAct = v)));
    const paint = () => {
      boxes.empty();
      this.names.forEach((n, i) => {
        const inp = boxes.createEl("input", { type: "text", value: n, attr: { "aria-label": `Level ${i + 1}` } });
        inp.addEventListener("input", () => {
          this.names[i] = inp.value;
          if (i === 0) firstRow.setName(`First ${(inp.value || "part").trim()}`);
          syncStarter();
        });
      });
      minus.disabled = this.names.length <= 1;
      plus.disabled = this.names.length >= MAX_LEVELS;
      firstRow.settingEl.toggle(this.names.length >= 2);
      firstRow.setName(`First ${(this.names[0] || "part").trim()}`);
      syncStarter();
    };
    const resize = (n: number) => {
      this.names = presetNames(this.profile, this.prof().levels, n);
      paint();
    };
    minus.addEventListener("click", () => this.names.length > 1 && resize(this.names.length - 1));
    plus.addEventListener("click", () => this.names.length < MAX_LEVELS && resize(this.names.length + 1));
    el.appendChild(starterRow.settingEl);
    starterRow.addText((t) => {
      t.inputEl.type = "number";
      t.inputEl.min = "0";
      t.setPlaceholder("0").setValue(this.starter ? String(this.starter) : "").onChange((v) => (this.starter = Math.max(0, Math.min(60, parseInt(v, 10) || 0))));
    });
    paint();
  }

  private cardSeries(el: HTMLElement) {
    let seriesRow: Setting;
    let rootRow: Setting;
    const syncRoot = () => rootRow.settingEl.toggle(!this.where || this.where === NEW_SERIES);
    new Setting(el).setName("Belongs to").addDropdown((d) => {
      d.addOption(STANDALONE, "Nothing: a standalone book");
      for (const s of this.series) d.addOption(s.folder, `Series: ${s.name} (next book)`);
      d.addOption(NEW_SERIES, "A new series…");
      d.setValue(this.where);
      d.onChange((v) => {
        this.where = v;
        seriesRow.settingEl.toggle(v === NEW_SERIES);
        syncRoot();
      });
    });
    seriesRow = new Setting(el).setName("Series name").setDesc("Becomes the series folder; this book goes inside it.").addText((t) => t.setPlaceholder("Series name").setValue(this.seriesName).onChange((v) => (this.seriesName = v)));
    seriesRow.settingEl.toggle(this.where === NEW_SERIES);
    let rootInput: HTMLInputElement;
    rootRow = new Setting(el)
      .setName("Create in folder")
      .setDesc("The folder the book is made in. It is made if it does not exist. A book added to an existing series goes in that series' folder.")
      .addText((t) => {
        rootInput = t.inputEl;
        t.setPlaceholder("Booker").setValue(this.root).onChange((v) => (this.root = v.trim()));
      })
      .addButton((b) =>
        b.setButtonText("Choose…").onClick(() => {
          const folders = this.app.vault.getAllLoadedFiles().filter((f): f is TFolder => f instanceof TFolder && !!f.path && !f.path.startsWith("."));
          new FolderPicker(this.app, folders, "Create the book in which folder?", (f) => {
            this.root = f.path;
            rootInput.value = f.path;
          }).open();
        })
      );
    syncRoot();
  }

  private cardCitations(el: HTMLElement) {
    new Setting(el)
      .setName("Citation style")
      .setDesc("How [@key] citations print on export. You can change it for any one export.")
      .addDropdown((d) => {
        d.selectEl.addClass("booker-select-fit");
        d.addOption(USUAL, `${STYLES.find((s) => s.id === this.prof().citationStyle)?.name ?? ""} (this kind of book's usual)`);
        for (const s of STYLES) d.addOption(s.id, s.name);
        d.setValue(this.citation || USUAL);
        d.onChange((v) => (this.citation = v === USUAL ? "" : v));
      });
    let note: HTMLElement;
    new Setting(el)
      .setName("Timeline starts")
      .setDesc("Optional. The date the story's timeline begins, for example 2031-04-02 or 1850. It is what “Day 1”, “Week 1” and “Year 2” are counted from when you give scenes dates like Day 3, Week 2 or Year 2. You can change it later.")
      .addText((t) => {
        t.setPlaceholder("e.g. 2031-04-02").setValue(this.start).onChange((v) => {
          this.start = v;
          const d = v.trim() ? parseStoryDate(v.trim()) : null;
          note.setText(!v.trim() ? "" : d ? `Understood as ${d.display}.` : "Not understood. Try 2031-04-02, 4/2/2031, Apr 2 2031 or 1850.");
          note.toggleClass("mod-warning", !!v.trim() && !d);
        });
      });
    note = el.createDiv({ cls: "booker-muted" });
  }

  private cardBackups(el: HTMLElement) {
    el.createEl("p", { cls: "booker-muted", text: "Booker backs the book up automatically so a slip never costs you the manuscript. Backups are on by default and go to the folder below. You can change any of this later in Project settings." });
    let dirRow: Setting;
    let schedRow: Setting;
    const sync = () => {
      dirRow.settingEl.toggle(this.backupOn);
      schedRow.settingEl.toggle(this.backupOn);
    };
    new Setting(el).setName("Back up this book automatically").addToggle((t) =>
      t.setValue(this.backupOn).onChange((v) => {
        this.backupOn = v;
        sync();
      })
    );
    let input: HTMLInputElement;
    dirRow = new Setting(el)
      .setName("Backup folder")
      .setDesc(canUseAnyFolder() ? "A folder on this computer. Backups are kept in a folder named after the book." : "A folder inside this vault (this device cannot write elsewhere).")
      .addText((t) => {
        input = t.inputEl;
        t.setPlaceholder("/path/to/folder").setValue(this.backupDir).onChange((v) => (this.backupDir = v.trim()));
      });
    if (canUseAnyFolder())
      dirRow.addButton((b) =>
        b.setButtonText("Browse…").onClick(async () => {
          try {
            const dialog = (window as any).require("electron").remote?.dialog;
            if (!dialog) return void new Notice("Booker: type the folder path instead.");
            const r = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
            if (r.canceled || !r.filePaths[0]) return;
            this.backupDir = r.filePaths[0];
            input.value = r.filePaths[0];
          } catch {
            new Notice("Booker: type the folder path instead.");
          }
        })
      );
    schedRow = new Setting(el).setName("How often").addDropdown((d) => {
      for (const [k, v] of Object.entries(SCHEDULES)) d.addOption(k, v);
      d.setValue(this.backupSchedule).onChange((v) => (this.backupSchedule = v as typeof this.backupSchedule));
    });
    sync();
  }

  /** The Resource manager as a step: models, dictionaries, Bibles, church writings and maps, with one button for all of it. Downloads carry on in the background after the book is made. */
  private cardDownloads(el: HTMLElement) {
    if (!this.plugin) return void el.createEl("p", { cls: "booker-muted", text: "Downloads are in the Resource manager, from the Library card or the project settings." });
    el.createEl("p", { cls: "booker-muted", text: "Optional. Get what you want now, or skip this and use the Resource manager later." });
    this.panel = new ResourcesPanel(this.plugin, el.createDiv({ cls: "booker-wizard-resources" }));
    this.panel.mount();
  }

  onClose() {
    this.panel?.destroy();
    this.contentEl.empty();
  }

  private cardReview(el: HTMLElement) {
    const levels = levelsFromNames(this.names);
    const series = this.where === NEW_SERIES ? `New series “${this.seriesName.trim()}”` : this.where ? `Next book of ${this.series.find((s) => s.folder === this.where)?.name ?? "a series"}` : "Standalone book";
    const rows: [string, string][] = [
      ["Book", this.name.trim()],
      ["Kind", this.prof().name],
      ["Structure", levels.map((l) => l.singular).join(" › ") + (this.starter ? ` (starting with ${this.starter})` : "") + (this.firstAct.trim() && levels.length >= 2 ? `, first ${levels[0].singular}: ${this.firstAct.trim()}` : "")],
      ["Belongs to", series],
      ...(!this.where || this.where === NEW_SERIES ? [["Created in", this.root || "(vault root)"] as [string, string]] : []),
      ["Citations", this.citation ? (STYLES.find((s) => s.id === this.citation)?.name ?? this.citation) : `${STYLES.find((s) => s.id === this.prof().citationStyle)?.name ?? "the usual style"} (usual)`],
      ["Timeline starts", this.start.trim() || "not set"],
      ["Backups", this.backupOn ? `${SCHEDULES[this.backupSchedule]}, to ${this.backupDir || "(no folder)"}` : "off"],
    ];
    const dl = el.createEl("dl", { cls: "booker-wizard-review" });
    for (const [k, v] of rows) {
      dl.createEl("dt", { text: k });
      dl.createEl("dd", { text: v });
    }
    el.createEl("p", { cls: "booker-muted", text: "Use Back or the numbered dots to change anything." });
  }

  /** the kind of book's own levels become the starting point of the structure */
  private resetStructure() {
    const levels = profileById(allProfiles(), this.profile).levels;
    this.names = presetNames(this.profile, levels, levels.length);
    this.firstAct = "";
  }

  private submit() {
    for (let i = 0; i < STEPS.length - 1; i++) {
      const why = this.blocker(i);
      if (why) return this.go(i), void new Notice(`Booker: ${why}`);
    }
    const name = this.name.trim();
    this.close();
    this.onSubmit({
      levels: levelsFromNames(this.names),
      firstActName: this.names.length >= 2 ? this.firstAct.trim() : "",
      citationStyle: this.citation,
      starterChapters: this.starter,
      profile: this.profile,
      timelineStart: this.start.trim(),
      name,
      root: this.root.replace(/^\/+|\/+$/g, ""),
      series: this.where === NEW_SERIES ? { newName: this.seriesName.trim() } : this.where ? { folder: this.where } : undefined,
      backup: { enabled: this.backupOn, dir: this.backupDir.trim(), schedule: this.backupSchedule },
    });
  }

}
