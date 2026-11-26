import { VIEW_CHECKS } from "./checks";
import { makeFoldable } from "./cards";
import { allProfiles, hasView, levelName, profileById, statusesFor, type Profile, type ViewId } from "../profiles/profile";
import { VIEW_INSPECTOR } from "./inspector";
import { VIEW_STATS } from "./stats";
import { ItemView, Menu, Notice, Platform, TFile, WorkspaceLeaf, debounce, normalizePath, setIcon } from "obsidian";
import { safeName } from "../text";
import { currentStreak, dayKey } from "../stats";
import { clock, isDone, lengthLabel, msLeft, pace, SPRINT_LENGTHS, sprintWords } from "../sprint";
import type BookerPlugin from "../main";
import { openNoteIn } from "../openTarget";
import { BulkSummaryModal } from "./bulkSummaryModal";
import { NewItemModal } from "./newItemModal";
import { NewProjectModal } from "./newProjectModal";
import { ProjectSettingsModal } from "./projectSettings";
import { ImportModal } from "./importModal";
import { CodexCategoryModal, DEFAULT_SEQUENCE, type SequenceOption } from "./codexCategoryModal";
import { SequenceItemModal } from "./sequenceModal";
import { isEnabled } from "../project/sequence";
import { SeriesSettingsModal } from "./seriesSettings";
import { VIEW_BOARD } from "./board";
import { VIEW_PLOTLINES } from "./plotlines";
import { VIEW_FAMILY } from "./family";
import { VIEW_TIMELINE_MAP } from "./timelineMap";
import { VIEW_WORLD_MAP } from "./worldMap";
import { defaultOptions, ExportModal, runExport } from "../export/exportModal";
import { TaskViewer } from "./taskViewer";
import { defaultBackupDir } from "../backup/service";
import { drawFormatBanner } from "./formatFix";
import { describeStats, healthStats } from "../project/health";
import { rebuildProject, scanProjects } from "./healthSupport";
import { actionBtn, actionRow, ConfirmModal, NamePrompt, notifyError } from "../ui";
import type { WorldKind } from "../project/world";
import { hasMiddleLevel, hasTopLevel } from "../profiles/structure";
import { wordsFor } from "../profiles/words";
import { actTitle, chapterTitle, compareScenes, planMove, planMoveChapter, positionInAct, setLabel } from "../project/format";
import { addTask, hideStep, readTasks, removeTask, showSteps, toggleTask, writeTasks, type TaskFile } from "../project/tasks";
import { checklist, continueScene, groupScenes, HubScene, nextSceneSlot, progress, statusCounts } from "../project/hubModel";
import { applyChapterPlan, applyMoves, deleteScene, getModel, mergeWithAbove, moveActTo, profileFor, renameScene, swapActs, syncActFolders, toRefs, updateLabels, moveTitleToChapter, codexFiles, createCodex, createWorldCategory, createWorldEntry, createFromTemplate, readTemplates, sequenceChoices, removeKindSequence, setKindSequence, templateOfKind, aliasSuggestOn, setAliasSuggest, renameWorldEntry, worldEntries, worldKinds, createProject, createProjectNote, createMatter, deleteMatter, moveMatter, moveMatterTo, readMatter, renameMatter, setMatterEnabled, createSceneNamed, listProjectNotes, findProjects, getLabels, listSeries, Project, readScenes, seriesBooks, activeSheet } from "../project/vaultOps";

export const VIEW_HUB = "booker-hub";
export type HubLayout = "home" | "sidebar";

function el<K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = parent.createEl(tag, { cls });
  if (text !== undefined) e.setText(text);
  return e;
}

function button(parent: HTMLElement, label: string, icon: string | null, onClick: () => void, cls = ""): HTMLButtonElement {
  const b = el(parent, "button", `booker-btn ${cls}`.trim());
  if (icon) setIcon(el(b, "span", "booker-hub-ico"), icon);
  el(b, "span", undefined, label);
  b.addEventListener("click", onClick);
  return b;
}

const fmt = (n: number) => n.toLocaleString();

/** The project hub: where a writer starts. One view, two layouts (home page tab or left sidebar), switched with a button. */
export class HubView extends ItemView {
  private projectPath: string | null = null;
  private worldKind = "characters";
  /** the Plan bar: colours grouped together, or one block per scene in book order */
  private planOrder = false;
  /** the series folder when the hub is showing a whole series instead of one book */
  private seriesScope: string | null = null;
  private refresh = debounce(() => void this.render(), 300, true);

  constructor(leaf: WorkspaceLeaf, private plugin: BookerPlugin) {
    super(leaf);
  }

  getViewType() {
    return VIEW_HUB;
  }
  getDisplayText() {
    return "Booker";
  }
  getIcon() {
    return "feather";
  }

  /** The pane's own ⋯ menu (next to split right/down) is where the hub's tools and settings live in a tab. */
  onPaneMenu(menu: Menu, source: string) {
    super.onPaneMenu(menu, source);
    // Obsidian has already added its split items; the layout switch goes above them, then a divider
    const items: any[] = (menu as any).items ?? [];
    for (const it of items) if (it.section === "open") it.section = "booker-split";
    this.hubItems(menu);
  }

  private ticking = false;
  private sprintTick: (() => void) | null = null;
  /** the book's profile: its kind of book, which names its levels and decides which views it offers */
  private profileOf(proj: Project): Profile {
    return profileFor(proj);
  }

  /** the word for a level in lower case, such as "chapter" or "entries" */
  private word(proj: Project, depth: number, plural = false): string {
    return levelName(this.profileOf(proj), depth, plural).toLowerCase();
  }

  private shown: { proj: Project; scenes: HubScene[]; series: boolean } | null = null;

  /** Every tool in labelled groups, then project (or series) settings. */
  private hubItems(menu: Menu) {
    const sh = this.shown;
    menu.addItem((i) =>
      i
        .setSection("booker-props")
        .setTitle(this.plugin.settings.hideProperties ? "Show properties at the top of notes" : "Hide properties at the top of notes")
        .setIcon(this.plugin.settings.hideProperties ? "eye" : "eye-off")
        .onClick(() => void this.plugin.toggleProperties())
    );
    if (!sh) return;
    if (!sh.series) {
      this.toolGroups(sh.proj, sh.scenes).forEach(([title, items], n) => {
        const section = `booker-tools-${n}`;
        menu.addItem((i) => i.setSection(section).setTitle(title).setDisabled(true));
        for (const [label, icon, run] of items) menu.addItem((i) => i.setSection(section).setTitle(label).setIcon(icon).onClick(run));
      });
    }
    menu.addItem((i) =>
      i
        .setSection("booker-settings")
        .setTitle(sh.series ? "Series settings…" : "Project settings…")
        .setIcon("settings")
        .onClick(() => (sh.series ? new SeriesSettingsModal(this.plugin.app, sh.proj, () => void this.render()).open() : this.projectSettings(sh.proj)))
    );
  }

  getState() {
    return { project: this.projectPath, world: this.worldKind, series: this.seriesScope };
  }
  async setState(state: any, result: any) {
    if (state?.project) this.projectPath = state.project;
    if (typeof state?.world === "string") this.worldKind = state.world;
    if (state && "series" in state) this.seriesScope = typeof state.series === "string" ? state.series : null;
    await super.setState(state, result);
    await this.render();
  }

  async onOpen() {
    this.contentEl.addClass("booker-hub");
    const { vault, metadataCache } = this.plugin.app;
    // only notes of a book (or its series) change what the hub shows; library files and indexes written in the background do not
    const mine = (f: { path: string }) => findProjects(this.plugin.app).some((p) => !p.file.parent?.path || f.path.startsWith(`${p.file.parent.path}/`) || (!!p.series?.folder && f.path.startsWith(`${p.series.folder}/`)));
    this.registerEvent(metadataCache.on("changed", (f) => mine(f) && this.refresh()));
    this.registerEvent((this.plugin.events as any).on("stats", () => this.refresh()));
    this.registerEvent(vault.on("create", (f) => mine(f) && this.refresh()));
    this.registerEvent(vault.on("delete", (f) => mine(f) && this.refresh()));
    this.registerEvent(vault.on("rename", (f, old) => (mine(f) || mine({ path: old })) && this.refresh()));
    await this.render();
  }

  private get layout(): HubLayout {
    return "sidebar";
  }

  private project(projects: Project[]): Project | null {
    return projects.find((p) => p.file.path === this.projectPath) ?? projects[0] ?? null;
  }

  /** Draws the hub; if anything goes wrong the panel says what, instead of staying empty. */
  async render() {
    // drawing empties the hub, which would scroll it to the top: put it back where it was
    const scroller = this.scroller();
    const top = scroller?.scrollTop ?? 0;
    try {
      await this.draw();
      if (scroller && top) {
        scroller.scrollTop = top;
        window.requestAnimationFrame(() => (scroller.scrollTop = top));
      }
    } catch (e) {
      console.error("Booker hub", e);
      const root = this.contentEl;
      root.empty();
      root.addClass("booker-hub");
      const box = el(root, "div", "booker-hub-empty");
      el(box, "h3", undefined, "The hub could not be drawn");
      el(box, "p", "booker-muted", e instanceof Error ? `${e.message}` : String(e));
      button(box, "Try again", "refresh-cw", () => void this.render(), "mod-cta");
    }
  }

  /** The element of the hub that scrolls. */
  private scroller(): HTMLElement | null {
    for (let e: HTMLElement | null = this.contentEl; e; e = e.parentElement) {
      const o = getComputedStyle(e).overflowY;
      if ((o === "auto" || o === "scroll") && e.scrollHeight > e.clientHeight) return e;
    }
    return this.contentEl;
  }

  private float: HTMLElement | null = null;

  /** Draw into a detached element and swap it in when done, so the hub never shows blank while it waits for data. */
  private drawNo = 0;

  private async draw() {
    const stage = createDiv();
    const no = ++this.drawNo;
    await this.drawInto(stage, no);
    // a newer draw started while this one waited for data; let it paint
    if (no !== this.drawNo) return;
    const root = this.contentEl;
    root.empty();
    root.toggleClass("is-home", this.layout === "home");
    root.toggleClass("is-sidebar", this.layout === "sidebar");
    while (stage.firstChild) root.appendChild(stage.firstChild);
    this.plugin.applyTools();
  }

  private async drawInto(root: HTMLElement, no: number) {
    // The project line stays in one floating box at the top.
    const float = (this.float = el(root, "div", "booker-hub-float"));

    const app = this.plugin.app;
    const projects = findProjects(app);
    const proj = this.project(projects);
    if (this.seriesScope && proj?.series?.folder !== this.seriesScope) this.seriesScope = null;
    if (proj && this.seriesScope) return this.drawSeries(root, float, projects, proj);
    const scenes = proj ? readScenes(app, proj) : [];
    const chars = proj ? codexFiles(app, proj, "characters") : [];
    const locs = proj ? codexFiles(app, proj, "locations") : [];
    const prof = proj ? this.profileOf(proj) : null;
    const research = prof && (prof.features.scripture || prof.features.citations) ? { bibles: (await this.plugin.modules.bibles()).length, sources: this.plugin.sources().filter((s) => s.kind !== "db").length } : undefined;
    if (no !== this.drawNo) return;
    const world = proj ? app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(proj.layout.codex + "/")).length : 0;
    const steps = checklist({ hasProject: !!proj, scenes, characters: chars.length, locations: locs.length, research, profileId: prof?.id, beatSheet: proj ? !!activeSheet(app, proj) : false, world, words: prof ? wordsFor(prof) : undefined });
    const prog = progress(steps);

    this.header(float, projects, proj, scenes);
    if (!proj) return this.empty(root);

    const body = el(root, "div", "booker-hub-body");
    drawFormatBanner(body, this.plugin, proj, () => void this.render());
    await this.tasksCard(body, proj, scenes, steps);
    this.writeCard(body, proj, scenes, getLabels(this.plugin.app, proj));
    this.planCard(body, proj, scenes, research);
    this.worldCard(body, proj);
    this.healthExportCard(body, proj, scenes);
    this.foldable(body);
  }

  /** Cards fold with the same height animation as acts and chapters: what is under the heading moves into a body that collapses, and the heading toggles it. */
  private foldable(scope: HTMLElement) {
    makeFoldable(scope);
  }

  /** Project health, always near the top: what needs attention in the book, with a way to review it and to rebuild everything Booker keeps about the book. */
  private healthSection(card: HTMLElement, proj: Project) {
    const body = el(card, "div", "booker-hub-section");
    el(body, "div", "booker-hub-subhead", "Project health");
    const sub = card.parentElement?.querySelector("summary .booker-muted") as HTMLElement | null;
    const counts = el(body, "p", "booker-muted", "");
    const row = actionRow(body, "booker-actions-start");
    actionBtn(row, "Review", "list-checks", () => void this.plugin.openView("booker-health", { project: proj.file.path }), { tip: "See every warning and fix or dismiss it" });
    const rebuild = actionBtn(row, "Rebuild", "refresh-cw", () => {
      rebuild.addClass("is-busy");
      void rebuildProject(this.plugin, proj)
        .then((msg) => new Notice(`Booker: ${msg}`, 8000))
        .catch((e) => notifyError(e, "rebuild the book"))
        .finally(() => void this.render());
    }, { tip: "Rebuild word counts, links, structure, numbering and the names listed on each scene from the files" });
    void scanProjects(this.plugin, [proj])
      .then(({ report, dismissed }) => {
        if (!card.isConnected) return;
        const st = healthStats(report.findings);
        sub?.setText(st.total ? `${st.total} to look at` : "All clear");
        counts.setText(`${describeStats(st)}${dismissed.length ? ` · ${dismissed.length} dismissed` : ""}`);
        card.parentElement?.toggleClass("has-warnings", st.total > 0);
        if (st.total) card.parentElement?.setAttr("open", "");
      })
      .catch(() => counts.setText("Could not check the book."));
  }

  /** Health and export in one card: what needs attention in the book, then the ways to send it out. */
  private healthExportCard(parent: HTMLElement, proj: Project, scenes: HubScene[]) {
    const body = this.card(parent, "Health and export", "download", "Checking…", true);
    this.healthSection(body, proj);
    this.exportSection(body, proj, scenes);
  }

  /** Scripture, sources and checks for books that quote and cite: where to read, add and verify. Sits inside the Plan card. */
  private researchSection(card: HTMLElement, proj: Project, r: { bibles: number; sources: number }) {
    const body = el(card, "div", "booker-hub-section");
    el(body, "div", "booker-hub-subhead", `Research · ${r.sources} ${r.sources === 1 ? "source" : "sources"} · ${r.bibles} ${r.bibles === 1 ? "Bible" : "Bibles"}`);
    const run = (id: string) => () => void (this.plugin.app as any).commands.executeCommandById(`booker:${id}`);
    const row = actionRow(body, "booker-actions-start");
    actionBtn(row, "Bible reader", "book-open", () => void this.plugin.openBible(), { tip: "Read, search and see commentaries" });
    actionBtn(row, "Library", "library-big", () => void this.plugin.openLibrary(), { tip: "Browse and read every library, archive, book and document" });
    actionBtn(row, "Sources", "library", () => void this.plugin.openSide(), { tip: "Your documents and reference libraries" });
    actionBtn(row, "Bookmarks", "bookmark", run("open-bucket"), { tip: "Saved searches, verses and references" });
    actionBtn(row, "Add source", "plus", run("add-source"), { tip: "Add a PDF, ePub, web page or note to cite" });
    actionBtn(row, "Index", "list-tree", run("index-terms"), { tip: "The words and names in the back-of-book index" });
  }

  /** Open a view on the project picked here, not just the first one in the vault. */
  private openView(type: string, proj: Project, extra: Record<string, unknown> = {}) {
    return this.plugin.openView(type, { project: proj.file.path, ...extra });
  }

  /** The hub when a whole series is picked: its books, the views that can span them, and the Codex they share. */
  private async drawSeries(root: HTMLElement, float: HTMLElement, projects: Project[], proj: Project) {
    const app = this.plugin.app;
    const books = await seriesBooks(app, proj);
    const perBook = books.map((b) => ({ book: b, scenes: readScenes(app, b) }));
    const all = perBook.flatMap((b) => b.scenes);
    this.header(float, projects, proj, all);
    const body = el(root, "div", "booker-hub-body");

    const booksCard = this.card(body, "Books", "library", `${books.length} in the series`);
    for (const { book, scenes } of perBook) {
      const r = el(booksCard, "div", "booker-hub-scene booker-hub-project");
      setIcon(el(r, "span", "booker-hub-ico"), "book");
      el(r, "span", "booker-hub-scene-title", book.name);
      el(r, "span", "booker-muted booker-num", `${fmt(scenes.reduce((n, s) => n + s.words, 0))} words · ${scenes.length}`);
      r.addEventListener("click", () => {
        this.seriesScope = null;
        this.projectPath = book.file.path;
        void this.render();
      });
    }
    actionBtn(actionRow(booksCard), "Book", "plus", () => this.newProject(projects, proj), { tip: "Add a book to this series" });

    const plan = this.card(body, "Plan", "layout-grid", "Across the whole series");
    const row = actionRow(plan, "booker-actions-center");
    const span = { scope: "series" };
    actionBtn(row, "Plotlines", "train-front", () => void this.openView(VIEW_PLOTLINES, proj, span), { tip: "Plotlines of every book side by side" });
    actionBtn(row, "Timeline map", "git-commit-horizontal", () => void this.openView(VIEW_TIMELINE_MAP, proj, span), { tip: "The zoomable timeline map for the whole series" });
    actionBtn(row, "Map", "map", () => void this.openView(VIEW_WORLD_MAP, proj, span), { tip: "Places from every book on a world map" });
    actionBtn(row, "Story checks", "list-checks", () => void this.openView(VIEW_CHECKS, proj, span), { tip: "Setup and payoff, and continuity, across every book" });
    el(plan, "p", "booker-muted", "The board and notes work on one book, so pick a book above or in the list.");
    const out = this.card(body, "Export", "download", "Word, ePub and PDF");
    actionBtn(actionRow(out), "Export the series", "download", () => new ExportModal(this.plugin, proj, proj.series?.folder).open(), { cta: true, tip: "Every book as one manuscript, each as a part" });

    this.worldCard(body, proj);
    this.foldable(body);
  }

  // ----------------------------------------------------------------- pieces

  /** Today's words against the daily goal and the streak. Sprints and history are on the Stats page. */
  private writingStrip(root: HTMLElement) {
    const plugin = this.plugin;
    const strip = el(root, "div", "booker-hub-strip");
    const mine = this.drawNo;
    const paint = () => {
      if (mine !== this.drawNo) return; // an older draw's strip
      strip.empty();
      const goal = plugin.settings.dailyGoal;
      const today = plugin.data.days[dayKey()]?.added ?? 0;
      const row = el(strip, "div", "booker-hub-goal");
      el(row, "span", undefined, goal ? `${fmt(today)} / ${fmt(goal)} words` : `${fmt(today)} words`);
      const reset = el(row, "button", "clickable-icon booker-hub-reset");
      setIcon(reset, "rotate-ccw");
      reset.setAttr("aria-label", "Reset today's word count to zero");
      reset.addEventListener("click", () => {
        new ConfirmModal(plugin.app, "Reset today's word count?", "Today's count goes back to zero. Your writing is not touched, and your streak is worked out again from the new number.", "Reset", () => {
          const prev = plugin.stats.resetToday();
          const n = new Notice("", 8000);
          n.messageEl.createSpan({ text: "Today's word count was reset. " });
          const undo = n.messageEl.createEl("a", { text: "Undo" });
          undo.addEventListener("click", () => {
            plugin.stats.restoreToday(prev);
            n.hide();
          });
        }).open();
      });
      const streak = currentStreak(plugin.data.days, Math.max(1, Math.min(goal || 1, 100)));
      el(row, "span", "booker-muted", `${streak}-day streak`).setAttr("aria-label", "Consecutive days that reached the goal");
      sprintRow(strip);
    };
    // the sprint: pick a length and start, or watch the clock and stop
    const sprintRow = (parent: HTMLElement) => {
      const sp = plugin.sprint;
      const running = !!sp && !sp.recorded && !isDone(sp);
      const row = el(parent, "div", "booker-hub-sprint");
      if (running) {
        const c = el(row, "strong", "booker-hub-sprint-clock", clock(msLeft(sp!)));
        const wds = el(row, "span", "booker-muted booker-hub-sprint-words", `${fmt(sprintWords(sp!, plugin.stats.sessionAdded))} words`);
        const btns = actionRow(row);
        actionBtn(btns, "Stop", "square", () => plugin.endSprint(), { tip: "End the sprint now and keep it" });
        actionBtn(btns, "Stats", "bar-chart-3", () => void plugin.openView(VIEW_STATS), { tip: "Writing stats and sprint history" });
        this.sprintTick = () => {
          if (!c.isConnected) return;
          c.setText(clock(msLeft(sp!)));
          wds.setText(`${fmt(sprintWords(sp!, plugin.stats.sessionAdded))} words`);
        };
        return;
      }
      this.sprintTick = null;
      if (sp?.recorded) el(row, "span", "booker-muted", `Last sprint: ${fmt(sprintWords(sp, sp.endTotal ?? 0))} words, ${fmt(pace(sp, sp.endTotal ?? 0))}/min`);
      const sel = el(row, "select", "dropdown");
      for (const m of SPRINT_LENGTHS) sel.createEl("option", { text: lengthLabel(m), value: String(m) });
      sel.value = String(SPRINT_LENGTHS[2]);
      const btns = actionRow(row);
      actionBtn(btns, "Stats", "bar-chart-3", () => void plugin.openView(VIEW_STATS), { tip: "Writing stats and sprint history" });
      actionBtn(btns, "Start sprint", "timer", () => plugin.beginSprint(Number(sel.value)), { cta: true, tip: "Count the words you write for this long" });
    };
    paint();
    this.registerEvent((plugin.events as any).on("stats", paint));
    this.registerEvent((plugin.events as any).on("sprint", paint));
    if (!this.ticking) {
      this.ticking = true;
      this.registerInterval(window.setInterval(() => this.sprintTick?.(), 1000));
    }
  }

  private header(root: HTMLElement, projects: Project[], proj: Project | null, scenes: HubScene[]) {
    const h = el(root, "div", "booker-hub-head");
    root.prepend(h);
    const title = el(h, "div", "booker-hub-title");
    const NEW = "__new__";
    if (projects.length >= 1) {
      const sel = el(title, "select", "dropdown booker-hub-select");
      const add = (parent: HTMLElement, p: Project) => {
        const o = parent.createEl("option", { text: p.name, value: p.file.path });
        o.selected = p === proj;
        return o;
      };
      for (const p of projects.filter((x) => !x.series)) add(sel, p);
      for (const s of listSeries(projects)) {
        const g = sel.createEl("optgroup");
        g.label = s.name;
        g.createEl("option", { text: `All books in ${s.name}`, value: `series:${s.folder}` }).selected = this.seriesScope === s.folder;
        for (const p of projects.filter((x) => x.series?.folder === s.folder)) add(g, p).selected = p === proj && this.seriesScope !== s.folder;
      }
      sel.createEl("option", { text: "New project…", value: NEW });
      sel.value = this.seriesScope ? `series:${this.seriesScope}` : proj?.file.path ?? "";
      sel.addEventListener("change", () => {
        if (sel.value === NEW) {
          sel.value = proj?.file.path ?? "";
          return this.newProject(projects, proj);
        }
        if (sel.value.startsWith("series:")) {
          const folder = sel.value.slice(7);
          this.seriesScope = folder;
          if (proj?.series?.folder !== folder) this.projectPath = projects.find((p) => p.series?.folder === folder)?.file.path ?? this.projectPath;
        } else {
          this.seriesScope = null;
          this.projectPath = sel.value;
        }
        if (this.projectPath) void this.plugin.followHub(this.projectPath);
        void this.render();
      });
    } else {
      el(title, "h2", undefined, "Booker");
    }
    const inSeries = !!this.seriesScope;

    this.shown = proj ? { proj, scenes, series: inSeries } : null;
    if (projects.length >= 1) {
      const tools = el(title, "div", "booker-hub-tools");
      const icon = (name: string, label: string, run: () => void) => {
        const b = el(tools, "button", "clickable-icon booker-hub-toggle");
        setIcon(b, name);
        b.setAttr("aria-label", label);
        b.addEventListener("click", run);
      };
      icon("plus", proj?.series ? "Add a book to this series" : "Add a project", () => this.newProject(projects, proj));
      icon("file-input", "Import", () =>
        new ImportModal(this.plugin.app, this.plugin, proj, (p) => {
          this.projectPath = p.file.path;
          this.seriesScope = null;
          void this.plugin.followHub(p.file.path);
          void this.render();
        }, () => void this.render()).open()
      );
      if (proj) icon("settings", inSeries ? "Series settings" : "Project settings", () => (inSeries ? new SeriesSettingsModal(this.plugin.app, proj, () => void this.render()).open() : this.projectSettings(proj)));
    }
    // in a tab the pane has its own ⋯ menu (see onPaneMenu); the sidebar has no pane header, so it gets one here
    if (this.layout !== "sidebar") return;
    const more = el(h, "button", "clickable-icon booker-hub-toggle");
    setIcon(more, "more-horizontal");
    more.setAttr("aria-label", "Hub options");
    more.addEventListener("click", (ev) => {
      const menu = new Menu();
      this.hubItems(menu);
      menu.showAtMouseEvent(ev);
    });
  }

  /** The whole toolbox: every view and command, so nothing depends on remembering the command palette. */
  private toolGroups(proj: Project, scenes: HubScene[]): Array<[string, Array<[string, string, () => void]>]> {
    const cmd = (id: string) => () => void (this.plugin.app as any).commands.executeCommandById(`booker:${id}`);
    const groups: Array<[string, Array<[string, string, () => void]>]> = [
      [
        "Write",
        [
          ["Writing format on/off", "type", cmd("toggle-writing-format")],
        ],
      ],
      [
        "Plan",
        (
          [
            ["board", "Board", "layout-grid", () => void this.openView(VIEW_BOARD, proj)],
            ["plotlines", "Plotlines map", "train-front", () => void this.openView(VIEW_PLOTLINES, proj)],
            ["timeline", "Timeline map", "git-commit-horizontal", () => void this.openView(VIEW_TIMELINE_MAP, proj)],
            ["map", "Map", "map", () => void this.openView(VIEW_WORLD_MAP, proj)],
            ["family", "Family tree", "network", () => void this.openView(VIEW_FAMILY, proj)],
            ["checks", "Story checks (beats, setup and payoff)", "list-checks", () => void this.openView(VIEW_CHECKS, proj)],
          ] as Array<[ViewId, string, string, () => void]>
        )
          .filter(([view]) => hasView(this.profileOf(proj), view))
          .map(([, label, icon, run]) => [label, icon, run] as [string, string, () => void]),
      ],
      [
        "Look at it",
        [
          ["File info panel", "panel-right", () => void this.plugin.openView(VIEW_INSPECTOR)],
          ["Writing stats", "bar-chart-3", () => void this.plugin.openView(VIEW_STATS)],
        ],
      ],
      ["Output", [["Export book (Word, ePub, PDF)…", "download", () => new ExportModal(this.plugin, proj).open()]]],
    ];
    return groups;
  }

  private projectSettings(proj: Project) {
    new ProjectSettingsModal(this.plugin.app, proj, (moved) => {
      if (moved) this.projectPath = moved.file.path;
      void this.render();
    }, this.plugin).open();
  }

  private empty(root: HTMLElement) {
    const c = el(root, "div", "booker-hub-empty");
    el(c, "h3", undefined, "Start your first book");
    el(c, "p", "booker-muted", "Booker keeps a book as plain notes in the structure you choose, plus characters and places.");
    button(c, "Create a project", "plus", () => this.newProject([], null), "mod-cta");
  }

  private spinOff: (() => void) | null = null;

  /** A small spinning circle at the bottom right of the Today card while background jobs run; click for the task viewer. */
  private taskSpinner(card: HTMLElement) {
    const tracker = this.plugin.tasks;
    const spin = el(card, "button", "clickable-icon booker-hub-bg");
    let busy: boolean | null = null;
    const paint = () => {
      const n = tracker.active();
      spin.toggleClass("is-hidden", n === 0 && tracker.tasks().length === 0);
      spin.setAttr("aria-label", n > 0 ? `${n} background ${n === 1 ? "task" : "tasks"} running` : "Background tasks");
      // the icon changes only when work starts or stops, so the spin is never restarted by progress updates
      if (busy === n > 0) return;
      busy = n > 0;
      spin.toggleClass("is-active", busy);
      spin.empty();
      setIcon(spin, busy ? "loader-circle" : "check-circle-2");
    };
    this.spinOff?.();
    this.spinOff = tracker.subscribe(paint);
    spin.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      new TaskViewer(this.plugin).open();
    });
    paint();
  }

  /** Today: your words and sprint, then tasks and notes, in one small card: the first steps (hideable), your own checklist, and the project notes. */
  private async tasksCard(parent: HTMLElement, proj: Project, scenes: HubScene[], steps: ReturnType<typeof checklist>) {
    const app = this.plugin.app;
    let file: TaskFile = await readTasks(app, proj);
    const save = (next: TaskFile) => {
      file = next;
      void writeTasks(app, proj, next).then(() => this.render());
    };
    // once every first step is done they fold away, so the card stays small
    const shownSteps = steps.every((s) => s.done) ? [] : steps.filter((s) => !file.hidden.includes(s.id));
    const next = shownSteps.find((s) => !s.done);
    const total = shownSteps.length + file.tasks.length;
    const done = shownSteps.filter((s) => s.done).length + file.tasks.filter((t) => t.done).length;
    const open = total - done;
    const notes = listProjectNotes(app, proj);

    const card = el(parent, "details", "booker-hub-tasks");
    card.open = true;
    const sum = el(card, "summary");
    setIcon(el(sum, "span", "booker-hub-ico"), "calendar-check");
    el(sum, "strong", undefined, "Today");
    el(sum, "span", "booker-tasks-badge" + (open ? "" : " is-clear"), open ? `${open} to do` : "all done");
    this.writingStrip(card);
    this.taskSpinner(this.float ?? card);
    const tasksBox = el(card, "div", "booker-tasks-box");
    const bar = el(tasksBox, "div", "booker-hub-bar");
    el(bar, "span").style.width = total ? `${(done / total) * 100}%` : "0%";

    const list = el(tasksBox, "ul", "booker-tasks");
    const row = (cls: string, isDone: boolean, text: string, onTick: (() => void) | null, onClose: () => void, onText?: () => void) => {
      const li = el(list, "li", cls + (isDone ? " is-done" : ""));
      const box = el(li, "span", "booker-task-box");
      setIcon(box, isDone ? "check-circle-2" : "circle");
      if (onTick) box.addEventListener("click", onTick);
      else box.addClass("is-auto");
      const t = el(li, "span", "booker-task-text", text);
      if (onText) {
        t.addClass("is-link");
        t.addEventListener("click", onText);
      }
      const x = el(li, "span", "booker-task-x");
      setIcon(x, "x");
      x.setAttr("aria-label", "Remove");
      x.addEventListener("click", onClose);
      return li;
    };
    for (const s of shownSteps) {
      const act = !s.done && s === next ? this.stepAction(s.id, proj, scenes) : null;
      row("is-step" + (s === next ? " is-next" : ""), s.done, s.title, null, () => save(hideStep(file, s.id)), act ? act.run : undefined);
    }
    for (const t of file.tasks) row("is-own", t.done, t.text, () => save(toggleTask(file, t.id)), () => save(removeTask(file, t.id)));

    const add = el(tasksBox, "div", "booker-task-add");
    const input = el(add, "input", "booker-task-input");
    input.type = "text";
    input.placeholder = "Add a task…";
    const submit = () => {
      if (input.value.trim()) save(addTask(file, input.value));
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submit();
    });
    const plus = el(add, "button", "booker-task-plus clickable-icon");
    setIcon(plus, "plus");
    plus.setAttr("aria-label", "Add task");
    plus.addEventListener("click", submit);
    if (file.hidden.length && shownSteps.length) {
      const more = el(tasksBox, "a", "booker-task-restore", `Show ${file.hidden.length} hidden first ${file.hidden.length === 1 ? "step" : "steps"}`);
      more.addEventListener("click", () => save(showSteps(file)));
    }

    const nrow = el(card, "div", "booker-task-notes");
    setIcon(el(nrow, "span", "booker-task-notes-ico"), "sticky-note");
    for (const f of notes) {
      const chip = el(nrow, "span", "booker-note-chip", f.basename);
      chip.addEventListener("click", () => this.openNote(f.path));
    }
    const addNote = el(nrow, "span", "booker-note-chip is-add", "+Note");
    addNote.setAttr("aria-label", "New project note");
    addNote.addEventListener("click", () =>
      new NamePrompt(this.plugin.app, "New project note", `In ${proj.name}/Notes`, (name) => {
        void createProjectNote(this.plugin.app, proj, name)
          .then((f) => openNoteIn(this.plugin, f, this.leaf))
          .catch((e) => notifyError(e, "create the note"));
      }).open()
    );
  }

  private stepAction(id: string, proj: Project, scenes: HubScene[]) {
    switch (id) {
      case "scene":
        return { label: `New ${this.word(proj, 2)}`, icon: "plus", run: () => this.newScene(proj, scenes) };
      case "write": {
        const s = continueScene(scenes);
        return s ? { label: `Open ${this.word(proj, 2)}`, icon: "pencil", run: () => this.openNote(s.path) } : null;
      }
      case "beats":
        return { label: "Choose", icon: "list-ordered", run: () => void this.openView(VIEW_CHECKS, proj) };
      case "bible":
        return { label: "Add Bible", icon: "book-open", run: () => void (this.plugin.app as any).commands.executeCommandById("booker:add-bible-module") };
      case "source":
        return { label: "Add source", icon: "library", run: () => void (this.plugin.app as any).commands.executeCommandById("booker:add-source") };
      case "character":
        return { label: "New character", icon: "user-plus", run: () => this.newCodex(proj, "character") };
      case "location":
        return { label: "New place", icon: "map-pin", run: () => this.newCodex(proj, "location") };
    }
    return null;
  }

  private card(parent: HTMLElement, title: string, icon: string, sub: string, keepSub = false): HTMLElement {
    const c = el(parent, "details", `booker-hub-card is-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`);
    c.open = true;
    const sum = el(c, "summary");
    setIcon(el(sum, "span", "booker-hub-ico"), icon);
    el(sum, "strong", undefined, title);
    el(sum, "span", "booker-muted" + (keepSub ? " booker-hub-keep" : ""), sub);
    return el(c, "div", "booker-hub-card-body");
  }

  /** A filter row: typing narrows by title at once; Enter (or the magnifier) also looks inside the text. The × clears it. */
  private filterRow(parent: HTMLElement, placeholder: string, apply: (q: string, inText: boolean) => Promise<string> | string): HTMLElement {
    const row = el(parent, "div", "booker-hub-filter");
    const input = el(row, "input", "booker-hub-filter-input") as HTMLInputElement;
    input.type = "text";
    input.placeholder = placeholder;
    const find = el(row, "button", "clickable-icon booker-hub-filter-btn");
    setIcon(find, "search");
    find.setAttr("aria-label", "Search inside the text too");
    const clear = el(row, "button", "clickable-icon booker-hub-filter-btn");
    setIcon(clear, "x");
    clear.setAttr("aria-label", "Clear the filter");
    const note = el(parent, "div", "booker-muted booker-hub-filter-note");
    let run = 0;
    const go = async (inText: boolean) => {
      const mine = ++run;
      const msg = await apply(input.value.trim().toLowerCase(), inText);
      if (mine === run) note.setText(msg);
    };
    input.addEventListener("input", () => void go(false));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void go(true);
      } else if (e.key === "Escape" && input.value) {
        e.stopPropagation();
        clear.click();
      }
    });
    find.addEventListener("click", () => void go(true));
    clear.addEventListener("click", () => {
      input.value = "";
      void go(false);
      input.focus();
    });
    return row;
  }

  private writeCard(parent: HTMLElement, proj: Project, scenes: HubScene[], labels: ReturnType<typeof getLabels>) {
    const prof = this.profileOf(proj);
    const last = prof.levels.length - 1;
    const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
    const body = this.card(parent, "Write", "pencil", `${fmt(scenes.reduce((n, s) => n + s.words, 0))} words · ${scenes.length} ${this.word(proj, 2, scenes.length !== 1)}`, true);
    const row = actionRow(body, "booker-actions-center");
    const cont = continueScene(scenes);
    if (cont) {
      const go = el(body.parentElement!.querySelector("summary")!, "button", "clickable-icon booker-hub-continue");
      setIcon(go, "pencil");
      go.setAttr("aria-label", `Continue writing: ${cont.title}`);
      go.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        this.openNote(cont.path);
      });
    }
    if (hasTopLevel(prof)) actionBtn(row, `+${levelName(prof, 0)}`, hasMiddleLevel(prof) ? "layers" : "folder-plus", () => this.newScene(proj, scenes, "act"), { tip: `New ${this.word(proj, 0)}` });
    if (hasMiddleLevel(prof)) {
      actionBtn(row, `+${levelName(prof, 1)}`, "folder-plus", () => this.newScene(proj, scenes, "chapter"), { tip: `New ${this.word(proj, 1)}` });
    }
    actionBtn(row, `+${levelName(prof, last)}`, "file-plus", () => this.newScene(proj, scenes), { tip: `New ${this.word(proj, last)}` });
    actionBtn(row, "Summaries", "sparkles", () => new BulkSummaryModal(this.plugin, scenes, this.word(proj, 2)).open(), { tip: "Write the missing AI summaries, or refresh them all" }).addClass("is-summaries");
    if (scenes.length === 0) {
      el(body, "p", "booker-muted", `No ${this.word(proj, last, true)} yet.`);
      this.matterBlock(body, proj, "front");
      return this.matterBlock(body, proj, "back");
    }

    this.matterBlock(body, proj, "front");
    const app = this.plugin.app;
    const treeFilter = this.filterRow(body, `Filter ${this.word(proj, last, true)} by title; Enter searches the text`, (q, inText) => filterTree(q, inText));
    treeFilter.addClass("is-sticky");
    const tree = el(body, "div", "booker-hub-tree");
    const byPath = new Map(scenes.map((sc) => [sc.path, sc]));
    /** hide what does not match, and every chapter or act left with nothing to show */
    const filterTree = async (q: string, inText: boolean): Promise<string> => {
      const rows = Array.from(tree.querySelectorAll<HTMLElement>(".booker-hub-scene[data-path]"));
      tree.toggleClass("is-filtering", !!q);
      const hits = new Set<string>();
      if (q) {
        for (const r of rows) {
          const sc = byPath.get(r.dataset.path ?? "");
          if (!sc) continue;
          if (sc.title.toLowerCase().includes(q)) hits.add(sc.path);
          else if (inText) {
            const f = app.vault.getAbstractFileByPath(sc.path);
            if (f instanceof TFile && (await app.vault.cachedRead(f)).toLowerCase().includes(q)) hits.add(sc.path);
          }
        }
      }
      for (const r of rows) r.toggleClass("is-filtered-out", !!q && !hits.has(r.dataset.path ?? ""));
      for (const group of Array.from(tree.querySelectorAll<HTMLElement>(".booker-hub-chapter-box, .booker-hub-act"))) {
        const any = !q || !!group.querySelector(".booker-hub-scene[data-path]:not(.is-filtered-out)");
        group.toggleClass("is-filtered-out", !any);
        if (q && any) group.removeClass("is-collapsed");
      }
      if (!q) return "";
      return hits.size ? `${hits.size} found${inText ? " in titles and text" : " by title. Press Enter to search the text too"}.` : inText ? "Nothing found in titles or text." : "No title matches. Press Enter to search the text.";
    };
    const edit = (label: string, fn: () => Promise<unknown>) =>
      void this.plugin.undoable(label, proj, this.plugin.sceneFiles(proj), fn).catch((e) => notifyError(e, label.toLowerCase()));
    const groups = groupScenes(scenes);
    const actNums = groups.map((g) => g.act);
    const model = () => getModel(app, proj, scenes);
    const moveScene = (path: string, act: number | string, chapter: number | string | undefined, index: number) =>
      edit(`Moved a ${this.word(proj, 2)}`, async () => {
        const refs = toRefs(scenes);
        const ops = planMove(refs, path, { act, chapter, position: positionInAct(refs, path, act, chapter ?? "", index) }, proj.layout.scenes);
        if (ops.length) {
          await applyMoves(app, ops);
          await syncActFolders(app, proj, model().acts);
        }
      });
    const moveChapter = (chapter: number, act: number, before: number | null) =>
      edit(`Moved a ${this.word(proj, 1)}`, async () => {
        const plan = planMoveChapter(toRefs(scenes), model(), labels, chapter, act, before, proj.layout.scenes);
        if (plan) await applyChapterPlan(app, proj, scenes, plan);
      });
    const rename = (kind: "act" | "chapter", key: number | string) => {
      const map = kind === "act" ? labels.acts : labels.chapters;
      new NamePrompt(app, `Name ${kind === "act" ? levelName(prof, 0) : levelName(prof, 1)} ${key}`, "Leave empty to remove the name. Folders and files stay numbered so other tools can read them.", (name) => edit("Renamed", () => updateLabels(app, proj, (l) => setLabel(l, kind, key, name))), map[String(key)] ?? "", true).open();
    };
    const moreBtn = (parent: HTMLElement, tip: string, menu: (m: Menu) => void) => {
      const b = el(parent, "button", "clickable-icon booker-hub-scene-more");
      setIcon(b, "more-horizontal");
      b.setAttr("aria-label", tip);
      b.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const m = new Menu();
        menu(m);
        m.showAtMouseEvent(ev);
      });
    };
    const clearMarks = () => tree.querySelectorAll(".drop-before, .drop-after, .drop-into").forEach((n) => n.removeClass("drop-before", "drop-after", "drop-into"));
    /** make `node` draggable as `type`, carrying `id` */
    /** `whole` is what shows as being carried when it is more than the handle: a chapter takes its scenes along */
    const dragSource = (node: HTMLElement, type: string, id: string, whole: HTMLElement = node, image: HTMLElement = whole, onStart?: () => void, onEnd?: () => void) => {
      node.draggable = true;
      node.addEventListener("dragstart", (ev) => {
        ev.stopPropagation();
        ev.dataTransfer?.setData(type, id);
        if (ev.dataTransfer) {
          ev.dataTransfer.effectAllowed = "move";
          if (image !== node) {
            const wr = image.getBoundingClientRect();
            ev.dataTransfer.setDragImage(image, ev.clientX - wr.left, ev.clientY - wr.top);
          }
        }
        window.setTimeout(() => {
          whole.addClass("is-dragging");
          onStart?.();
        }, 0);
      });
      node.addEventListener("dragend", () => {
        whole.removeClass("is-dragging");
        onEnd?.();
        clearMarks();
      });
    };
    /** make `node` take drops of the given types; `drop` gets the type, what was carried and whether it landed on the lower half */
    const dropTarget = (node: HTMLElement, types: string[], mark: HTMLElement, drop: (type: string, id: string, after: boolean) => void) => {
      const hit = (ev: DragEvent) => types.find((t) => ev.dataTransfer?.types.includes(t));
      node.addEventListener("dragover", (ev) => {
        if (!hit(ev)) return;
        ev.preventDefault();
        ev.stopPropagation();
        clearMarks();
        const r = node.getBoundingClientRect();
        mark.addClass(ev.clientY < r.top + r.height / 2 ? "drop-before" : "drop-after");
      });
      node.addEventListener("dragleave", (ev) => {
        if (!(ev.relatedTarget instanceof Node && node.contains(ev.relatedTarget))) mark.removeClass("drop-before", "drop-after");
      });
      node.addEventListener("drop", (ev) => {
        const type = hit(ev);
        if (!type) return;
        ev.preventDefault();
        ev.stopPropagation();
        const r = node.getBoundingClientRect();
        const after = ev.clientY >= r.top + r.height / 2;
        const id = ev.dataTransfer!.getData(type);
        clearMarks();
        drop(type, id, after);
      });
    };
    const ACT = "application/x-booker-act";
    const CHAPTER = "application/x-booker-chapter";
    const SCENE = "application/x-booker-scene";

    groups.forEach((a, ai) => {
      const showTop = hasTopLevel(prof);
      const act = showTop ? el(tree, "details", "booker-hub-act") : el(tree, "div", "booker-hub-act is-bare");
      if (act instanceof HTMLDetailsElement) act.open = true;
      const actNum = typeof a.act === "number" ? a.act : null;
      if (showTop) {
        const as = el(act, "summary");
        // the act stays open as far as the browser knows, so folding is the same height animation as dragging
        as.addEventListener("click", (ev) => {
          ev.preventDefault();
          act.toggleClass("is-collapsed", !act.hasClass("is-collapsed"));
        });
        el(as, "strong", undefined, actTitle(a.act, labels, levelName(prof, 0)));
        el(as, "span", "booker-muted booker-num", `${fmt(a.words)} words`);
        moreBtn(as, `${levelName(prof, 0)} options`, (m) => {
          m.addItem((i) => i.setTitle("Rename").setIcon("pencil").setDisabled(actNum === null).onClick(() => rename("act", a.act)));
          m.addItem((i) => i.setTitle("Move up").setIcon("arrow-up").setDisabled(ai === 0 || actNum === null).onClick(() => edit("Moved an act", () => swapActs(app, proj, scenes, actNum!, actNums[ai - 1] as number))));
          m.addItem((i) => i.setTitle("Move down").setIcon("arrow-down").setDisabled(ai === groups.length - 1 || actNum === null).onClick(() => edit("Moved an act", () => swapActs(app, proj, scenes, actNum!, actNums[ai + 1] as number))));
        });
        if (actNum !== null) {
          // the picked-up act shrinks to its heading, and so does every other act, so they can all be dragged between
          dragSource(as, ACT, String(actNum), act, as, () => tree.addClass("is-act-dragging"), () => tree.removeClass("is-act-dragging"));
          // an act lands before or after the whole framed act; a chapter dropped on the heading goes last in it
          dropTarget(act, [ACT], act, (_type, id) => {
            if (Number(id) !== actNum) edit("Moved an act", () => moveActTo(app, proj, Number(id), actNum));
          });
          dropTarget(as, [CHAPTER], as, (_type, id) => moveChapter(Number(id), actNum, null));
        }
      }
      const actInner = el(el(act, "div", "booker-hub-act-body"), "div", "booker-hub-act-inner");
      a.chapters.forEach((c, ci) => {
        const box = el(actInner, "div", "booker-hub-chapter-box" + (hasMiddleLevel(prof) ? " is-framed" : ""));
        const chNum = typeof c.chapter === "number" ? c.chapter : null;
        if (hasMiddleLevel(prof)) {
          const ch = el(box, "div", "booker-hub-chapter");
          const full = chapterTitle(c.chapter, labels, levelName(prof, 1));
          const [num, ...name] = full.split(" · ");
          const head = el(ch, "span", "booker-hub-chapter-title");
          el(head, "span", "booker-hub-chapter-num", num);
          if (name.length) el(head, "span", "booker-hub-chapter-name", name.join(" · "));
          el(ch, "span", "booker-muted booker-num", `${fmt(c.words)} words`);
          ch.addEventListener("click", () => box.toggleClass("is-collapsed", !box.hasClass("is-collapsed")));
          moreBtn(ch, `${levelName(prof, 1)} options`, (m) => {
            m.addItem((i) => i.setTitle("Rename").setIcon("pencil").setDisabled(chNum === null).onClick(() => rename("chapter", c.chapter!)));
            m.addItem((i) => i.setTitle("Move up").setIcon("arrow-up").setDisabled(chNum === null || ci === 0).onClick(() => moveChapter(chNum!, actNum!, a.chapters[ci - 1].chapter as number)));
            m.addItem((i) => i.setTitle("Move down").setIcon("arrow-down").setDisabled(chNum === null || ci === a.chapters.length - 1).onClick(() => moveChapter(chNum!, actNum!, (a.chapters[ci + 2]?.chapter as number | undefined) ?? null)));
          });
          if (chNum !== null && actNum !== null) {
            // the picked-up chapter shrinks to its heading, and so does every other chapter, so they can all be dragged between
            dragSource(ch, CHAPTER, String(chNum), box, ch, () => tree.addClass("is-chapter-dragging"), () => tree.removeClass("is-chapter-dragging"));
            // a chapter lands before or after the whole framed chapter, wherever over it you drop; a scene dropped on the heading goes first in it
            dropTarget(box, [CHAPTER], box, (_type, id, after) => {
              if (Number(id) === chNum) return;
              const next = a.chapters[ci + 1]?.chapter;
              moveChapter(Number(id), actNum, after ? (typeof next === "number" ? next : null) : chNum);
            });
            dropTarget(ch, [SCENE], ch, (_type, id) => moveScene(id, a.act, c.chapter, 0));
          }
        }
        const sceneInner = el(el(box, "div", "booker-hub-chapter-body"), "div", "booker-hub-act-inner");
        c.scenes.forEach((s, i) => {
          const r = el(sceneInner, "div", "booker-hub-scene");
          r.dataset.path = s.path;
          el(r, "span", `booker-dot status-${s.status}`);
          el(r, "span", "booker-hub-scene-title", s.title);
          if (!hasMiddleLevel(prof)) el(r, "span", "booker-muted booker-num", fmt(s.words));
          const more = el(r, "button", "clickable-icon booker-hub-scene-more");
          setIcon(more, "more-horizontal");
          more.setAttr("aria-label", `${levelName(prof, 2)} options`);
          more.addEventListener("click", (ev) => {
            ev.stopPropagation();
            this.sectionMenu(proj, scenes, s, i, ev);
          });
          // what the note says about itself: its own summary, else a short AI one, else a description, else the full AI summary
          const shown = s.ownSummary ?? s.aiShort ?? s.description ?? s.aiFull;
          if (shown) {
            r.addClass("has-summary");
            el(r, "div", "booker-hub-scene-summary" + (s.ownSummary || (!s.aiShort && s.description) ? "" : " is-ai"), shown);
          }
          r.addEventListener("click", () => this.openNote(s.path));
          dragSource(r, SCENE, s.path);
          dropTarget(r, [SCENE], r, (_type, id, after) => {
            if (id === s.path) return;
            // the slot among this chapter's other scenes, counted without the one being moved
            const others = c.scenes.filter((x) => x.path !== id);
            moveScene(id, a.act, c.chapter, others.findIndex((x) => x.path === s.path) + (after ? 1 : 0));
          });
        });
      });
    });
    this.matterBlock(body, proj, "back");
  }

  /** Front or back matter notes: click to open, + to add another. Printed before or after the chapters on export when they have text. */
  private matterBlock(parent: HTMLElement, proj: Project, pos: "front" | "back") {
    const notes = readMatter(this.plugin.app, proj).filter((x) => x.position === pos);
    const box = el(parent, "details", "booker-hub-matter");
    box.open = notes.length > 0;
    const sum = el(box, "summary");
    el(sum, "strong", undefined, pos === "front" ? "Front matter" : "Back matter");
    el(sum, "span", "booker-muted", `${notes.length} ${notes.length === 1 ? "page" : "pages"}`);
    const add = el(sum, "button", "clickable-icon booker-hub-scene-more");
    setIcon(add, "plus");
    add.setAttr("aria-label", `Add ${pos} matter`);
    add.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      new NamePrompt(this.plugin.app, `New ${pos} matter`, "For example Foreword, Appendix or Glossary", (name) => {
        void createMatter(this.plugin.app, proj, pos, name)
          .then((f) => openNoteIn(this.plugin, f, this.leaf))
          .catch((e) => notifyError(e, "create the page"));
      }).open();
    });
    const items = el(box, "div", "booker-matter-items");
    const mime = `application/x-booker-matter-${pos}`;
    const clear = () => box.querySelectorAll(".drop-before, .drop-after").forEach((n) => n.removeClass("drop-before", "drop-after"));
    notes.forEach((n, i) => {
      const r = el(items, "div", "booker-hub-scene");
      el(r, "span", "booker-hub-scene-title", n.title);
      if (!n.enabled) {
        r.addClass("is-off");
        el(r, "span", "booker-muted", "off");
      }
      const more = el(r, "button", "clickable-icon booker-hub-scene-more");
      setIcon(more, "more-horizontal");
      more.setAttr("aria-label", "More");
      more.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        this.matterMenu(proj, n, i, notes.length, ev);
      });
      r.draggable = true;
      r.addEventListener("dragstart", (ev) => {
        ev.stopPropagation();
        ev.dataTransfer?.setData(mime, String(i));
        if (ev.dataTransfer) ev.dataTransfer.effectAllowed = "move";
        window.setTimeout(() => r.addClass("is-dragging"), 0);
      });
      r.addEventListener("dragend", () => {
        r.removeClass("is-dragging");
        clear();
      });
      r.addEventListener("click", () => this.openNote(n.path));
    });
    // one drop zone for the whole card: the header, the gaps and the space above the first page all count, so a page can go to the very top
    const rows = () => Array.from(items.children).filter((c): c is HTMLElement => c instanceof HTMLElement);
    const slotAt = (ev: DragEvent) => {
      const list = rows();
      const k = list.findIndex((row) => {
        const r = row.getBoundingClientRect();
        return ev.clientY < r.top + r.height / 2;
      });
      return k < 0 ? list.length : k;
    };
    box.addEventListener("dragover", (ev) => {
      if (!ev.dataTransfer?.types.includes(mime) || !notes.length) return;
      ev.preventDefault();
      ev.stopPropagation();
      clear();
      const list = rows();
      const k = slotAt(ev);
      if (k < list.length) list[k].addClass("drop-before");
      else list[list.length - 1]?.addClass("drop-after");
    });
    box.addEventListener("dragleave", (ev) => {
      if (!(ev.relatedTarget instanceof Node && box.contains(ev.relatedTarget))) clear();
    });
    box.addEventListener("drop", (ev) => {
      if (!ev.dataTransfer?.types.includes(mime) || !notes.length) return;
      ev.preventDefault();
      ev.stopPropagation();
      const from = Number(ev.dataTransfer.getData(mime));
      const slot = slotAt(ev);
      clear();
      if (!Number.isInteger(from) || from < 0 || from >= notes.length) return;
      const to = slot > from ? slot - 1 : slot;
      if (to === from) return;
      const app = this.plugin.app;
      const label = `Moved “${notes[from].title}”`;
      void this.plugin
        .undoable(label, proj, notes.map((x) => x.path), () => moveMatterTo(app, proj, notes[from].path, to))
        .then(() => this.refresh())
        .catch((e) => notifyError(e, "move the page"));
    });
  }

  /** The ⋯ menu of a front or back matter page: switch it off or on, rename, move, delete. */
  private matterMenu(proj: Project, n: { title: string; path: string; enabled: boolean }, index: number, count: number, ev: MouseEvent) {
    const app = this.plugin.app;
    const run = (label: string, fn: () => Promise<unknown>) => void this.plugin.undoable(label, proj, [n.path], fn).then(() => this.refresh()).catch((e) => notifyError(e, label.toLowerCase()));
    const menu = new Menu();
    menu.addItem((i) => i.setTitle(n.enabled ? "Turn off (leave out of the export)" : "Turn on").setIcon(n.enabled ? "eye-off" : "eye").onClick(() => run(n.enabled ? `Turned off “${n.title}”` : `Turned on “${n.title}”`, () => setMatterEnabled(app, n.path, !n.enabled))));
    menu.addItem((i) => i.setTitle("Rename").setIcon("pencil").onClick(() => new NamePrompt(app, "Rename", "Changes the title and the file name.", (name) => run(`Renamed “${n.title}”`, () => renameMatter(app, n.path, name)), n.title, false, "Rename").open()));
    menu.addItem((i) => i.setTitle("Move up").setIcon("arrow-up").setDisabled(index === 0).onClick(() => run(`Moved “${n.title}”`, () => moveMatter(app, proj, n.path, -1))));
    menu.addItem((i) => i.setTitle("Move down").setIcon("arrow-down").setDisabled(index >= count - 1).onClick(() => run(`Moved “${n.title}”`, () => moveMatter(app, proj, n.path, 1))));
    menu.addSeparator();
    menu.addItem((i) =>
      i
        .setTitle("Delete")
        .setIcon("trash-2")
        .setWarning(true)
        .onClick(() => new ConfirmModal(app, `Delete “${n.title}”?`, "The page moves to Obsidian's trash. You can undo it right after.", "Delete", () => run(`Deleted “${n.title}”`, () => deleteMatter(app, n.path))).open())
    );
    menu.showAtMouseEvent(ev);
  }

  /** The ⋯ menu of an item (a scene in a novel): delete it, join it to the one above, or make its title the chapter's. */
  private sectionMenu(proj: Project, scenes: HubScene[], s: HubScene, index: number, ev: MouseEvent) {
    const plugin = this.plugin;
    const app = plugin.app;
    const run = (label: string, fn: () => Promise<unknown>) =>
      void plugin.undoable(label, proj, plugin.sceneFiles(proj), fn).catch((e) => notifyError(e, label.toLowerCase()));
    const menu = new Menu();
    const item = this.word(proj, 2);
    const hasMid = hasMiddleLevel(this.profileOf(proj));
    menu.addItem((i) =>
      i.setTitle("Rename").setIcon("pencil").onClick(() => new NamePrompt(app, "Rename", `Changes the title and the file name.`, (name) => run(`Renamed “${s.title}”`, () => renameScene(app, proj, s.path, name)), s.title, false, "Rename").open())
    );
    menu.addItem((i) =>
      i.setTitle(`Merge with ${item} above`).setIcon("arrow-up-to-line").setDisabled(index === 0).onClick(() => run(`Merged “${s.title}” into the ${item} above`, () => mergeWithAbove(app, proj, scenes, s.path)))
    );
    menu.addItem((i) =>
      i.setTitle("Write AI summary").setIcon("sparkles").onClick(() => {
        const f = app.vault.getAbstractFileByPath(s.path);
        if (f instanceof TFile) void plugin.autoSummary.now(f);
      })
    );
    if (hasMid) {
      const mid = this.word(proj, 1);
      menu.addItem((i) =>
        i.setTitle(`Use title as ${mid} title`).setIcon("heading").onClick(() => run(`“${s.title}” is now the ${mid} title`, () => moveTitleToChapter(app, proj, scenes, s.path)))
      );
    }
    menu.addSeparator();
    menu.addItem((i) =>
      i
        .setTitle(`Delete ${item}`)
        .setIcon("trash-2")
        .setWarning(true)
        .onClick(() =>
          new ConfirmModal(app, `Delete “${s.title}”?`, `The ${item} moves to Obsidian's trash and the ones after it close up. You can undo it right after.`, "Delete", () => run(`Deleted “${s.title}”`, () => deleteScene(app, proj, scenes, s.path))).open()
        )
    );
    menu.showAtMouseEvent(ev);
  }

  private planCard(parent: HTMLElement, proj: Project, scenes: HubScene[], research?: { bibles: number; sources: number } | null) {
    const card = this.card(parent, research ? "Plan and research" : "Plan", "layout-grid", research ? "Progress, structure and research" : "Progress and structure");
    const body = research ? el(card, "div", "booker-hub-section") : card;
    if (research) el(body, "div", "booker-hub-subhead", "Plan");
    const counts = statusCounts(scenes, statusesFor(proj.profile));
    const total = scenes.length || 1;
    const bar = el(body, "div", "booker-statusbar is-wide is-clickable");
    bar.title = this.planOrder ? "One block per scene, in book order. Click to group the colours." : "Colours grouped. Click to see each scene where it sits in the book.";
    bar.addEventListener("click", () => {
      this.planOrder = !this.planOrder;
      void this.render();
    });
    if (this.planOrder) {
      let lastChapter: unknown = null;
      for (const sc of [...scenes].sort(compareScenes)) {
        const seg = el(bar, "span", `booker-seg status-${sc.status}`);
        seg.style.width = `${100 / total}%`;
        const key = `${sc.act}/${sc.chapter ?? ""}`;
        if (lastChapter !== null && key !== lastChapter) seg.addClass("is-chapter-start");
        lastChapter = key;
        seg.title = `${sc.chapter !== undefined ? `Chapter ${sc.chapter} · ` : ""}${sc.title} · ${sc.status}`;
      }
    } else {
      for (const [status, n] of Object.entries(counts)) {
        if (!n) continue;
        const seg = el(bar, "span", `booker-seg status-${status}`);
        seg.style.width = `${(n / total) * 100}%`;
        seg.title = `${status}: ${n}`;
      }
    }
    const legend = el(body, "div", "booker-hub-legend");
    for (const [status, n] of Object.entries(counts)) {
      const k = el(legend, "span");
      el(k, "span", `booker-dot status-${status}`);
      k.appendText(` ${status} ${n}`);
    }
    const row = actionRow(body, "booker-actions-start");
    actionBtn(row, "Board", "layout-grid", () => void this.openView(VIEW_BOARD, proj), { tip: "Open the board" });
    const has = (v: ViewId) => hasView(this.profileOf(proj), v);
    if (has("plotlines")) actionBtn(row, "Plotlines", "train-front", () => void this.openView(VIEW_PLOTLINES, proj), { tip: "Open the plotlines map" });
    if (has("checks")) actionBtn(row, "Story checks", "list-checks", () => void this.openView(VIEW_CHECKS, proj), { tip: "Beats of your story structure, setup and payoff" });
    if (has("timeline")) actionBtn(row, "Timeline map", "git-commit-horizontal", () => void this.openView(VIEW_TIMELINE_MAP, proj), { tip: "Open the zoomable timeline map" });
    if (has("map")) actionBtn(row, "Map", "map", () => void this.openView(VIEW_WORLD_MAP, proj), { tip: "Open the map: scenes, places and notes with a location" });
    if (research) this.researchSection(card, proj, research);
  }

  private worldCard(parent: HTMLElement, proj: Project) {
    const app = this.plugin.app;
    const kinds = worldKinds(app, proj);
    const kind = kinds.find((k) => k.id === this.worldKind) ?? kinds[0];
    const counts = kinds.map((k) => worldEntries(app, proj, k).length);
    const total = counts.reduce((n, c) => n + c, 0);
    const body = this.card(parent, "Codex", "users", `${total} ${total === 1 ? "note" : "notes"}`);

    const files = worldEntries(app, proj, kind);
    if (files.length > 0) {
      const filtering = async (q: string, inText: boolean): Promise<string> => {
        let n = 0;
        for (const r of Array.from(list.querySelectorAll<HTMLElement>(".booker-world-row[data-path]"))) {
          let hit = !q || (r.dataset.name ?? "").includes(q);
          if (!hit && inText) {
            const f = app.vault.getAbstractFileByPath(r.dataset.path ?? "");
            hit = f instanceof TFile && (await app.vault.cachedRead(f)).toLowerCase().includes(q);
          }
          r.toggleClass("is-filtered-out", !hit);
          if (hit) n++;
        }
        if (!q) return "";
        return n ? `${n} found${inText ? " in names and text" : " by name. Press Enter to search the text too"}.` : inText ? "Nothing found in names or text." : "No name matches. Press Enter to search the text.";
      };
      this.filterRow(body, `Filter ${kind.label.toLowerCase()} by name; Enter searches the text`, filtering).addClass("is-sticky");
    }
    const box = el(body, "div", "booker-world-box");
    const pick = el(box, "select", "dropdown booker-world-select");
    kinds.forEach((k, i) => {
      const o = pick.createEl("option", { text: `${k.label} (${counts[i]})`, value: k.id });
      o.selected = k === kind;
    });
    pick.createEl("option", { text: "Add more…", value: "__add__" });
    pick.addEventListener("change", () => {
      if (pick.value !== "__add__") {
        this.worldKind = pick.value;
        return void this.render();
      }
      pick.value = kind.id;
      new CodexCategoryModal(app, { heading: "New category", hint: "For anything else you want to keep track of, such as factions, spells, eras or jobs. It becomes a folder in Codex.", asking: true, alias: false }, (name, alias, seq) => {
        void createWorldCategory(app, proj, name)
          .then(async (k) => {
            if (alias) await setAliasSuggest(app, proj, k.id, true);
            if (seq?.on) await setKindSequence(app, proj, k, { sequential: seq.sequential, defaultGap: seq.defaultGap, anchorKinds: seq.anchorKinds });
            this.worldKind = k.id;
            return this.render();
          })
          .catch((e) => notifyError(e, "add the category"));
      }).open();
    });

    const list = el(box, "div", "booker-world-list");
    if (files.length === 0) el(list, "div", "booker-world-row booker-muted", `No ${kind.label.toLowerCase()} yet.`);
    else {
      for (const f of files) {
        // name on the first line (with its colour and sequence number), its date small beneath
        const fm = app.metadataCache.getFileCache(f)?.frontmatter;
        const when = String(fm?.storyDate ?? fm?.story_date ?? "").trim();
        const num = Number(fm?.number ?? 0) || 0;
        const colour = fm?.color ? String(fm.color) : "";
        const row = el(list, "div", "booker-world-row");
        row.dataset.path = f.path;
        row.dataset.name = f.basename.toLowerCase();
        const main = el(row, "div", "booker-world-main");
        const top = el(main, "div", "booker-world-top");
        if (colour) el(top, "span", "booker-world-dot").style.background = colour;
        el(top, "span", "booker-world-name", f.basename);
        // the number badge is for sequences that are on: it stays hidden until the category is known to be one
        if (num) el(top, "span", "booker-world-num is-hidden", `#${num}`);
        if (when) el(main, "div", "booker-world-when", when);
        const more = el(row, "button", "clickable-icon booker-world-more");
        more.setAttr("aria-label", `More for ${f.basename}`);
        setIcon(more, "more-horizontal");
        more.addEventListener("click", (e) => {
          e.stopPropagation();
          const menu = new Menu();
          menu.addItem((i) =>
            i.setTitle(`Rename ${kind.singular}…`).setIcon("pencil").onClick(() =>
              new NamePrompt(app, `Rename ${kind.singular}`, "Links to it follow the new name.", (name) => {
                void renameWorldEntry(app, f, name).then(() => this.render()).catch((err) => notifyError(err, "rename the note"));
              }, f.basename, false, "Rename").open()
            )
          );
          menu.addItem((i) =>
            i.setTitle(`Delete ${kind.singular}`).setIcon("trash-2").onClick(() =>
              new ConfirmModal(app, `Delete “${f.basename}”?`, "The note moves to Obsidian's trash. Scenes that mention it keep the name as plain text.", "Delete", () => {
                void app.fileManager.trashFile(f).then(() => this.render()).catch((err) => notifyError(err, "delete the note"));
              }).open()
            )
          );
          menu.showAtMouseEvent(e);
        });
        row.addEventListener("click", () => this.openNote(f.path));
      }
    }

    const row = actionRow(body);
    actionBtn(row, `Add ${kind.singular}`, kind.icon === "user" ? "user-plus" : kind.icon, () => void this.addWorld(proj, kind), { cta: true, tip: `Add ${kind.singular}` });
    const gear = el(row, "button", "booker-world-gear");
    setIcon(gear, "settings");
    gear.setAttr("aria-label", `${kind.label} settings`);
    gear.addEventListener("click", () => void this.kindSettings(proj, kind));

    // a category that is a sequence: checks for its links (or a note that it is switched off)
    void readTemplates(app, proj).then((all) => {
      const tpl = templateOfKind(all, kind);
      if (!row.isConnected) return;
      if (isEnabled(tpl)) box.querySelectorAll(".booker-world-num").forEach((e) => e.removeClass("is-hidden"));
      if (!tpl) return;
      if (!isEnabled(tpl)) return void el(body, "div", "booker-world-off", "Sequence is off for this category");
      actionBtn(row, "Check", "list-checks", () => void this.plugin.checkSequences(true, proj), { tip: "Check this category's dates and links" });
      actionBtn(row, "Repair", "wrench", () => void this.plugin.repairSequencesFlow(proj), { tip: "Recompute dates from gaps and anchors" });
    });
  }

  /** "Add ___": a plain name box, or the full dialog (gap, anchor, relation) when the category is a sequence. */
  private async addWorld(proj: Project, kind: WorldKind) {
    const app = this.plugin.app;
    const tpl = templateOfKind(await readTemplates(app, proj), kind);
    if (!tpl || !isEnabled(tpl)) return this.newWorld(proj, kind);
    const { notes, characters } = sequenceChoices(app, proj);
    new SequenceItemModal(app, tpl, {}, notes, characters, (c) => {
      void this.plugin
        .undoable(`New ${kind.singular}`, proj, [], () => createFromTemplate(app, proj, tpl, c.group, c.label, c.inSequence, c))
        .then((f) => openNoteIn(this.plugin, f, this.leaf))
        .catch((e) => notifyError(e, "create the note"));
    }).open();
  }

  /** The category's settings box: aliases, and whether it is a sequence (numbered, dated, linked in time) and how. */
  private async kindSettings(proj: Project, kind: WorldKind) {
    const app = this.plugin.app;
    const cur = templateOfKind(await readTemplates(app, proj), kind);
    const sequence: SequenceOption = cur ? { on: isEnabled(cur), exists: true, locked: kind.type === "life", sequential: cur.sequential, defaultGap: cur.defaultGap, anchorKinds: cur.anchorKinds } : { ...DEFAULT_SEQUENCE };
    const paths = () => [...worldEntries(app, proj, kind).map((f) => f.path), `${proj.layout.system}/templates.json`];
    new CodexCategoryModal(
      app,
      { heading: `${kind.label} settings`, asking: false, alias: aliasSuggestOn(proj, kind.id), sequence },
      (_n, alias, seq) => {
        void (async () => {
          try {
            await setAliasSuggest(app, proj, kind.id, alias);
            const changed = seq && (seq.on !== sequence.on || (seq.on || cur) && JSON.stringify([seq.sequential, seq.defaultGap, seq.anchorKinds]) !== JSON.stringify([sequence.sequential, sequence.defaultGap, sequence.anchorKinds]));
            // nothing to save for a category that never was a sequence and still is not
            if (seq && changed && (seq.on || cur)) {
              const n = await this.plugin.undoable(`${kind.label}: sequence ${seq.on ? "settings" : "off"}`, proj, paths(), () => setKindSequence(app, proj, kind, { sequential: seq.sequential, defaultGap: seq.defaultGap, anchorKinds: seq.anchorKinds, enabled: seq.on }));
              if (n) new Notice(`${n} note${n === 1 ? "" : "s"} now part of this sequence.`);
            }
            await this.render();
          } catch (e) {
            notifyError(e, "save the setting");
          }
        })();
      },
      () =>
        new ConfirmModal(app, `Remove the sequence from ${kind.label}?`, "The sequence settings go and the notes are no longer marked as part of it. Their dates and links stay in the notes. To keep everything and just pause it, switch the sequence off instead.", "Remove", () => {
          void this.plugin
            .undoable(`${kind.label}: sequence removed`, proj, paths(), () => removeKindSequence(app, proj, kind))
            .then(() => this.render())
            .catch((e) => notifyError(e, "remove the sequence"));
        }).open(),
    ).open();
  }

  private exportSection(card: HTMLElement, proj: Project, scenes: HubScene[]) {
    const body = el(card, "div", "booker-hub-section");
    el(body, "div", "booker-hub-subhead", "Export · Word, ePub and PDF");
    const status = el(body, "div", "booker-muted booker-hub-status");
    if (scenes.length === 0) return void status.setText(`Add a ${this.word(proj, 2)} to export your book.`);
    const box = el(body, "div", "booker-quick-box");
    el(box, "span", "booker-quick-label", "Quick export");
    const row = actionRow(box, "booker-actions-center");
    const quick = (label: string, key: "docx" | "epub" | "pdf", icon: string) =>
      actionBtn(
        row,
        label,
        icon,
        async () => {
          status.setText(`Exporting ${label}…`);
          try {
            const opts = { ...defaultOptions(this.plugin), docx: key === "docx", epub: key === "epub", pdf: key === "pdf" };
            const files = await runExport(this.plugin, proj, opts, (m) => status.setText(m));
            status.setText(`Saved ${files.map((f) => f.file.name).join(", ")} in “${files[0]?.file.parent?.path ?? ""}”.`);
          } catch (e) {
            status.setText(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
          }
        },
        { tip: `Export ${label}` }
      );
    quick("Word", "docx", "file-text");
    quick("ePub", "epub", "book-open");
    quick("PDF", "pdf", "file");
    const big = actionRow(body, "booker-actions-end");
    actionBtn(big, "Custom Export", "sliders-horizontal", () => new ExportModal(this.plugin, proj).open(), { tip: "Choose formats, layout and advanced settings" }).addClass("is-custom");
    if (Platform.isDesktopApp)
      actionBtn(
        big,
        "Show folder",
        "folder-open",
        () => {
          const app = this.plugin.app as any;
          const dir = normalizePath(`${this.plugin.exportFolder()}/${safeName(proj.name) || "Untitled"}`);
          const target = app.vault.getAbstractFileByPath(dir) ?? app.vault.getAbstractFileByPath(this.plugin.exportFolder());
          if (target) app.showInFolder?.(target.path);
          else new Notice("Nothing has been exported yet.");
        },
        { tip: "Show the export folder in Finder" }
      ).addClass("is-folder");

  }

  // ---------------------------------------------------------------- actions

  private openNote(path: string) {
    const f = this.plugin.app.vault.getFileByPath(path);
    if (f) void openNoteIn(this.plugin, f, this.leaf);
  }

  private newProject(projects: Project[], current: Project | null) {
    new NewProjectModal(
      this.plugin.app,
      listSeries(projects),
      (input) => {
        void createProject(this.plugin.app, input.root, input.name, input.series, input.timelineStart, input.profile, { citationStyle: input.citationStyle, starterChapters: input.starterChapters, levels: input.levels, firstActName: input.firstActName })
          .then(async (p) => {
            this.projectPath = p.file.path;
            // backups are on for a new book unless the author switched them off on the Backups card
            await this.plugin.setBackupConfig(p, { ...this.plugin.backupConfig(p), dir: input.backup.dir || this.plugin.backupConfig(p).dir, schedule: input.backup.enabled ? input.backup.schedule : "manual" });
            return this.render();
          })
          .catch((e) => notifyError(e, "create the project"));
      },
      current?.series?.folder,
      this.plugin.settings.projectRoot,
      defaultBackupDir(),
      this.plugin
    ).open();
  }

  /** The scene you last worked in: the one you edited most recently, else the one saved most recently. */
  private lastWorked(scenes: HubScene[]): HubScene | undefined {
    const edited = scenes.find((s) => s.path === this.plugin.autoSummary.lastEdited);
    if (edited) return edited;
    const mtime = (s: HubScene) => this.plugin.app.vault.getFileByPath(s.path)?.stat.mtime ?? 0;
    return [...scenes].sort((a, b) => mtime(b) - mtime(a))[0];
  }

  /** A new act goes at the end; a new chapter or scene starts from where you last worked and lands right after it. */
  private newScene(proj: Project, scenes: HubScene[], where: "scene" | "chapter" | "act" = "scene") {
    const anchor = where === "act" ? undefined : this.lastWorked(scenes);
    new NewItemModal(this.plugin.app, scenes, getLabels(this.plugin.app, proj), where, anchor ? { act: anchor.act, chapter: anchor.chapter } : undefined, (c) => {
      const near = anchor && String(c.act) === String(anchor.act) ? { chapter: anchor.chapter, scene: anchor.path } : undefined;
      void this.plugin
        .undoable(`New ${this.word(proj, 2)}`, proj, this.plugin.sceneFiles(proj), () => createSceneNamed(this.plugin.app, proj, c, scenes, near))
        .then((f) => openNoteIn(this.plugin, f, this.leaf))
        .catch((e) => notifyError(e, "create the item"));
    }, this.profileOf(proj)).open();
  }

  private newWorld(proj: Project, kind: WorldKind) {
    new NamePrompt(this.plugin.app, `New ${kind.singular}`, `In ${proj.name}`, (name) => {
      void this.plugin
        .undoable(`New ${kind.singular}`, proj, [], () => createWorldEntry(this.plugin.app, proj, kind, name))
        .then((f) => openNoteIn(this.plugin, f, this.leaf))
        .catch((e) => notifyError(e, "create the note"));
    }).open();
  }

  private newCodex(proj: Project, kind: "character" | "location") {
    new NamePrompt(this.plugin.app, kind === "character" ? "New character" : "New place", `In ${proj.name}`, (name) => {
      void createCodex(this.plugin.app, proj, kind, name)
        .then((f) => openNoteIn(this.plugin, f, this.leaf))
        .catch((e) => notifyError(e, "create the note"));
    }).open();
  }
}
