import { WordData } from "./scripture/wordData";
import { Aligner } from "./scripture/aligner";
import { LibraryStores } from "./library/stores";
import { footnoteFor, quoteBlock, type Quotation } from "./reader/quote";
import { quoteFrom } from "./views/reader/quoteClip";
import { SemanticService } from "./semantic/service";
import { SemanticIndexer } from "./semantic/indexer";
import { withoutSummaries } from "./semantic/summary";
import { IndexModal } from "./views/indexModal";
import { AutoSummary } from "./generate/autoSummary";
import { TaskTracker } from "./tasks/tracker";
import { GenService } from "./generate/service";
import { WritingIndex } from "./semantic/writing";
import { BibleSemantic } from "./semantic/bibles";
import { runSelfTest } from "./semantic/selftest";
import { EditorState, Extension } from "@codemirror/state";
import type { Place } from "./reader/place";
import { QuotedIndex } from "./library/quoted";
import { entryForLoc } from "./sources/tree";
import { Editor, Events, MarkdownView, Menu, Notice, Platform, Plugin, TFile, TFolder, WorkspaceLeaf, editorInfoField, editorLivePreviewField, normalizePath } from "obsidian";
import { EditorView } from "@codemirror/view";
import { NameDetector } from "./detector";
import { ExportModal } from "./export/exportModal";
import { migrateSettings } from "./settingsMigrate";
import { BookerSettingTab } from "./settings";
import { StatsTracker, dayKey } from "./stats";
import { addRecord, finish as finishSprint, isDone as sprintIsDone, recordOf, startSprint as newSprint, sprintWords } from "./sprint";
import { BookerSettings, PersistedData } from "./types";
import { StatsView, VIEW_STATS } from "./views/stats";
import { FamilyView, VIEW_FAMILY } from "./views/family";
import { SAMPLE_PROFILES, allProfiles, levelName, hasView, profileById, setCustomProfiles } from "./profiles/profile";
import { hasMiddleLevel, hasTopLevel } from "./profiles/structure";
import { findProjects, getLabels, profileFor, Project, projectOfPath, readMatter, createFromTemplate, readScenes, readTemplates, renumberScenes, repairSequences, writeTemplates, scriptureOn, sequenceChoices, sequenceReport, updateIndexPage, useWordCounts } from "./project/vaultOps";
import { actTitle, chapterTitle } from "./project/format";
import { DEFAULT_BACKUP, isDue, type BackupConfig } from "./backup/plan";
import { backupProject, defaultBackupDir } from "./backup/service";
import { DEFAULT_SCRIPTURE, InsertScriptureModal, type ScriptureData } from "./scripture/insertModal";
import { bookScripture, withBook } from "./scripture/savedStyles";
import { ModuleStore, MODULE_EXTENSIONS, pickFiles } from "./scripture/store";
import { addSource, importBibliography, readSources } from "./sources/library";
import { parseRefs, referenceAt } from "./scripture/ref";
import { BOOK_BY_OSIS } from "./scripture/books";
import { UndoStack } from "./undo";
import { parseBibliography } from "./sources/bib";
import { SourceService } from "./sources/service";
import type { Highlight } from "./sources/highlights";
import type { Source } from "./sources/types";
import { nextLabel } from "./notes/footnote";
import { SourceReaderView, VIEW_SOURCE } from "./views/sourceReader";
import { ReaderView, VIEW_BIBLE } from "./views/reader/readerView";
import { BibleRefsView, VIEW_BIBLE_REFS } from "./views/bibleRefs";
import { SummaryModal } from "./views/summaryModal";
import { BucketView, VIEW_BUCKET } from "./views/bucketView";
import { SelectionStore } from "./scripture/selection";
import { scriptureAssist } from "./scripture/assist";
import { aliasAssist } from "./codex/aliasAssist";
import { vocabAssist } from "./dictionary/vocabAssist";
import { EnglishService } from "./dictionary/service";
import { ResourceService } from "./resourceService";
import { ResourceManager } from "./views/resourceManager";
import { Updater } from "./update/updater";
import { defaultBibleName, quickScripture } from "./scripture/quick";
import { WordStudyModal } from "./scripture/wordStudyModal";
import { AddSourceModal, SearchSourcesModal } from "./views/sourceModals";
import { DbMapModal } from "./views/dbMapModal";
import { runMigration } from "./library/migrate";
import { ChoicePicker, ConfirmModal, ListPicker } from "./ui";
import { SequenceItemModal, SequenceTemplateModal } from "./views/sequenceModal";
import { gapYears, LIFE_TEMPLATE, type SeqTemplate } from "./project/sequence";
import { slug } from "./project/world";
import { ChecksView, VIEW_CHECKS } from "./views/checks";
import { citationLines } from "./sources/citedIn";
import { indexTerms } from "./export/bookIndex";
import { IndexTermsModal } from "./views/indexTermsModal";
import { linkify } from "./linkify";
import { registerEditorMenu } from "./editorMenu";
import { CALLOUT_LABELS, type CalloutKind } from "./notes/callout";
import { wrapCallout } from "./notes/calloutMenu";
import { CiteSuggest } from "./notes/citeSuggest";
import { HealthView, VIEW_HEALTH } from "./views/health";
import { VIEW_INSPECTOR } from "./views/inspector";
import { leafForView, openNoteIn } from "./openTarget";
import { HubView, VIEW_HUB } from "./views/hub";
import { VIEW_SIDE } from "./views/side";
import { LegacyPanel, SidebarView, VIEW_SIDEBAR, type SidebarTab } from "./views/sidebar";
import { BoardView, VIEW_BOARD } from "./views/board";
import { PlotlinesView, VIEW_PLOTLINES } from "./views/plotlines";
import { TimelineMapView, VIEW_TIMELINE_MAP } from "./views/timelineMap";
import { VIEW_WORLD_MAP, WorldMapView } from "./views/worldMap";
import { PlacesStore } from "./places/store";
import { MapsSettingsModal } from "./views/mapsSettings";
import { hideMarksExtension, refreshMarks } from "./writing/hideMarks";
import { openingAttrs } from "./writing/openingStyle";
import { DEFAULT_FORMAT, formatAttrs, refreshFormat, writingExtension, WritingFormat } from "./writing/format";
import { defaultBundle, effectiveFormat, FORMAT_FM_KEY, readProjectFormat, toFormatFm, type FormatBundle, type FormatFm } from "./writing/projectFormat";
import { resolveOpening } from "./writing/initials";
import { formatBarExtension, insertFootnote } from "./writing/bar";
import { EM_SPACE, outdentLine } from "./writing/lines";

export default class BookerPlugin extends Plugin {
  data!: PersistedData;
  settings!: BookerSettings;
  detector!: NameDetector;
  stats!: StatsTracker;
  /** the running or just-finished writing sprint (not saved across restarts) */
  sprint: import("./sprint").Sprint | null = null;
  events = new Events();
  stores = new LibraryStores(this.app);
  tasks = new TaskTracker();
  resources = new ResourceService(this);
  updater = new Updater(this);
  places = new PlacesStore(this);
  english = new EnglishService(this);
  /** the Dictionary card, when it is open: called to look a word up */
  onLookup?: (word: string) => void;
  pendingLookup = "";
  autoSummary = new AutoSummary(this);
  gen = new GenService(this.app, () => this.manifest.dir ?? `${this.app.vault.configDir}/plugins/booker`);
  semanticIndex = new SemanticIndexer(this);
  writingIndex = new WritingIndex(this);
  quoted = new QuotedIndex(this.app, () => this.settings.showQuoted);
  bibleSemantic = new BibleSemantic(this);
  semantic = new SemanticService(this.app, () => this.manifest.dir ?? `${this.app.vault.configDir}/plugins/booker`);
  sourceService = new SourceService(this.app, () => this.manifest.dir ?? `${this.app.vault.configDir}/plugins/booker`);
  private lastMd: MarkdownView | null = null;
  /** The editor of the note you were last writing in. */
  lastEditor() {
    return this.lastMd?.editor ?? null;
  }

  /** Open the Dictionary card and look a word up. */
  async lookupWord(word: string) {
    this.pendingLookup = word;
    await this.openSidebar("dictionary");
    if (this.onLookup) {
      this.pendingLookup = "";
      this.onLookup(word);
    }
  }
  wordData = new WordData(this.app, () => this.resources.wordStudyDir());
  align = new Aligner(this);
  modules = new ModuleStore(this.app, () => this.scriptureData().folder);
  /** the verse selected in the Bible reader; the references tab listens */
  selection = new SelectionStore();

  /** When the user last typed in each note. Edits that arrive from a collaborator do not count as writing. */
  localEdits = new Map<string, number>();
  /** When the user last touched the file explorer, a menu or a dialog. Used to tell their actions from synced-in changes. */
  private intentAt = 0;
  /** the explorer entry (vault path) the user last pressed, right-clicked or dragged */
  private intentPath = "";

  async onload() {
    await this.loadPersisted();
    this.detector = new NameDetector(this);
    this.stats = new StatsTracker(this);

    this.addSettingTab(new BookerSettingTab(this.app, this));

    this.registerView(VIEW_BOARD, (leaf) => new BoardView(leaf, this));
    this.registerView(VIEW_PLOTLINES, (leaf) => new PlotlinesView(leaf, this));
    this.registerView(VIEW_TIMELINE_MAP, (leaf) => new TimelineMapView(leaf, this));
    this.registerView(VIEW_WORLD_MAP, (leaf) => new WorldMapView(leaf, this));
    this.registerView(VIEW_HUB, (leaf) => new HubView(leaf, this));
    this.registerView(VIEW_SIDEBAR, (leaf) => new SidebarView(leaf, this));
    this.registerView(VIEW_SIDE, (leaf) => new LegacyPanel(leaf, this, VIEW_SIDE, "library"));
    this.registerView(VIEW_SOURCE, (leaf) => new SourceReaderView(leaf, this));
    this.registerView(VIEW_BIBLE, (leaf) => new ReaderView(leaf, this));
    this.registerView(VIEW_BIBLE_REFS, (leaf) => new BibleRefsView(leaf, this));
    this.registerView(VIEW_BUCKET, (leaf) => new BucketView(leaf, this));
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file, source) => {
        if (source !== "more-options" || !(file instanceof TFile) || file.extension !== "md" || !projectOfPath(this.app, file.path)) return;
        menu.addItem((i) =>
          i.setSection("view").setTitle("Hide formatting marks").setIcon(this.settings.hideMarks ? "check" : "bold").setChecked(this.settings.hideMarks).onClick(() => void this.toggleMarks())
        );
        menu.addItem((i) =>
          i.setSection("view").setTitle("Book styling").setIcon("indent").setChecked(this.effectiveFormat(file.path).writing.autoIndent).onClick(() => void this.toggleBookStyling(file.path))
        );
      })
    );
    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, ed, view) => {
        const sel = ed.getSelection();
        menu.addItem((i) =>
          i.setTitle(sel ? "Summarize selection with AI" : "Summarize this note with AI").setIcon("sparkles").onClick(() => new SummaryModal(this, sel || withoutSummaries(ed.getValue()), sel ? "selection" : (view as any).file?.basename ?? "note", "written").open())
        );
      })
    );
    // reading view has no menu hook, so show a small menu over selected words there
    this.registerDomEvent(document, "contextmenu", (e) => {
      const t = e.target as HTMLElement;
      if (!t.closest?.(".markdown-preview-view")) return;
      const text = window.getSelection()?.toString().replace(/\s+/g, " ").trim();
      if (!text) return;
      e.preventDefault();
      const menu = new Menu();
      menu.addItem((i) => i.setTitle("Summarize selection with AI").setIcon("sparkles").onClick(() => new SummaryModal(this, text, "selection", "written").open()));
      menu.addItem((i) => i.setTitle("Copy").setIcon("copy").onClick(() => void navigator.clipboard.writeText(text)));
      menu.showAtMouseEvent(e);
    });
    const moved = () => this.autoSummary.moved(this.app.workspace.getActiveViewOfType(MarkdownView)?.file?.path);
    this.registerEvent(this.app.vault.on("modify", (f) => this.autoSummary.touched(f)));
    this.registerEvent(this.app.workspace.on("file-open", moved));
    this.registerEvent(this.app.workspace.on("active-leaf-change", moved));
    this.addCommand({
      id: "write-scene-summary",
      name: "Write the AI summaries for this scene now",
      checkCallback: (checking) => {
        const f = this.app.workspace.getActiveViewOfType(MarkdownView)?.file;
        if (!f) return false;
        if (!checking) void this.autoSummary.now(f);
        return true;
      },
    });
    // words copied or dragged out of a Booker reader arrive as a block quote with their footnote
    this.registerEvent(this.app.workspace.on("editor-paste", (e, ed) => {
      const q = quoteFrom(e.clipboardData);
      if (!q || e.defaultPrevented) return;
      e.preventDefault();
      void this.insertQuoted(q, ed);
    }));
    this.registerEvent(this.app.workspace.on("editor-drop", (e, ed) => {
      const q = quoteFrom(e.dataTransfer);
      if (!q || e.defaultPrevented) return;
      e.preventDefault();
      void this.insertQuoted(q, ed, { x: e.clientX, y: e.clientY });
    }));
    this.registerEvent(this.app.workspace.on("active-leaf-change", (l) => { if (l?.view instanceof MarkdownView) this.lastMd = l.view; }));
    this.registerView(VIEW_STATS, (leaf) => new StatsView(leaf, this));
    this.registerView(VIEW_FAMILY, (leaf) => new FamilyView(leaf, this));
    this.registerView(VIEW_CHECKS, (leaf) => new ChecksView(leaf, this));
    registerEditorMenu(this);
    this.registerMarkdownPostProcessor((el, ctx) => {
      const path = ctx.sourcePath;
      const proj = projectOfPath(this.app, path);
      if (proj) linkify(el, this, { citations: true, refs: scriptureOn(proj), sourcePath: path });
    });
    this.registerEditorSuggest(new CiteSuggest(this));
    this.registerView(VIEW_HEALTH, (leaf) => new HealthView(leaf, this));
    this.registerView(VIEW_INSPECTOR, (leaf) => new LegacyPanel(leaf, this, VIEW_INSPECTOR, "inspector"));

    // a project note's own format changed (here or by hand): redraw every editor
    this.registerEvent(this.app.metadataCache.on("changed", (f) => { if (projectOfPath(this.app, f.path)?.file.path === f.path) this.applyWriting(); }));
    this.registerEditorExtension([this.detector.extension(), this.localEditExtension(), writingExtension((st) => this.effectiveFormat(st.field(editorInfoField, false)?.file?.path).writing), this.formatAttributes(), formatBarExtension(this), scriptureAssist(this), aliasAssist(this), vocabAssist(this), hideMarksExtension((s) => this.marksHiddenIn(s))]);
    this.applyWriting();

    this.trackIntent();
    this.registerInterval(window.setInterval(() => this.checkSprint(), 1000));
    this.registerInterval(window.setInterval(() => void this.runDueBackups(), 5 * 60_000));
    window.setTimeout(() => void this.runDueBackups(), 30_000);
    this.registerCommands();

    const run = (id: string) => () => void (this.app as any).commands.executeCommandById(`booker:${id}`);
    // One ribbon icon opens the hub and the side panel. The other tools keep their place in the list (which of them fit the book, and the bar at the top of the hub) but have no ribbon icon of their own.
    const tool = (key: string, icon: string, title: string, fn: () => void) => {
      const el = key === "hub" ? this.addRibbonIcon(icon, title, fn) : createDiv();
      el.addClass("booker-ribbon");
      this.ribbon.set(key, el);
      if (key !== "hub") this.toolDefs.push({ key, icon, title, fn });
    };
    tool("hub", "feather", "Booker: hub and side panel", () => void Promise.all([this.openHub(), this.openSidebar()]));
    tool("board", "layout-grid", "Board", run("open-board"));
    tool("plotlines", "train-front", "Plotlines", run("open-plotlines-map"));
    tool("timeline", "git-commit-horizontal", "Timeline map", run("open-timeline-map"));
    tool("map", "map", "Map", run("open-world-map"));
    tool("family", "network", "Family tree", run("open-family-tree"));
    tool("stats", "bar-chart-3", "Writing stats", run("open-stats"));
    tool("inspector", "text-cursor-input", "File info (fields of the open note)", run("open-inspector"));
    tool("bible", "book-open", "Bible and document reader, search and commentaries", () => void this.openBible());
    tool("documents", "library", "Booker documents and reference", () => void this.openSide());
    tool("export", "download", "Export", run("export"));
    for (const ev of ["file-open", "active-leaf-change"] as const) this.registerEvent((this.app.workspace as any).on(ev, () => this.applyTools()));
    this.app.workspace.onLayoutReady(() => this.applyTools());
    // a little after start, so it never slows Obsidian down
    this.app.workspace.onLayoutReady(() => void window.setTimeout(() => void this.updater.startup(), 20000));

    const status = this.addStatusBarItem();
    const paintStatus = () => {
      const goal = this.settings.dailyGoal;
      const t = this.stats.today().added;
      status.setText(goal ? `✍ ${t.toLocaleString()} / ${goal.toLocaleString()}` : `✍ ${t.toLocaleString()}`);
      status.setAttr("aria-label", "Words written today. Click for writing stats.");
    };
    paintStatus();
    status.addClass("mod-clickable");
    this.registerDomEvent(status, "click", () => void this.openView(VIEW_STATS));
    this.events.on("stats", paintStatus);

    this.watchNumbering();
    this.registerEvent(this.app.vault.on("modify", (f) => f instanceof TFile && void this.stats.onModify(f)));
    this.registerEvent(this.app.vault.on("rename", (f, old) => f instanceof TFile && this.stats.onRename(old, f)));
    this.registerEvent(this.app.vault.on("delete", (f) => f instanceof TFile && this.stats.onDelete(f.path)));

    this.registerEvent(this.app.workspace.on("file-open", (f) => f && this.detector.repaint(f)));
    for (const ev of ["file-open", "active-leaf-change", "layout-change"] as const) this.registerEvent((this.app.workspace as any).on(ev, () => { this.applyProperties(); this.applySceneTitles(); }));
    this.registerEvent(this.app.metadataCache.on("changed", (f) => f.path.includes("/Scenes/") && this.applySceneTitles()));
    this.app.workspace.onLayoutReady(() => {
      this.applyProperties();
      this.applySceneTitles();
      const hub = this.app.workspace.getLeavesOfType(VIEW_HUB)[0];
      if (hub && hub.getRoot() !== this.app.workspace.leftSplit) void this.openHub();
    });

    const watchProfiles = (f: { path: string }) => f.path === this.profilesPath() && void this.loadProfiles();
    this.registerEvent(this.app.vault.on("modify", watchProfiles));
    this.registerEvent(this.app.vault.on("create", watchProfiles));
    this.registerEvent(this.app.vault.on("delete", watchProfiles));
    this.app.workspace.onLayoutReady(() => void this.loadProfiles());
    this.app.workspace.onLayoutReady(() => void window.setTimeout(() => void this.resources.installBundledDictionaries().then((added) => added && this.english.reset()).catch(() => undefined), 5000));
    this.app.workspace.onLayoutReady(() => void window.setTimeout(() => void this.checkSequences(), 6000));
    // match every Bible's words to Strong's numbers once the app has settled
    this.app.workspace.onLayoutReady(() => void window.setTimeout(() => void this.align.ensureAll(), 8000));

    this.app.workspace.onLayoutReady(async () => {
      await this.stats.reconcile();
      this.events.trigger("stats");
      paintStatus();
    });
  }

  /** Where the user's own book templates are kept. */
  profilesPath() {
    return normalizePath(`${this.settings.projectRoot || "Booker"}/Book templates.json`);
  }

  async loadProfiles() {
    const f = this.app.vault.getFileByPath(this.profilesPath());
    let saved: unknown = null;
    if (f) {
      try {
        saved = JSON.parse(await this.app.vault.cachedRead(f));
      } catch {
        new Notice("Booker could not read the book templates file. Check it is valid JSON.");
      }
    }
    setCustomProfiles(saved);
  }

  /** Create the templates file with a worked example (never overwrites) and open it. */
  async openProfilesFile() {
    let f = this.app.vault.getFileByPath(this.profilesPath());
    if (!f) {
      const dir = this.profilesPath().replace(/\/[^/]+$/, "");
      if (!this.app.vault.getAbstractFileByPath(dir)) await this.app.vault.createFolder(dir);
      f = await this.app.vault.create(this.profilesPath(), SAMPLE_PROFILES);
    }
    await this.app.workspace.getLeaf("tab").openFile(f);
  }

  onunload() {
    this.autoSummary.stop();
  }

  // ------------------------------------------------------------ persistence

  private async loadPersisted() {
    const raw = (await this.loadData()) as Partial<PersistedData> | null;
    const migrated = migrateSettings(raw);
    this.data = {
      settingsVersion: migrated.version,
      settings: migrated.settings,
      wordCounts: raw?.wordCounts ?? {},
      days: raw?.days ?? {},
      exportOptions: raw?.exportOptions,
      exportPresets: raw?.exportPresets,
      sprints: raw?.sprints,
      ignoredWords: raw?.ignoredWords,
      dismissedHealth: raw?.dismissedHealth,
      backupFolderTold: raw?.backupFolderTold,
      backups: raw?.backups,
      scripture: raw?.scripture,
    };
    this.settings = this.data.settings;
    if (migrated.changed) await this.persist();
    useWordCounts(this.data.wordCounts);
  }

  // ------------------------------------------------------------ undo

  undo = new UndoStack({
    read: async (path) => {
      const f = this.app.vault.getFileByPath(path);
      if (f) return this.app.vault.read(f);
      return (await this.app.vault.adapter.exists(path)) ? this.app.vault.adapter.read(path) : null;
    },
    write: async (path, text) => {
      const f = this.app.vault.getFileByPath(path);
      if (f) return this.app.vault.modify(f, text);
      const dir = path.split("/").slice(0, -1).join("/");
      if (dir && !(await this.app.vault.adapter.exists(dir))) await this.app.vault.adapter.mkdir(dir);
      if (path.endsWith(".md")) await this.app.vault.create(path, text);
      else await this.app.vault.adapter.write(path, text);
    },
    remove: async (path) => {
      const f = this.app.vault.getFileByPath(path);
      if (f) await this.app.fileManager.trashFile(f);
      else if (await this.app.vault.adapter.exists(path)) await this.app.vault.adapter.remove(path);
    },
    list: (folder) => this.app.vault.getMarkdownFiles().map((f) => f.path).filter((p) => p.startsWith(folder + "/")),
  });

  /**
   * Run an action that changes notes and offer to take it back (a notice with Undo, the Undo command, the hub menu).
   * `touch` are the notes it may change or delete; notes it creates are found by themselves.
   */
  async undoable<T>(label: string, proj: Project | null, touch: string[], fn: () => Promise<T>): Promise<T> {
    const base = proj ? [proj.file.path, `${proj.layout.system}/structure.json`, ...touch] : touch;
    const folder = proj?.layout.base ?? "";
    const result = await this.undo.run(label, base, folder, fn);
    const n = new Notice("", 7000);
    n.messageEl.createSpan({ text: `${label}. ` });
    const a = n.messageEl.createEl("a", { text: "Undo" });
    a.addEventListener("click", () => {
      n.hide();
      void this.undoLast();
    });
    return result;
  }

  async undoLast() {
    try {
      const label = await this.undo.undo();
      new Notice(label ? `Booker: undid “${label}”.` : "Booker: nothing to undo.");
    } catch (e) {
      new Notice(`Booker: could not undo. ${e instanceof Error ? e.message : e}`);
    }
  }

  /** Every scene note of a project (and its project note), for actions that renumber or move scenes. */
  sceneFiles(proj: Project): string[] {
    return readScenes(this.app, proj).map((s) => s.path);
  }

  // ------------------------------------------------------------ sources

  sources(): Source[] {
    return readSources(this.app);
  }

  lastMarkdownView(): MarkdownView | null {
    const v = this.lastMd;
    return v && v.leaf && this.app.workspace.getLeavesOfType("markdown").some((l) => l.view === v) ? v : null;
  }

  /** Run an editing action on the note last being edited (the side panels hold the focus when you click them). */
  withEditor(fn: (editor: Editor) => void) {
    const v = this.lastMarkdownView();
    if (!v) return void new Notice("Booker: click into a note first, then use this.");
    fn(v.editor);
  }

  /** Run an editor command on the note last being edited. */
  runCommandInEditor(id: string) {
    const v = this.lastMarkdownView();
    if (!v) return void new Notice("Booker: click into a note first, then use this.");
    this.app.workspace.setActiveLeaf(v.leaf, { focus: true });
    this.runCommand(id);
  }

  runCommand(id: string) {
    (this.app as any).commands.executeCommandById(`booker:${id}`);
  }

  /** Open a document or database in the Reader, to navigate it. `chunk` is a piece of a document; a highlight (`hl`) opens the older viewer that draws highlights. */
  async openSource(s: Source, state: { chunk?: number; hl?: string } = {}) {
    if (state.hl) return this.openSourceViewer(s, state);
    await this.openPlace({ kind: "work", uid: s.uid, entry: s.kind !== "db" && state.chunk !== undefined ? state.chunk + 1 : 0 });
  }

  /** Open the Reader at a search hit: for a database, the entry the hit is in. */
  async openHit(h: { source: Source; chunkNo: number; chunk: { loc: string } }) {
    if (h.source.kind === "db") {
      const entries = await this.sourceService.entries(h.source);
      return this.openPlace({ kind: "work", uid: h.source.uid, entry: entryForLoc(entries, h.chunk.loc)?.id ?? 0 });
    }
    return this.openPlace({ kind: "work", uid: h.source.uid, entry: h.chunkNo + 1 });
  }

  /** Open the Reader at a place, reusing the Reader tab that is open. */
  async openPlace(place: Place) {
    const leaf = this.app.workspace.getLeavesOfType(VIEW_BIBLE)[0] ?? this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: VIEW_BIBLE, active: true, state: { place } });
    this.app.workspace.revealLeaf(leaf);
  }

  async openSourceViewer(s: Source, state: { chunk?: number; hl?: string } = {}) {
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: VIEW_SOURCE, active: true, state: { uid: s.uid, ...state } });
    this.app.workspace.revealLeaf(leaf);
  }

  /** Put a quotation from a source into the note being edited, with a footnote that cites it. */
  insertQuote(src: Source, h: Highlight, loc: string) {
    const view = this.lastMarkdownView();
    if (!view) return void new Notice("Booker: open a note to quote into first. The highlight is saved.");
    const ed = view.editor;
    const label = nextLabel(ed.getValue());
    const quote = h.text.split(/\n+/).map((l) => `> ${l}`).join("\n>\n");
    const cur = ed.getCursor();
    const lead = ed.getLine(cur.line).slice(0, cur.ch).trim() ? "\n\n" : "";
    ed.replaceSelection(`${lead}${quote}[^${label}]\n\n`);
    const doc = ed.getValue().replace(/\s+$/, "");
    const last = doc.slice(doc.lastIndexOf("\n") + 1);
    const sep = /^\[\^[^\]\[\n]{1,200}\]:/.test(last) ? "\n" : "\n\n";
    ed.replaceRange(`${sep}[^${label}]: [@${src.citekey}, ${loc}] %%booker-hl:${src.uid}:${h.uid}%%\n`, ed.offsetToPos(doc.length), ed.offsetToPos(ed.getValue().length));
    new Notice("Quoted, with a footnote.");
  }

  /** Add a word or name to the index terms of the book a note belongs to. */
  async addIndexTerm(path: string, term: string) {
    const proj = findProjects(this.app).find((p) => path.startsWith(`${p.file.parent?.path}/`));
    if (!proj) return void new Notice("Booker: this note is not in a book.");
    let added = false;
    await this.app.fileManager.processFrontMatter(proj.file, (fm) => {
      const have = indexTerms(fm.indexTerms);
      if (have.some((t) => t.toLowerCase() === term.toLowerCase())) return;
      fm.indexTerms = [...have, term];
      added = true;
    });
    if (added) await updateIndexPage(this.app, proj);
    new Notice(added ? `Booker: “${term}” will be in the index.` : `Booker: “${term}” is already in the index.`);
  }

  /** Every place in your books that cites a source. */
  async citedIn(key: string): Promise<Array<{ path: string; title: string; line: number; snippet: string }>> {
    const out: Array<{ path: string; title: string; line: number; snippet: string }> = [];
    for (const proj of findProjects(this.app)) {
      const notes = [...readScenes(this.app, proj).map((s) => ({ path: s.path, title: s.title })), ...readMatter(this.app, proj).map((m) => ({ path: m.path, title: m.title }))];
      for (const n of notes) {
        const f = this.app.vault.getFileByPath(n.path);
        if (!f) continue;
        for (const c of citationLines(await this.app.vault.cachedRead(f), key)) out.push({ ...n, ...c });
      }
    }
    return out;
  }

  /** Pick a source and write [@key, ] at the cursor, ready for the page. */
  citeHere(editor: Editor) {
    void this.pickSource((s) => {
      const text = `[@${s.citekey}, ]`;
      const from = editor.getCursor("from");
      editor.replaceSelection(text);
      editor.setCursor({ line: from.line, ch: from.ch + text.length - 1 });
    });
  }

  insertCitation(src: Source, loc: string) {
    const view = this.lastMarkdownView();
    if (!view) return void new Notice("Booker: open a note to cite into first.");
    view.editor.replaceSelection(`[@${src.citekey}${loc ? `, ${loc}` : ""}]`);
  }

  async pickSource(then: (s: Source) => void) {
    const all = this.sources();
    if (!all.length) return void new Notice("Booker: no sources yet. Run Add source first.");
    new ListPicker(this.app, all, (s) => `${s.title}${s.authors.length ? ` — ${s.authors.join(", ")}` : ""}`, "Which source?", then).open();
  }

  // ------------------------------------------------------------ scripture

  scriptureData(): ScriptureData {
    const d = this.data.scripture;
    return { ...DEFAULT_SCRIPTURE, ...d, style: { ...DEFAULT_SCRIPTURE.style, ...d?.style } };
  }

  async saveScripture(d: ScriptureData) {
    this.data.scripture = d;
    await this.persist();
  }

  /** The scripture settings for the book being worked on: its own Bible and verse style when it has them. */
  scriptureForBook(): ScriptureData {
    const proj = this.currentProject();
    const fm = proj ? this.app.metadataCache.getFileCache(proj.file)?.frontmatter : undefined;
    return withBook(this.scriptureData(), bookScripture(fm));
  }

  /** Open the Insert scripture window and put the result at the cursor of the note being edited. */
  insertScripture(editor: Editor, initial = "") {
    const proj = this.currentProject();
    const data = this.scriptureForBook();
    const own = proj ? bookScripture(this.app.metadataCache.getFileCache(proj.file)?.frontmatter) : {};
    const bookHasOwn = !!(own.bible || own.verseStyle);
    // a book with its own Bible and style keeps them; the window then changes only what it writes this time (and the saved styles)
    const save = async () => {
      const g = this.scriptureData();
      await this.saveScripture(bookHasOwn ? { ...g, savedStyles: data.savedStyles } : { ...g, defaultModule: data.defaultModule, style: data.style, savedStyles: data.savedStyles });
    };
    const scope = proj
      ? { name: proj.name, apply: async (module: string, styleName: string | undefined) => void (await this.app.fileManager.processFrontMatter(proj.file, (fm) => { fm.bible = module; if (styleName) fm.verseStyle = styleName; else delete fm.verseStyle; })) }
      : undefined;
    new InsertScriptureModal(this.app, this.modules, data, save, (text) => {
      const cur = editor.getCursor();
      const before = editor.getLine(cur.line).slice(0, cur.ch);
      const lead = text.startsWith(">") && before.trim() ? "\n\n" : "";
      editor.replaceSelection(lead + text + (text.startsWith(">") ? "\n" : ""));
    }, initial, (ref) => void this.openBible(ref), scope, (ref) => {
      const p = parseRefs(ref)?.[0];
      if (p && BOOK_BY_OSIS.has(p.book)) void this.openCommentary({ book: p.book, chapter: p.from.c, verse: p.from.v ?? 0, ...(p.to.v && p.from.v && p.to.v > p.from.v && p.to.c === p.from.c && { verseTo: p.to.v }) });
      else new Notice("Booker: type a reference first, such as John 3:16.");
    }).open();
  }

  /** Open the reader and run a search in it. */
  async runReaderSearch(query: string, scope: string, mode: string) {
    await this.openBible();
    const leaf = this.app.workspace.getLeavesOfType(VIEW_BIBLE)[0];
    (leaf?.view as any)?.runSearch?.(query, scope, mode);
  }

  /** Open the Bible reader, on a passage when one is given ("John 3:16"). */
  async openBible(ref?: string) {
    const p = ref ? parseRefs(ref)?.[0] : undefined;
    let leaf = this.app.workspace.getLeavesOfType(VIEW_BIBLE)[0];
    if (!leaf) leaf = this.app.workspace.getLeaf("tab");
    const state = p ? { place: { kind: "bible", module: "", book: p.book, chapter: p.from.c, verse: p.from.v ?? 0 } } : (leaf.view as any)?.getState?.() ?? { place: { kind: "bible", module: "", book: "John", chapter: 1, verse: 0 } };
    await leaf.setViewState({ type: VIEW_BIBLE, active: true, state });
    this.app.workspace.revealLeaf(leaf);
  }

  /**
   * Open the references tab beside a Bible reader, to its right or (left = true) to its left. An open tab is reused;
   * `recreate` closes it first so it can move to the other side. On a phone it opens as an ordinary tab.
   */
  async openRefs(from?: WorkspaceLeaf, left = false, recreate = false) {
    const ws = this.app.workspace;
    let leaf = ws.getLeavesOfType(VIEW_BIBLE_REFS)[0];
    if (leaf && recreate) {
      leaf.detach();
      leaf = undefined as any;
    }
    if (!leaf) {
      leaf = Platform.isMobile || !from ? ws.getLeaf("tab") : ws.createLeafBySplit(from, "vertical", left);
      const sel = this.selection.get();
      await leaf.setViewState({ type: VIEW_BIBLE_REFS, active: false, state: sel ? { ...sel } : {} });
    }
    ws.revealLeaf(leaf);
  }

  /** Open the references window on the commentaries for a verse, beside the reader if it is not open yet. */
  async openCommentary(sel: { book: string; chapter: number; verse: number; verseTo?: number }, from?: WorkspaceLeaf) {
    await this.openRefs(from ?? this.app.workspace.getLeavesOfType(VIEW_BIBLE)[0], this.scriptureData().refsSide === "left");
    (this.app.workspace.getLeavesOfType(VIEW_BIBLE_REFS)[0]?.view as BibleRefsView | undefined)?.showCommentary(sel);
  }

  /** Open a word in the Word study tab of the references window, which opens beside the reader if it is not open. */
  async openWordStudy(word: Extract<Place, { kind: "word" }>, from?: WorkspaceLeaf) {
    await this.openRefs(from, this.scriptureData().refsSide === "left");
    (this.app.workspace.getLeavesOfType(VIEW_BIBLE_REFS)[0]?.view as BibleRefsView | undefined)?.showWord(word);
  }

  /** Open the reader on its Library tab, on a source when one is given. */
  async openLibrary(s?: Source, cmt?: { path: string; book?: string; chapter?: number; verse?: number; verseTo?: number }) {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_BIBLE)[0];
    if (!leaf) leaf = this.app.workspace.getLeaf("tab");
    const place = cmt ? { kind: "commentary", ...cmt } : s ? { kind: "work", uid: s.uid, entry: 0 } : { kind: "shelf" };
    const state = { place };
    await leaf.setViewState({ type: VIEW_BIBLE, active: true, state });
    this.app.workspace.revealLeaf(leaf);
  }

  /** Write the verses of a reference at the cursor of the note being edited. */
  async insertVerseIntoNote(ref: string, withFootnote = false) {
    const view = this.lastMarkdownView();
    if (!view) return void new Notice("Booker: open a note to write into first.");
    const text = await quickScripture(this, ref);
    if (!text) return;
    const ed = view.editor;
    const cur = ed.getCursor();
    const lead = text.startsWith(">") && ed.getLine(cur.line).slice(0, cur.ch).trim() ? "\n\n" : "";
    ed.replaceSelection(lead + text + (text.startsWith(">") ? "\n" : ""));
    if (withFootnote) {
      const bible = await defaultBibleName(this);
      await this.footnoteAtCursor(ed, `${bible ? `${bible}, ` : ""}${ref}.`, text.startsWith(">") ? 1 : 0);
    }
  }

  /** Quote a note from a commentary: the words as a block quote and a footnote saying who wrote them and where. */
  async quoteCommentary(ref: string, who: string, text: string, commentary: string) {
    const view = this.lastMarkdownView();
    if (!view) return void new Notice("Booker: open a note to quote into first.");
    const ed = view.editor;
    const cur = ed.getCursor();
    const lead = ed.getLine(cur.line).slice(0, cur.ch).trim() ? "\n\n" : "";
    // text after the cursor must start its own paragraph, or Markdown folds it into the quote
    const trail = ed.getLine(cur.line).slice(cur.ch).trim() ? "\n\n" : "\n";
    const quote = text.trim().split(/\n+/).map((l) => `> ${l}`).join("\n>\n");
    ed.replaceSelection(`${lead}${quote}${trail}`);
    await this.footnoteAtCursor(ed, `${who ? `${who}, ` : ""}${commentary ? `in ${commentary}, ` : ""}on ${ref}.`, trail.length);
  }

  /** Write words picked from a reading into the note being edited, as a block quote with a footnote naming where they came from. */
  async insertQuotation(text: string, citation: string, source: string, flags: Pick<Quotation, "letters" | "inline"> = {}) {
    await this.insertQuoted({ text, footnote: footnoteFor(source, citation), ...flags });
  }

  /** The same for words already carrying their footnote; `at` is a spot in the editor (a drop) to write at instead of the cursor. */
  async insertQuoted(q: Quotation, into?: Editor, at?: { x: number; y: number }) {
    const ed = into ?? this.lastMarkdownView()?.editor;
    if (!ed) return void new Notice("Booker: open a note to write into first.");
    const cm = (ed as any).cm as EditorView | undefined;
    const pos = at && cm ? cm.posAtCoords(at) : null;
    if (pos !== null && cm) cm.dispatch({ selection: { anchor: pos } });
    const cur = ed.getCursor();
    const lead = ed.getLine(cur.line).slice(0, cur.ch).trim() ? "\n\n" : "";
    if (q.inline) {
      ed.replaceSelection(`${lead ? " " : ""}“${q.text.trim().replace(/\s+/g, " ")}”`);
      if (q.footnote) await this.footnoteAtCursor(ed, q.footnote, 0, q.letters);
      return;
    }
    // text after the cursor must start its own paragraph, or Markdown folds it into the quote
    const trail = ed.getLine(cur.line).slice(cur.ch).trim() ? "\n\n" : "\n";
    ed.replaceSelection(`${lead}${quoteBlock(q.text)}${trail}`);
    if (q.footnote) await this.footnoteAtCursor(ed, q.footnote, trail.length, q.letters);
  }

  /** A footnote mark at the cursor (backing up `back` characters first) with its text written in the note line. */
  private async footnoteAtCursor(ed: Editor, body: string, back: number, letters = false) {
    const cm = (ed as any).cm as EditorView | undefined;
    if (!cm) return;
    const pos = cm.state.selection.main.head - back;
    cm.dispatch({ selection: { anchor: pos } });
    insertFootnote(cm, letters);
    ed.replaceSelection(body);
  }

  async addBibleModules() {
    const files = await pickFiles(MODULE_EXTENSIONS);
    for (const f of files) {
      try {
        await this.modules.add(f.name, await f.arrayBuffer());
        new Notice(`Booker: added ${f.name}.`);
        void this.align.ensureAll();
      } catch (e) {
        new Notice(`Booker: could not add ${f.name}. ${e instanceof Error ? e.message : e}`);
      }
    }
  }

  // ------------------------------------------------------------ project backups

  private backingUp = new Set<string>();

  backupConfig(proj: Project): BackupConfig {
    const cfg = { ...DEFAULT_BACKUP, ...(this.data.backups?.[proj.file.path] ?? {}) };
    // backups are on from the start: until a folder is chosen they go to the default one
    return cfg.dir.trim() ? cfg : { ...cfg, dir: defaultBackupDir() };
  }

  async setBackupConfig(proj: Project, cfg: BackupConfig) {
    (this.data.backups ??= {})[proj.file.path] = cfg;
    await this.persist();
  }

  /** The health warnings dismissed for a book (ids from findingId). */
  dismissedHealth(proj: Project): string[] {
    return this.data.dismissedHealth?.[proj.file.path] ?? [];
  }

  async setHealthDismissed(proj: Project, id: string, dismissed: boolean) {
    const all = (this.data.dismissedHealth ??= {});
    const list = new Set(all[proj.file.path] ?? []);
    if (dismissed) list.add(id);
    else list.delete(id);
    if (list.size) all[proj.file.path] = [...list];
    else delete all[proj.file.path];
    await this.persist();
  }

  /** Back one project up now. Returns the one-line result, or null if a backup of it is already running. */
  async backupNow(proj: Project, quiet = false): Promise<string | null> {
    const key = proj.file.path;
    if (this.backingUp.has(key)) return null;
    const cfg = this.backupConfig(proj);
    if (!cfg.dir.trim()) {
      if (!quiet) new Notice("Booker: choose a backup folder in Project settings first.");
      return null;
    }
    // backups are on from the start, so say once where they go when that is a folder outside the vault
    if (!this.data.backupFolderTold && !this.data.backups?.[key]?.dir?.trim()) {
      this.data.backupFolderTold = true;
      void this.persist();
      new Notice(`Booker backs your projects up every day to “${cfg.dir}”, outside your vault. Change the folder or the schedule in Project settings.`, 15000);
    }
    this.backingUp.add(key);
    const task = this.tasks.add(`Backing up ${proj.name}`, { state: "running" });
    try {
      const r = await backupProject(this.app, proj, cfg);
      this.tasks.finish(task, r.kind === "nothing" ? "skipped" : "done", r.note);
      await this.setBackupConfig(proj, { ...cfg, lastAt: Date.now(), lastNote: r.note });
      if (!quiet || r.kind !== "nothing") new Notice(`Booker: ${proj.name} backed up. ${r.note}`);
      return r.note;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.tasks.finish(task, "failed", msg);
      await this.setBackupConfig(proj, { ...cfg, lastNote: `Failed: ${msg}` });
      new Notice(`Booker: backup of ${proj.name} failed. ${msg}`);
      return null;
    } finally {
      this.backingUp.delete(key);
    }
  }

  private async runDueBackups() {
    for (const proj of findProjects(this.app)) {
      if (isDue(this.backupConfig(proj))) await this.backupNow(proj, true);
    }
  }

  // ------------------------------------------------------------ writing sprints

  /** Start a sprint of this many minutes. */
  beginSprint(minutes: number) {
    this.sprint = newSprint(minutes, this.stats.sessionAdded);
    this.events.trigger("sprint");
  }

  /** End the running sprint now and keep it in the history. */
  endSprint() {
    if (!this.sprint || this.sprint.recorded) return;
    this.sprint = finishSprint(this.sprint, this.stats.sessionAdded);
    this.keepSprint();
  }

  private keepSprint() {
    const sp = this.sprint;
    if (!sp || sp.recorded) return;
    sp.recorded = true;
    if (sprintWords(sp, sp.endTotal ?? this.stats.sessionAdded) > 0 || (sp.endedAt ?? 0) - sp.startedAt > 60000) {
      this.data.sprints = addRecord(this.data.sprints ?? [], recordOf(sp, sp.endTotal ?? this.stats.sessionAdded));
      void this.persist();
    }
    this.events.trigger("sprint");
  }

  /** Once a second: a sprint whose time has run out is finished and kept. */
  private checkSprint() {
    const sp = this.sprint;
    if (!sp || sp.recorded || !sprintIsDone(sp)) return;
    this.sprint = finishSprint(sp, this.stats.sessionAdded);
    this.keepSprint();
    new Notice(`Sprint over: ${sprintWords(this.sprint, this.sprint.endTotal ?? 0).toLocaleString()} words`);
  }

  /** The writing format with any missing field filled from the defaults. */
  writing(): WritingFormat {
    return { ...DEFAULT_FORMAT, ...(this.settings.writing ?? {}) };
  }

  /** Hide the Properties block in notes of a project (scenes, codex, notes), or show it again. */
  applyProperties() {
    const bases = this.settings.hideProperties ? findProjects(this.app).map((p) => p.layout.base + "/") : [];
    const series = this.settings.hideProperties ? findProjects(this.app).flatMap((p) => (p.series ? [p.series.folder + "/"] : [])) : [];
    this.app.workspace.iterateAllLeaves((l) => {
      const path = (l.view as any)?.file?.path as string | undefined;
      const el = (l.view as any)?.containerEl as HTMLElement | undefined;
      if (!el) return;
      el.toggleClass("booker-hide-props", !!path && [...bases, ...series].some((b) => path.startsWith(b)));
    });
  }

  /**
   * In a scene note, swap Obsidian's file-name title for a generated one above the text: the chapter and its name,
   * then the scene ("Scene 3 - The Title"). Nothing is written into the note.
   */
  applySceneTitles() {
    const projects = findProjects(this.app);
    this.app.workspace.iterateAllLeaves((l) => {
      const view = l.view as any;
      const el = view?.containerEl as HTMLElement | undefined;
      const file = view?.file as TFile | undefined;
      if (!el || !file || l.view.getViewType() !== "markdown") return;
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
      const proj = fm?.type === "scene" ? projects.find((p) => file.path.startsWith(p.layout.scenes + "/")) : undefined;
      el.querySelectorAll(".booker-scene-title").forEach((n) => n.remove());
      el.toggleClass("booker-scene-titled", !!proj);
      if (!proj || !fm) return;
      const host = el.querySelector(".cm-sizer") ?? el.querySelector(".markdown-preview-sizer");
      if (!host) return;
      const box = createDiv({ cls: "booker-scene-title" });
      const labels = getLabels(this.app, proj);
      const prof = profileFor(proj);
      const where = [
        hasTopLevel(prof) && fm.act !== undefined && fm.act !== 0 && String(fm.act) !== "1" ? actTitle(fm.act, labels, levelName(prof, 0)) : "",
        hasMiddleLevel(prof) && fm.chapter !== undefined ? chapterTitle(fm.chapter, labels, levelName(prof, 1)) : "",
      ].filter(Boolean).join(" — ");
      if (where) box.createDiv({ cls: "booker-scene-title-where", text: where });
      box.createDiv({ cls: "booker-scene-title-name", text: String(fm.title ?? file.basename) });
      host.insertBefore(box, host.firstChild);
    });
  }

  /** Show or hide the Properties block in project notes. */
  async toggleProperties() {
    this.settings.hideProperties = !this.settings.hideProperties;
    await this.persist();
    this.applyProperties();
    new Notice(`Booker: properties are ${this.settings.hideProperties ? "hidden" : "shown"} in project notes.`);
  }

  /** Hide the marks of bold and italic words in project notes (Live Preview only; Source mode shows everything). */
  marksHiddenIn(state: EditorState): boolean {
    if (!this.settings.hideMarks || !state.field(editorLivePreviewField, false)) return false;
    const path = state.field(editorInfoField, false)?.file?.path;
    return !!path && !!projectOfPath(this.app, path);
  }

  /** Show or hide the marks, from the setting or the note's ⋯ menu. */
  async toggleMarks() {
    this.settings.hideMarks = !this.settings.hideMarks;
    await this.persist();
    this.applyMarks();
  }

  /** Redraw the Reader and the References window after what your notes quote changed or was switched off. */
  refreshQuoted() {
    this.app.workspace.iterateAllLeaves((l) => (l.view as any)?.refreshQuoted?.());
  }

  async toggleQuoted() {
    this.settings.showQuoted = !this.settings.showQuoted;
    await this.persist();
    this.refreshQuoted();
  }

  applyMarks() {
    this.app.workspace.iterateAllLeaves((l) => {
      (l.view as any)?.editor?.cm?.dispatch?.({ effects: refreshMarks.of(null) });
    });
  }

  /** Re-typeset every open editor after the format changed. */
  /** The plugin's default writing format and chapter opening. */
  defaultFormat(): FormatBundle {
    return defaultBundle(this.writing(), this.settings.opening);
  }

  /** The format a note is written in: its project's own, or the plugin default when the project has none. A note outside a project gets the default. */
  effectiveFormat(path?: string): FormatBundle {
    const def = this.defaultFormat();
    const proj = path ? projectOfPath(this.app, path) : null;
    if (!proj) return def;
    return effectiveFormat(def, readProjectFormat(this.app.metadataCache.getFileCache(proj.file)?.frontmatter));
  }

  /** A project's own format, or null when it uses the default. */
  projectFormat(proj: Project): FormatFm | null {
    return readProjectFormat(this.app.metadataCache.getFileCache(proj.file)?.frontmatter);
  }

  /** Give a project its own format (a whole bundle), or null to go back to the plugin default. */
  async setProjectFormat(proj: Project, b: FormatBundle | null) {
    // wait for Obsidian to read the note again, so what is shown next is what was just saved
    const seen = new Promise<void>((done) => {
      const ref = this.app.metadataCache.on("changed", (f) => {
        if (f === proj.file) {
          this.app.metadataCache.offref(ref);
          done();
        }
      });
      window.setTimeout(() => (this.app.metadataCache.offref(ref), done()), 1500);
    });
    await this.app.fileManager.processFrontMatter(proj.file, (fm) => {
      if (b) fm[FORMAT_FM_KEY] = toFormatFm(b);
      else delete fm[FORMAT_FM_KEY];
    });
    await seen;
    this.applyWriting();
  }

  /** Change the format that applies to a note: its project's own when it has one, otherwise the plugin default for every project that uses it. */
  async patchFormatFor(path: string | undefined, patch: { writing?: Partial<WritingFormat>; opening?: Partial<import("./writing/initials").Opening> }) {
    const proj = path ? projectOfPath(this.app, path) : null;
    if (proj && this.projectFormat(proj)) {
      const cur = this.effectiveFormat(path);
      return this.setProjectFormat(proj, { writing: { ...cur.writing, ...patch.writing }, opening: resolveOpening({ ...cur.opening, ...patch.opening }) });
    }
    if (patch.writing) this.settings.writing = { ...this.writing(), ...patch.writing };
    if (patch.opening) this.settings.opening = resolveOpening({ ...this.settings.opening, ...patch.opening });
    await this.persist();
    this.applyWriting();
  }

  async toggleBookStyling(path: string) {
    await this.patchFormatFor(path, { writing: { autoIndent: !this.effectiveFormat(path).writing.autoIndent } });
  }

  /** The classes and variables each editor gets for its own project's format. */
  private formatAttributes(): Extension {
    return EditorView.editorAttributes.of((view) => {
      const f = this.effectiveFormat(view.state.field(editorInfoField, false)?.file?.path);
      const w = formatAttrs(f.writing);
      // Book styling off gives plain paragraphs: no automatic indent and no large first letter
      const o = openingAttrs(f.writing.autoIndent ? f.opening : { style: "off" });
      return { class: `${w.class} ${o.class}`.trim(), style: w.style + o.style };
    });
  }

  applyWriting() {
    this.app.workspace.iterateAllLeaves((l) => {
      const cm = (l.view as any)?.editor?.cm;
      cm?.dispatch?.({ effects: refreshFormat.of(null) });
    });
  }

  async persist() {
    await this.saveData(this.data);
  }

  exportFolder(): string {
    const parts = (this.settings.exportFolder || "").split(/[\\/]+/).filter((x) => x && x !== "." && x !== "..");
    return normalizePath(parts.join("/") || "Booker Exports");
  }

  // ------------------------------------------------------- local-intent gates

  private localEditExtension() {
    return EditorView.updateListener.of((u) => {
      if (!u.docChanged) return;
      const typed = u.transactions.some((t) => ["input", "delete", "paste", "cut", "undo", "redo", "move", "drop"].some((e) => t.isUserEvent(e)));
      if (!typed) return;
      const p = this.app.workspace.getActiveFile()?.path;
      if (p) this.localEdits.set(p, Date.now());
    });
  }

  private trackIntent() {
    const touch = (e: Event) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.('.nav-files-container, .nav-header, .menu, .modal, .workspace-leaf-content[data-type="file-explorer"]')) this.intentAt = Date.now();
      // remember which explorer entry is being acted on (menus and dialogs carry no path, so they keep the last one)
      const entry = t?.closest?.(".nav-file-title[data-path], .nav-folder-title[data-path]") as HTMLElement | null | undefined;
      const path = entry?.getAttribute("data-path");
      if (path) this.intentPath = path;
    };
    this.registerDomEvent(document, "pointerdown", touch, true);
    this.registerDomEvent(document, "contextmenu", touch, true);
    this.registerDomEvent(document, "dragstart", touch, true);
    this.registerDomEvent(document, "keydown", touch, true);
    this.registerDomEvent(document, "drop", () => (this.intentAt = Date.now()), true);
  }

  /** True when the user's own recent explorer action was on exactly this vault path. */
  intentOn(path: string, ms: number): boolean {
    return !!path && this.intentPath === path && this.recentIntent(ms);
  }

  /** True when the user did something in the explorer, a menu or a dialog within the last `ms`. */
  recentIntent(ms: number): boolean {
    return Date.now() - this.intentAt < ms;
  }

  // ------------------------------------------------------------------ views

  /** The views that show one project's data, so they follow the project picked at the top of the hub. */
  private projectViews = [VIEW_BOARD, VIEW_PLOTLINES, VIEW_TIMELINE_MAP, VIEW_WORLD_MAP, VIEW_CHECKS, VIEW_HEALTH, VIEW_STATS, VIEW_FAMILY];

  /** Books with numbered scenes keep "Scene N" in step when a scene is added, removed, moved or retitled. */
  private watchNumbering() {
    const seen = new Map<string, string>();
    let timer: number | undefined;
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(async () => {
        for (const proj of findProjects(this.app)) if (proj.numberScenes) await renumberScenes(this.app, proj).catch(() => 0);
      }, 1500);
    };
    const isSceneFile = (path: string) => path.includes("/Scenes/");
    this.registerEvent(
      this.app.metadataCache.on("changed", (f, _d, cache) => {
        if (!isSceneFile(f.path) || cache.frontmatter?.type !== "scene") return;
        const fm = cache.frontmatter;
        const sig = `${fm.act}|${fm.chapter}|${fm.sequence}|${fm.title}`;
        if (seen.get(f.path) !== sig) {
          seen.set(f.path, sig);
          schedule();
        }
      })
    );
    for (const ev of ["delete", "rename", "create"] as const) this.registerEvent((this.app.vault as any).on(ev, (f: any) => f instanceof TFile && isSceneFile(f.path) && schedule()));
  }

  private ribbon = new Map<string, HTMLElement>();
  private toolDefs: Array<{ key: string; icon: string; title: string; fn: () => void }> = [];

  /** The tools that fit the current book: the same ones the ribbon shows, for the bar at the top of the hub. */
  hubTools() {
    return this.toolDefs.filter((t) => !this.ribbon.get(t.key)?.hasClass("booker-hidden"));
  }


  /** The book being worked on: the one the open note belongs to, else the hub's, else the first. */
  currentProject(): Project | undefined {
    const all = findProjects(this.app);
    const path = this.app.workspace.getActiveFile()?.path;
    return (path && all.find((p) => path.startsWith(`${p.file.parent?.path}/`))) || all.find((p) => p.file.path === this.hubProject()) || all[0];
  }

  /** Recompute sequence dates from anchors and gaps: shows what would change, asks, then applies it all or nothing, with undo. */
  async repairSequencesFlow(project?: Project) {
      const proj = project ?? this.currentProject();
      if (!proj) return;
      const r = await sequenceReport(this.app, proj);
      if (!r.edits.length) return void new Notice(r.findings.length ? `${r.findings.length} sequence problem(s), but nothing Booker can recompute. Run "Check sequences".` : "Sequences are in order.");
      const label = `Repair ${r.edits.length} dated note(s)`;
      const show = (w: string, we: string) => (we ? `${w}..${we}` : w || "no date");
      const lines = r.edits.slice(0, 12).map((e) => {
        const b = r.base.get(e.path);
        return `${e.path.split("/").pop()?.replace(/\.md$/, "")}: ${show(b?.when ?? "", b?.whenEnd ?? "")} → ${show(e.when, e.whenEnd)}`;
      });
      const more = r.edits.length > lines.length ? `\n…and ${r.edits.length - lines.length} more` : "";
      new ConfirmModal(this.app, "Repair sequences?", `${lines.join("\n")}${more}\n\nYou can undo this afterwards.`, "Repair", async () => {
        const res = await this.undo.run(label, r.edits.map((e) => e.path), proj.layout.codex, () => repairSequences(this.app, proj));
        if (res.blocked) new Notice(res.blocked);
        else if (res.rolledBack) new Notice(`Repair failed and was rolled back: ${res.rolledBack}`);
        else new Notice(`Repaired ${res.written.length} note(s)${res.stale.length ? `; skipped ${res.stale.length} changed meanwhile` : ""}. Undo is available.`);
      }).open();
  }

  /** Look over every templated sequence. Quiet unless something is wrong (or `say` is set). */
  async checkSequences(say = false, project?: Project) {
    const proj = project ?? this.currentProject();
    if (!proj) return;
    try {
      const { findings } = await sequenceReport(this.app, proj);
      if (findings.length) new Notice(`Booker: ${findings.length} sequence problem(s), e.g. ${findings[0].message} (${findings[0].path.split("/").pop()}). Run "Repair sequences" or "Check sequences".`, 9000);
      else if (say) new Notice("Sequences are in order.");
    } catch (e) {
      if (say) new Notice(`Sequence check failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** Show only the ribbon tools that fit the current book's kind (Settings can show them all). */
  applyTools() {
    const proj = this.currentProject();
    const prof = proj ? profileById(allProfiles(), proj.profile) : null;
    const all = this.settings.showAllTools || !prof;
    const show: Record<string, boolean> = {
      board: !prof || hasView(prof, "board"),
      plotlines: !prof || hasView(prof, "plotlines"),
      timeline: !prof || hasView(prof, "timeline"),
      map: !prof || hasView(prof, "map"),
      family: !prof || hasView(prof, "family"),
      stats: !prof || hasView(prof, "stats"),
      bible: !prof || prof.features.scripture,
      documents: !prof || prof.features.citations || prof.features.scripture || prof.features.notes,
    };
    for (const [key, el] of this.ribbon) el.toggleClass("booker-hidden", !all && show[key] === false);
    // The visible Booker icons are drawn together in one shaded box (styles.css): mark where it starts and ends.
    const shown = [...this.ribbon.values()].filter((el) => !el.hasClass("booker-hidden"));
    for (const el of this.ribbon.values()) el.removeClasses(["booker-ribbon-first", "booker-ribbon-last"]);
    shown[0]?.addClass("booker-ribbon-first");
    shown[shown.length - 1]?.addClass("booker-ribbon-last");
  }

  /** The project the hub is showing, if a hub is open. */
  hubProject(): string | undefined {
    return (this.app.workspace.getLeavesOfType(VIEW_HUB)[0]?.view as any)?.projectPath || undefined;
  }

  /** The hub picked another project: every open project view follows it. */
  async followHub(project: string) {
    for (const type of this.projectViews)
      for (const leaf of this.app.workspace.getLeavesOfType(type)) {
        const st = leaf.getViewState();
        if ((st.state as any)?.project !== project) await leaf.setViewState({ ...st, state: { ...(st.state ?? {}), project } });
      }
  }

  async openView(type: string, state?: Record<string, unknown>) {
    if (type === VIEW_INSPECTOR) return this.openSidebar("inspector");
    const { workspace } = this.app;
    const hub = this.hubProject();
    if (hub && this.projectViews.includes(type) && !state?.project) state = { ...state, project: hub };
    let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(type)[0] ?? null;
    if (!leaf) {
      leaf = leafForView(this);
      await leaf?.setViewState({ type, active: true, state });
    } else if (state) {
      await leaf.setViewState({ type, active: true, state: { ...(leaf.getViewState().state ?? {}), ...state } });
    }
    if (leaf) workspace.revealLeaf(leaf);
  }

  /** Open the hub in the left sidebar, moving it there if a saved workspace left it elsewhere. */
  async openHub() {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(VIEW_HUB)[0] ?? null;
    if (leaf && leaf.getRoot() !== workspace.leftSplit) {
      const state = leaf.getViewState().state;
      leaf.detach();
      leaf = null;
      await this.openSideLeaf(VIEW_HUB, "left", state);
      return;
    }
    if (!leaf) leaf = await this.openSideLeaf(VIEW_HUB, "left");
    if (leaf) workspace.revealLeaf(leaf);
  }

  private async openSideLeaf(type: string, side: "left" | "right", state?: unknown) {
    const { workspace } = this.app;
    const leaf = side === "left" ? workspace.getLeftLeaf(false) : workspace.getRightLeaf(false);
    await leaf?.setViewState({ type, active: true, state: state as Record<string, unknown> });
    if (leaf) workspace.revealLeaf(leaf);
    return leaf;
  }

  /** The Booker panel in the right sidebar (inspector, search, library), on the given tab. */
  async openSidebar(tab?: SidebarTab) {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(VIEW_SIDEBAR)[0] ?? null;
    if (!leaf) leaf = await this.openSideLeaf(VIEW_SIDEBAR, "right", tab ? { tab } : undefined);
    else if (tab) await leaf.setViewState({ type: VIEW_SIDEBAR, active: true, state: { tab } });
    if (leaf) workspace.revealLeaf(leaf);
  }

  openSide() {
    return this.openSidebar("library");
  }

  openExport(_legacy?: TFolder) {
    new ExportModal(this).open();
  }

  // ------------------------------------------------------------- commands

  private registerCommands() {
    const cmd = (id: string, name: string, callback: () => void | Promise<void>) => this.addCommand({ id, name, callback: () => void callback() });

    cmd("new-sequence-template", "New sequence template (a kind of timeline item, like Lives)", async () => {
      const proj = this.currentProject();
      if (!proj) return;
      const all = await readTemplates(this.app, proj);
      new SequenceTemplateModal(this.app, null, all.map((t) => t.id), async (t) => {
        await writeTemplates(this.app, proj, [...all.filter((x) => x.id !== LIFE_TEMPLATE.id), t]);
        new Notice(`Template ${t.label} saved. Use “New item from sequence template” to add one.`);
      }).open();
    });
    cmd("new-from-sequence-template", "New item from sequence template", async () => {
      const proj = this.currentProject();
      if (!proj) return;
      const all = await readTemplates(this.app, proj);
      const { notes, characters } = sequenceChoices(this.app, proj);
      new ChoicePicker(this.app, all.map((t) => ({ label: `${t.label} (gap ${t.defaultGap})`, value: t })), "Which kind of item?", (t) => {
        new SequenceItemModal(this.app, t, {}, notes, characters, async (c) => {
          const f = await createFromTemplate(this.app, proj, t, c.group, c.label, c.inSequence, c);
          await this.app.workspace.getLeaf("tab").openFile(f);
        }).open();
      }).open();
    });
    cmd("check-sequences", "Check sequences (lives and other linked timelines)", () => this.checkSequences(true));
    cmd("repair-sequences", "Repair sequences: recompute dates from anchors and gaps", () => this.repairSequencesFlow());
    cmd("edit-sequence-template", "Sequence template settings (default gap, sequential, anchors)", async () => {
      const proj = this.currentProject();
      if (!proj) return;
      const all = await readTemplates(this.app, proj);
      new ChoicePicker(this.app, all.map((t) => ({ label: `${t.label}: gap ${t.defaultGap}, ${t.sequential ? "sequential" : "not sequential"}`, value: t })), "Which template?", (t) => {
        new SequenceTemplateModal(this.app, t, all.map((x) => x.id), async (next) => {
          await writeTemplates(this.app, proj, [...all.filter((x) => x.id !== t.id && x.id !== LIFE_TEMPLATE.id), next]);
          new Notice(`Template ${next.label} updated. Run “Repair sequences” to apply a new gap.`);
        }).open();
      }).open();
    });
    cmd("toggle-writing-format", "Toggle writing format (indent and spacing)", async () => {
      const path = this.app.workspace.getActiveFile()?.path;
      await this.patchFormatFor(path, { writing: { on: !this.effectiveFormat(path).writing.on } });
    });
    const lines = (editor: Editor, fn: (s: string) => string) => {
      const a = editor.getCursor("from").line;
      const b = editor.getCursor("to").line;
      for (let i = a; i <= b; i++) {
        const s = editor.getLine(i);
        if (s.trim()) editor.setLine(i, fn(s));
      }
    };
    this.addCommand({ id: "indent-paragraph", name: "Indent paragraph (em space)", editorCallback: (e) => lines(e, (s) => EM_SPACE + s) });
    this.addCommand({
      id: "insert-footnote",
      name: "Insert footnote",
      editorCallback: (editor) => {
        const cm = (editor as any).cm as EditorView | undefined;
        if (cm) insertFootnote(cm);
      },
    });
    this.addCommand({
      id: "insert-scripture",
      name: "Insert scripture",
      editorCallback: (editor) => this.insertScripture(editor, editor.getSelection()),
    });
    this.addCommand({
      id: "lookup-scripture-at-cursor",
      name: "Look up the scripture reference at the cursor",
      editorCallback: (editor) => {
        if (!editor.getSelection()) {
          const cur = editor.getCursor();
          const line = editor.getLine(cur.line);
          const hit = referenceAt(line, cur.ch);
          if (!hit) return void new Notice("Booker: no scripture reference found at the cursor. Put the cursor on one, such as John 3:16.");
          editor.setSelection({ line: cur.line, ch: hit.from }, { line: cur.line, ch: hit.to });
        }
        void this.openBible(editor.getSelection());
      },
    });
    for (const k of Object.keys(CALLOUT_LABELS) as CalloutKind[]) this.addCommand({ id: `insert-${k}`, name: `Insert ${CALLOUT_LABELS[k].toLowerCase()}`, editorCallback: (editor) => wrapCallout(editor, k) });
    this.addCommand({
      id: "insert-word-study",
      name: "Insert Hebrew or Greek word study",
      editorCallback: (editor) => new WordStudyModal(this.app, this.modules, (t) => editor.replaceSelection(t), editor.getSelection()).open(),
    });
    cmd("add-source", "Add source (PDF, ePub, Markdown, web page, text)", async () => {
      new AddSourceModal(this.app, async (meta, data, ext) => {
        const s = await addSource(this.app, meta, data, ext);
        new Notice(`Booker: added “${s.title}”. Indexing in the background.`);
        window.setTimeout(() => void this.sourceService.index(s).catch(() => undefined), 1500);
      }).open();
    });
    cmd("import-bibliography", "Import bibliography (BibTeX, RIS, CSL-JSON)", async () => {
      const f = (await pickFiles(["bib", "bibtex", "ris", "json"]))[0];
      if (!f) return;
      const items = parseBibliography(f.name, await f.text());
      if (!items.length) return void new Notice("Booker: no references found in that file.");
      const r = await importBibliography(this.app, items);
      new Notice(`Booker: added ${r.added} source${r.added === 1 ? "" : "s"}${r.skipped ? `, ${r.skipped} already in the library` : ""}.`);
    });
    cmd("search-sources", "Search sources", async () => {
      new SearchSourcesModal(
        this.app,
        this.sources(),
        (list, q, progress) => this.sourceService.search(list, q, 60, progress),
        (r) => void this.openSource(r.source, { chunk: r.chunkNo })
      ).open();
    });
    cmd("move-library", "Move my Bibles and documents into Booker/Library…", () => void runMigration(this));
    cmd("database-fields", "Choose the fields and navigation of a database…", () => {
      const dbs = this.sources().filter((s) => s.kind === "db");
      if (!dbs.length) return void new Notice("Booker: no databases yet. Drop one in the Documents tab.");
      new ListPicker(this.app, dbs, (s) => s.title, "Which database?", (s) => new DbMapModal(this, s, () => undefined).open()).open();
    });
    cmd("open-source", "Open a source in the reader", () => this.pickSource((s) => void this.openSource(s)));
    cmd("check-for-updates", "Check for updates", () => void this.updater.checkAndOffer());
    cmd("resource-manager", "Resource manager: download models, libraries and works", () => new ResourceManager(this).open());
    cmd("index-sources", "Index all sources now", async () => {
      const list = this.sources();
      const task = this.tasks.add("Indexing documents", { state: "running", total: list.length });
      try {
        await this.sourceService.indexAll(list, (m) => this.tasks.update(task, { detail: m }));
        this.tasks.finish(task, "done", `${list.length} indexed`);
      } catch (e) {
        this.tasks.finish(task, "failed", e instanceof Error ? e.message : String(e));
      }
    });
    this.addCommand({
      id: "insert-citation",
      name: "Insert citation ([@key])",
      editorCallback: (editor) => this.citeHere(editor),
    });
    this.addCommand({
      id: "open-quote-source",
      name: "Open the source of the quotation at the cursor",
      editorCallback: (editor) => {
        const text = editor.getValue();
        const cur = editor.posToOffset(editor.getCursor());
        const marks = [...text.matchAll(/%%booker-hl:([^:%\s]+):([^:%\s]+)%%/g)];
        const near = marks.sort((a, b) => Math.abs(a.index! - cur) - Math.abs(b.index! - cur))[0];
        const s = near && this.sources().find((x) => x.uid === near[1]);
        if (!near || !s) return void new Notice("Booker: no quoted source found in this note.");
        void this.openSource(s, { hl: near[2] });
      },
    });
    cmd("open-library", "Open the library browser (libraries, archives, books and documents)", () => void this.openLibrary());
    cmd("open-bible-reader", "Open the Bible and document reader", () => void this.openBible());
    cmd("open-bible-references", "Open the Bible references tab", () => void this.openRefs(this.app.workspace.getLeavesOfType(VIEW_BIBLE)[0], this.scriptureData().refsSide === "left"));
    cmd("manage-indexes", "Manage the indexes for searching by meaning (index all, clear and regenerate)", () => new IndexModal(this).open());
    cmd("semantic-selftest", "Semantic search: test the installed models", async () => {
      await runSelfTest(this);
    });
    this.addCommand({
      id: "summarize-text",
      name: "Pick the key sentences of the selection or this note (extractive summary, by meaning)",
      editorCallback: (ed, view) => {
        const sel = ed.getSelection();
        new SummaryModal(this, sel || withoutSummaries(ed.getValue()), sel ? "selection" : view.file?.basename ?? "note").open();
      },
    });
    cmd("open-bucket", "Open bookmarks", () => this.openView(VIEW_BUCKET));
    cmd("add-bible-module", "Add Bible module (e-Sword, MySword, OSIS, Zefania, USFX)", () => this.addBibleModules());
    this.addCommand({ id: "outdent-paragraph", name: "Outdent paragraph", editorCallback: (e) => lines(e, outdentLine) });

    cmd("open-hub", "Open Booker hub", () => this.openHub());
    cmd("toggle-properties", "Show or hide properties in project notes", () => this.toggleProperties());
    cmd("undo-last-action", "Undo the last Booker action (split, merge, delete, beat sheet, names…)", () => this.undoLast());
    cmd("open-documents", "Open Documents panel", () => this.openSidebar("library"));
    cmd("open-board", "Open board", () => this.openView(VIEW_BOARD));
    cmd("open-plotlines-map", "Open plotlines map", () => this.openView(VIEW_PLOTLINES));
    cmd("open-family-tree", "Open family tree", () => this.openView(VIEW_FAMILY));
    cmd("index-terms", "Index terms (rename, merge, add)", () => {
      const p = this.currentProject();
      if (!p) return void new Notice("Booker: there is no project yet.");
      new IndexTermsModal(this.app, p).open();
    });
    cmd("open-health", "Open project health (broken citations, footnotes, scripture references)", () => this.openView(VIEW_HEALTH));
    cmd("open-checks", "Open story checks (beats, setup and payoff)", () => this.openView(VIEW_CHECKS));
    cmd("open-stats", "Open writing stats", () => this.openView(VIEW_STATS));
    cmd("open-timeline-map", "Open zoomable timeline map", () => this.openView(VIEW_TIMELINE_MAP));
    cmd("open-world-map", "Open the map", () => this.openView(VIEW_WORLD_MAP));
    cmd("open-maps-settings", "Maps settings: add maps, coordinates, grids, display engine", () => {
      const proj = this.currentProject() ?? findProjects(this.app)[0];
      if (proj) new MapsSettingsModal(this, proj).open();
      else new Notice("Booker: open or create a book first.");
    });
    cmd("open-inspector", "Open File info panel", () => this.openSidebar("inspector"));
    cmd("open-dictionary", "Dictionary and thesaurus (look up the selected word)", () => this.lookupWord(this.lastEditor()?.getSelection().trim() ?? ""));
    cmd("search-booker", "Search Booker (your project and library)", () => this.openSidebar("search"));
    cmd("export", "Export book (Word, ePub, PDF)…", () => this.openExport());

    cmd("detect-names", "Add characters and places found in this scene to its properties", async () => {
      const f = this.app.workspace.getActiveFile();
      if (!f) return;
      const proj = findProjects(this.app).find((x) => f.path.startsWith(x.layout.base + "/")) ?? null;
      this.detector.notice(await this.undoable("Add names to scene", proj, [f.path], () => this.detector.detectFile(f)) ? 1 : 0, "scene");
    });
    cmd("detect-names-all", "Add characters and places found in every scene to their properties", async () => {
      const all = findProjects(this.app);
      const touch = all.flatMap((x) => this.sceneFiles(x));
      this.detector.notice(await this.undoable("Add names to every scene", all[0] ?? null, touch, () => this.detector.detectProject(null)), "scene");
    });
  }
}

export { dayKey, MarkdownView };
