import { wordsFor } from "../profiles/words";
import { App, Modal, Notice, Setting, TFolder } from "obsidian";
import { parseStoryDate } from "../dates";
import { planMove } from "../project/projectMove";
import { levelsAfterResize, previewLevels, setLevels, changeSeries, findProjects, listSeries, moveProject, profileFor, Project, scriptureOn, setDetectNames, setNumbering, setScripture, setSetupPayoff, setTimelineStart } from "../project/vaultOps";
import { captureScroll, ConfirmModal, FolderPicker, ListPicker, notifyError, settingsGroup } from "../ui";
import { makeLevel, MAX_LEVELS } from "../profiles/structure";
import type { Level } from "../profiles/profile";
import { checkProjectFormat } from "../project/vaultOps";
import { offerFormatFix } from "./formatFix";
import { ImportMarkdownModal } from "./importMarkdownModal";
import type BookerPlugin from "../main";
import { BookerSettingTab } from "../settings";
import { drawFormatControls } from "../writing/formatControls";
import { resolveOpening } from "../writing/initials";
import { ResourceManager } from "./resourceManager";
import { verifyHealth } from "./healthSupport";
import { canUseAnyFolder, makeSink, vaultWriter } from "../backup/service";
import { listBackups, restoreBackup } from "../backup/run";
import type { BackupConfig } from "../backup/plan";

/** One place for a project's own settings: where its timeline starts, where it lives, and (soon) importing chapters. */
export class ProjectSettingsModal extends Modal {
  private start: string;

  constructor(app: App, private proj: Project, private onChanged: (movedTo?: Project) => void, private plugin?: BookerPlugin) {
    super(app);
    this.start = proj.timelineStart ?? "";
  }

  private tab: "project" | "plugin" = "project";

  onOpen() {
    // drawn again after every change: keep the window and the plugin-settings page where they were scrolled
    const restore = captureScroll(this.contentEl);
    const before = this.contentEl.querySelector<HTMLElement>(".booker-set-page")?.scrollTop ?? 0;
    this.build();
    restore();
    if (before) {
      const put = () => {
        const page = this.contentEl.querySelector<HTMLElement>(".booker-set-page");
        if (page) page.scrollTop = before;
      };
      put();
      window.requestAnimationFrame(put);
      window.setTimeout(put, 150);
    }
  }

  private build() {
    const { proj } = this;
    const root = this.contentEl;
    root.empty();
    this.modalEl.addClass("booker-modal");
    root.createEl("h3", { text: `${proj.name}: settings` });
    if (this.plugin) {
      const bar = root.createDiv({ cls: "booker-set-tabs" });
      const plugin = this.plugin;
      for (const [id, label] of [["project", "Project settings"], ["plugin", "Plugin settings"]] as const) {
        const b = bar.createEl("button", { text: label, cls: "booker-set-tab" });
        b.toggleClass("is-active", this.tab === id);
        b.addEventListener("click", () => {
          if (this.tab === id) return;
          this.tab = id;
          this.onOpen();
        });
      }
      if (this.tab === "plugin") {
        // the same settings the Obsidian settings page shows: one stored copy, so a change here is a change there
        new BookerSettingTab(this.app, plugin).renderInto(root.createDiv({ cls: "booker-set-page booker-set-pluginpage" }));
        this.footer(root);
        return;
      }
    }
    // both tabs scroll inside their own box, so the buttons at the bottom stay in view
    this.renderProject(root.createDiv({ cls: "booker-set-page" }), proj);
    this.footer(root);
  }

  /** The buttons at the bottom of either tab: update check and downloads beside Close. */
  private footer(root: HTMLElement) {
    const row = new Setting(root);
    const plugin = this.plugin;
    if (plugin) {
      row.addButton((b) => b.setButtonText("Check for updates").onClick(() => void plugin.updater.checkAndOffer()));
      row.addButton((b) => b.setButtonText("Downloads…").setTooltip("Dictionaries, Bibles, church writings, models and maps you can download").onClick(() => new ResourceManager(plugin).open()));
    }
    row.addButton((b) => b.setButtonText("Close").setCta().onClick(() => this.close()));
  }

  private renderProject(contentEl: HTMLElement, proj: Project) {
    const w = wordsFor(profileFor(proj));
    const lowItem = w.item.toLowerCase();

    // book
    const book = settingsGroup(contentEl, "proj-book", "Book", true);
    new Setting(book)
      .setName("Project health")
      .setDesc("Check citations, footnotes, scripture and file info.")
      .addExtraButton((b) => b.setIcon("stethoscope").setTooltip("Verify project health").onClick(() => this.plugin && void verifyHealth(this.plugin, proj)));
    if (this.plugin) {
      const r = checkProjectFormat(this.app, proj);
      const plugin = this.plugin;
      const row = new Setting(book).setName("Project format").setDesc(r.state === "ok" ? `Up to date (format ${r.current}).` : r.state === "newer" ? `Saved by a newer Booker (format ${r.stored}). Update Booker; the book is left as it is.` : `Saved in format ${r.stored}; this Booker uses ${r.current}. ${r.problems.map((p) => p.message).join(" ")}`);
      if (r.state === "older") row.addButton((b) => b.setButtonText("Back up and update…").setCta().onClick(() => offerFormatFix(plugin, proj, () => { this.onChanged(); this.onOpen(); })));
    }
    const seriesRow = new Setting(book).setName("Series").setDesc(proj.series ? `In the series “${proj.series.name}”.` : "A standalone book.");
    const others = listSeries(findProjects(this.app)).filter((x) => x.folder !== proj.series?.folder);
    if (others.length) seriesRow.addButton((b) => b.setButtonText(proj.series ? "Move to another series…" : "Add to a series…").onClick(() => this.pickSeries(others.map((x) => x.folder))));
    if (proj.series) seriesRow.addButton((b) => b.setButtonText("Make standalone").onClick(() => this.changeSeries(null)));
    const where = new Setting(book).setName("Project folder").setDesc(proj.layout.base);
    if (proj.series) where.setDesc(`${proj.layout.base} (move it with Series)`);
    else where.addButton((b) => b.setButtonText("Move…").onClick(() => this.pickFolder()));

    // structure
    const st = settingsGroup(contentEl, "proj-structure", "Structure", true, "levels, numbering and timeline");
    new Setting(st).setName("Levels").setDesc("Names and depth of the book.").setHeading();
    this.levelsSection(st);
    new Setting(st).setName("Numbering and timeline").setHeading();
    new Setting(st)
      .setName(`Number ${w.itemMany.toLowerCase()}`)
      .setDesc(`Count ${lowItem}s through the whole book: “${w.item} 3 - The Title”.`)
      .addToggle((t) =>
        t.setValue(!!proj.numberScenes).onChange((v) => {
          void setNumbering(this.app, proj, v).then(() => this.onChanged(), (e) => notifyError(e, "save the setting"));
        })
      );
    new Setting(st)
      .setName("Setup and payoff")
      .setDesc("Mark setups and payoffs on plotlines and show the matching checks.")
      .addToggle((t) =>
        t.setValue(!!proj.setupPayoff).onChange((v) => {
          proj.setupPayoff = v;
          void setSetupPayoff(this.app, proj, v).then(() => this.onChanged(), (e) => notifyError(e, "save the setting"));
        })
      );
    let note: HTMLElement;
    new Setting(st)
      .setName("Timeline starts")
      .setDesc("The date “Day 1” counts from, such as 2031-04-02 or 1850. Empty for none.")
      .addText((t) => {
        t.setPlaceholder("e.g. 2031-04-02").setValue(this.start).onChange((v) => {
          this.start = v;
          const d = v.trim() ? parseStoryDate(v.trim()) : null;
          note.setText(!v.trim() ? "" : d ? `Understood as ${d.display}.` : "Not understood. Try 2031-04-02, 4/2/2031, Apr 2 2031 or 1850.");
          note.toggleClass("mod-warning", !!v.trim() && !d);
        });
      })
      .addButton((b) => b.setButtonText("Save").setCta().onClick(() => this.saveStart()));
    note = st.createDiv({ cls: "booker-muted" });

    // writing format: this project's own, or the plugin default
    if (this.plugin) {
      const plugin = this.plugin;
      const wf = settingsGroup(contentEl, "proj-writing", "Writing format", false, "indents, spacing, font and the large first letter");
      const own = plugin.projectFormat(proj);
      new Setting(wf)
        .setName("Use the plugin default")
        .setDesc("On: this project follows the default in Plugin settings, and changes to it. Off: this project has its own writing format.")
        .addToggle((t) =>
          t.setValue(!own).onChange(async (v) => {
            await plugin.setProjectFormat(proj, v ? null : plugin.effectiveFormat(proj.file.path));
            this.onOpen();
          })
        );
      if (own) {
        const eff = () => plugin.effectiveFormat(proj.file.path);
        drawFormatControls(
          wf,
          wf,
          eff,
          async (patch) => {
            const cur = eff();
            await plugin.setProjectFormat(proj, { writing: { ...cur.writing, ...patch.writing }, opening: resolveOpening({ ...cur.opening, ...patch.opening }) });
          },
          () => this.onOpen()
        );
        new Setting(wf)
          .setName("Make this the plugin default")
          .setDesc("Copies these choices to the plugin default. Every project that uses the default changes with it, and this project goes back to using the default.")
          .addButton((b) =>
            b.setButtonText("Set as default").onClick(async () => {
              const cur = eff();
              plugin.settings.writing = { ...cur.writing };
              plugin.settings.opening = cur.opening;
              await plugin.persist();
              await plugin.setProjectFormat(proj, null);
              this.onOpen();
            })
          );
      }
    }

    // writing aids
    const aids = settingsGroup(contentEl, "proj-aids", "Writing aids", false);
    new Setting(aids)
      .setName("Characters and places")
      .setDesc("Add names from your world notes to a scene's properties as you write.")
      .addToggle((t) =>
        t.setValue(proj.detectNames ?? this.plugin?.settings.detectNames ?? true).onChange((v) => {
          void setDetectNames(this.app, proj, v).then(() => this.onChanged(), (e) => notifyError(e, "save the setting"));
        })
      );
    new Setting(aids)
      .setName("Bible verses")
      .setDesc("Spot scripture references and offer the verses.")
      .addToggle((t) =>
        t.setValue(scriptureOn(proj)).onChange((v) => {
          void setScripture(this.app, proj, v).then(() => this.onChanged(), (e) => notifyError(e, "save the setting"));
        })
      );

    if (this.plugin) this.backupSection(settingsGroup(contentEl, "proj-backups", "Backups", false));

    const imp = settingsGroup(contentEl, "proj-import", "Import", false);
    new Setting(imp)
      .setName("Import a manuscript")
      .setDesc(`Headings become titles; text between breaks becomes ${w.item} 1, ${w.item} 2…`)
      .addButton((b) => b.setButtonText("Import…").onClick(() => new ImportMarkdownModal(this.app, proj, this.plugin, () => this.onChanged()).open()));

  }

  /** Name each level, and add or remove levels. Fewer levels merge scenes into chapters; more split chapters at their scene breaks. */
  private levelsSection(el: HTMLElement) {
    const proj = this.proj;
    const levels = profileFor(proj).levels;
    const roles = levels.length === 3 ? ["Top", "Middle", "Items"] : levels.length === 2 ? ["Top", "Items"] : ["Items"];
    const pl = levels.map((l) => l.plural);
    el.createDiv({ cls: "booker-muted", text: levels.length === 3 ? `${pl[0]} hold ${pl[1]}, ${pl[1]} hold ${pl[2]}.` : levels.length === 2 ? `${pl[0]} hold ${pl[1]}.` : `Just ${pl[0]}.` });
    levels.forEach((l, i) => {
      const row = el.createDiv({ cls: "booker-levels-row" });
      row.createSpan({ cls: "booker-levels-role", text: roles[i] });
      const input = row.createEl("input", { type: "text", value: l.singular });
      input.addEventListener("change", () => {
        const v = input.value.trim();
        if (!v || v.toLowerCase() === l.singular) return void (input.value = l.singular);
        void this.runLevels(levels.map((x, j) => (j === i ? makeLevel(v) : x)), "Renamed.");
      });
    });
    const count = el.createDiv({ cls: "booker-levels-count" });
    count.createSpan({ text: `${levels.length} level${levels.length === 1 ? "" : "s"}` });
    const minus = count.createEl("button", { text: "−", attr: { "aria-label": "Fewer levels" } });
    const plus = count.createEl("button", { text: "+", attr: { "aria-label": "More levels" } });
    minus.disabled = levels.length <= 1;
    plus.disabled = levels.length >= MAX_LEVELS;
    minus.addEventListener("click", () => void this.resize(levels.length - 1));
    plus.addEventListener("click", () => void this.resize(levels.length + 1));
  }

  private async resize(count: number) {
    const proj = this.proj;
    const cur = profileFor(proj).levels;
    const next = levelsAfterResize(proj, count);
    const brk = this.plugin?.settings.sceneBreak || "* * *";
    const pv = await previewLevels(this.app, proj, next);
    const names = (ls: typeof cur) => ls.map((l) => l.plural).join(" › ");
    let body = `${names(cur)}  →  ${names(next)}\n\n`;
    if (next.length < cur.length && cur.length === 3) body += `${pv.merges} scene note${pv.merges === 1 ? " is" : "s are"} joined into ${pv.chapters} ${cur[1].singular}${pv.chapters === 1 ? "" : "s"}, separated by “${brk}”. The merged-away notes and their properties go to the project's Archive.`;
    else if (next.length < cur.length) body += `The top level is hidden. Acts stay on the notes, so adding it back restores them.`;
    else if (cur.length === 2) body += `Each ${cur[1].singular} is split into ${next[2].plural} at its scene breaks (***, ---, * * *): ${pv.splits} ${cur[1].singular}${pv.splits === 1 ? "" : "s"} become ${pv.scenes} ${next[2].plural} in all. One with no break stays one ${next[2].singular}.`;
    else body += `A new top level is added. Everything goes in its first ${next[0].singular}.`;
    new ConfirmModal(this.app, "Change levels?", body, "Change", () => void this.runLevels(next, "Levels changed.")).open();
  }

  private async runLevels(next: Level[], done: string) {
    try {
      const r = await setLevels(this.app, this.proj, next, { sceneBreak: this.plugin?.settings.sceneBreak || "* * *" });
      new Notice(`Booker: ${done}${r.merged ? ` ${r.merged} notes merged.` : ""}${r.scenes ? ` ${r.scenes} scenes.` : ""}`);
      this.onChanged();
      this.contentEl.empty();
      this.onOpen();
    } catch (e) {
      notifyError(e, "change the levels");
    }
  }

  private backupSection(el: HTMLElement) {
    const plugin = this.plugin!;
    const proj = this.proj;
    let cfg: BackupConfig = plugin.backupConfig(proj);
    const save = () => void plugin.setBackupConfig(proj, cfg);
    const anywhere = canUseAnyFolder();
    let dirInput: HTMLInputElement;
    const status = el.createDiv({ cls: "booker-muted" });
    const showStatus = () => status.setText(cfg.lastAt ? `Last backup ${new Date(cfg.lastAt).toLocaleString()}. ${cfg.lastNote ?? ""}` : "No backup yet.");

    const folder = new Setting(el)
      .setName("Backup folder")
      .setDesc(anywhere ? "A folder on this computer, such as /Users/you/Backups. Backups are kept in a folder named after the project." : "A folder inside this vault (this device cannot write elsewhere).")
      .addText((t) => {
        dirInput = t.inputEl;
        t.setPlaceholder(anywhere ? "/path/to/folder" : "Backups").setValue(cfg.dir).onChange((v) => {
          cfg = { ...cfg, dir: v.trim() };
          save();
        });
      });
    if (anywhere)
      folder.addButton((b) =>
        b.setButtonText("Browse…").onClick(async () => {
          try {
            const dialog = (window as any).require("electron").remote?.dialog;
            if (!dialog) return void new Notice("Booker: type the folder path instead.");
            const r = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
            if (r.canceled || !r.filePaths[0]) return;
            dirInput.value = r.filePaths[0];
            cfg = { ...cfg, dir: r.filePaths[0] };
            save();
          } catch {
            new Notice("Booker: type the folder path instead.");
          }
        })
      );
    else
      folder.addButton((b) =>
        b.setButtonText("Choose…").onClick(() => {
          const folders = this.app.vault.getAllLoadedFiles().filter((f): f is TFolder => f instanceof TFolder && !f.path.startsWith(".") && !(f.path === proj.layout.base || f.path.startsWith(proj.layout.base + "/")));
          new FolderPicker(this.app, folders, "Back up into which folder?", (f) => {
            dirInput.value = f.path;
            cfg = { ...cfg, dir: f.path };
            save();
          }).open();
        })
      );

    new Setting(el)
      .setName("How often")
      .setDesc("Runs while Obsidian is open, and catches up when it starts. Nothing is copied if nothing changed.")
      .addDropdown((d) =>
        d
          .addOptions({ manual: "Only when I press Back up now", hourly: "Every hour", daily: "Every day", weekly: "Every week" })
          .setValue(cfg.schedule)
          .onChange((v) => {
            cfg = { ...cfg, schedule: v as BackupConfig["schedule"] };
            save();
          })
      );
    new Setting(el)
      .setName("Kind of backup")
      .setDesc("Full: a zip of everything each time. Incremental: one full zip, then only the files that changed, with a new full zip every 10 runs.")
      .addDropdown((d) =>
        d
          .addOptions({ incremental: "Incremental", full: "Full" })
          .setValue(cfg.mode)
          .onChange((v) => {
            cfg = { ...cfg, mode: v as BackupConfig["mode"] };
            save();
          })
      );
    new Setting(el)
      .setName("Full backups to keep")
      .setDesc("Older ones, and the incremental backups that depend on them, are deleted.")
      .addText((t) =>
        t.setValue(String(cfg.keep)).onChange((v) => {
          const n = Math.floor(Number(v));
          if (n >= 1 && n <= 100) {
            cfg = { ...cfg, keep: n };
            save();
          }
        })
      );
    if (proj.series)
      new Setting(el)
        .setName("Include the series Codex")
        .setDesc("This book shares its characters and places with the series.")
        .addToggle((t) =>
          t.setValue(cfg.includeCodex).onChange((v) => {
            cfg = { ...cfg, includeCodex: v };
            save();
          })
        );

    new Setting(el)
      .addButton((b) =>
        b
          .setButtonText("Back up now")
          .setCta()
          .onClick(async () => {
            b.setDisabled(true);
            await plugin.backupNow(proj);
            cfg = plugin.backupConfig(proj);
            showStatus();
            b.setDisabled(false);
          })
      )
      .addButton((b) => b.setButtonText("Restore…").onClick(() => void this.restore(cfg)));
    showStatus();
  }

  private async restore(cfg: BackupConfig) {
    if (!cfg.dir.trim()) return void new Notice("Booker: choose a backup folder first.");
    try {
      const sink = makeSink(this.app, cfg.dir);
      const found = (await listBackups(sink, this.proj.name)).reverse();
      if (!found.length) return void new Notice("Booker: no backups of this project in that folder yet.");
      new ListPicker(this.app, found, (b) => `${b.stamp} (${b.kind})`, "Restore which backup?", (b) => {
        const base = this.proj.layout.base;
        let into = `${base} restored ${b.stamp.slice(0, 10)}`;
        for (let i = 2; this.app.vault.getAbstractFileByPath(into); i++) into = `${base} restored ${b.stamp.slice(0, 10)} ${i}`;
        void restoreBackup(sink, this.proj.name, vaultWriter(this.app), into, b.stamp)
          .then((n) => new Notice(n === null ? "Booker: that backup could not be read." : `Restored ${n} files into “${into}”. Your project was not changed.`))
          .catch((e) => notifyError(e, "restore the backup"));
      }).open();
    } catch (e) {
      notifyError(e, "read the backups");
    }
  }

  private async saveStart() {
    const text = this.start.trim();
    if (text && !parseStoryDate(text)) return void new Notice("Booker: that date was not understood. Try 2031-04-02, 4/2/2031 or 1850.");
    try {
      await setTimelineStart(this.app, this.proj, text);
      new Notice(text ? `Timeline starts ${parseStoryDate(text)!.display}.` : "Timeline start cleared.");
      this.onChanged();
    } catch (e) {
      notifyError(e, "save the start date");
    }
  }

  private pickSeries(folders: string[]) {
    const list = folders.map((f) => this.app.vault.getAbstractFileByPath(f)).filter((f): f is TFolder => f instanceof TFolder);
    new FolderPicker(this.app, list, "Which series?", (f) => this.changeSeries(f.path)).open();
  }

  private changeSeries(target: string | null) {
    const { proj } = this;
    const to = target ? `the series “${target.split("/").pop()}”` : "a standalone book";
    const codex = target && !proj.series ? " Its Codex entries (characters, places) join the series' shared Codex." : target ? "" : " The series' shared Codex stays with the series; the book gets an empty Codex of its own.";
    new ConfirmModal(this.app, "Change series", `Make “${proj.name}” ${to === "a standalone book" ? to : "a book in " + to}? Its folder moves.${codex}`, "Move", () => {
      void changeSeries(this.app, proj, target)
        .then((r) => {
          new Notice(r.codexLeft ? `Moved. ${r.codexLeft} Codex ${r.codexLeft === 1 ? "entry was" : "entries were"} left in the book because the series already has one with that name.` : "Moved.");
          this.close();
          this.onChanged(r.project);
        })
        .catch((e) => notifyError(e, "change the series"));
    }).open();
  }

  private pickFolder() {
    const base = this.proj.layout.base;
    const folders = this.app.vault.getAllLoadedFiles().filter((f): f is TFolder => f instanceof TFolder && !f.path.startsWith(".") && !(f.path === base || f.path.startsWith(base + "/")));
    new FolderPicker(this.app, folders, "Move the project into which folder?", (folder) => {
      const plan = planMove(base, folder.path);
      if ("error" in plan) return void new Notice(`Booker: ${plan.error}`);
      if (this.app.vault.getAbstractFileByPath(plan.to)) return void new Notice(`Booker: “${plan.to}” already exists.`);
      if (this.app.vault.getFileByPath(`${folder.path === "/" ? "" : folder.path + "/"}series.json`.replace(/^\//, ""))) return void new Notice("Booker: that folder is a series. Add books to a series with New project.");
      new ConfirmModal(this.app, "Move project", `Move “${this.proj.name}” from ${base} to ${plan.to}? Everything inside moves with it, and links to its notes are updated.`, "Move", () => {
        void moveProject(this.app, this.proj, plan.to)
          .then((p) => {
            new Notice(`Moved to ${plan.to}.`);
            this.close();
            this.onChanged(p);
          })
          .catch((e) => notifyError(e, "move the project"));
      }).open();
    }).open();
  }

  onClose() {
    this.contentEl.empty();
  }
}
