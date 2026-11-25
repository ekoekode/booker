import { formatTime, parseStoryDate, timelineAnchor } from "../dates";
import { Notice, TFile, WorkspaceLeaf, debounce } from "obsidian";
import type BookerPlugin from "../main";
import { statusesFor } from "../profiles/profile";
import { actTitle, chapterTitle } from "../project/format";
import { wordsFor } from "../profiles/words";
import { classify, codexFields, SCENE_FIELDS, SEQ_FIELDS } from "../project/inspectorModel";
import { TIMELINE_MODES } from "../project/timeline";
import { duplicateOf } from "../codex/aliases";
import { aliasEntries, aliasSuggestOn, worldKinds, codexFiles, getLabels, profileFor, createFromTemplate, findProjects, readTemplates, sequenceChoices, activeSheet, archiveScene, setLink, setSceneFields, listSnapshots, Life, Project, readLives, readScenes, restoreSnapshot, takeSnapshot } from "../project/vaultOps";
import { SnapshotDiff } from "./snapshotDiff";
import { SequenceItemModal } from "./sequenceModal";
import { LIFE_TEMPLATE } from "../project/sequence";
import { ConfirmModal } from "../ui";
import { FieldCtx, writeFm, box, chipsField, factCell, inputField, line, section, selectField, textareaField, validateAlias } from "./inspectorFields";
import { openNoteIn } from "../openTarget";
import { locationBox } from "./locationBox";
import { actionBtn, actionRow, NamePrompt, notifyError } from "../ui";

export const VIEW_INSPECTOR = "booker-inspector";

function el<K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = parent.createEl(tag, { cls });
  if (text !== undefined) e.setText(text);
  return e;
}

/** Details of the open note in the note's own fields: a scene's status, people, place, plotlines and story time, or a codex entry's profile. */
export class InspectorPanel {
  refresh = debounce(() => this.refreshNow(), 350, true);
  private token = 0;
  private renderedPath = "";
  private pending = false;

  /** Redraw, unless the user is typing in one of our fields on the same note. */
  private refreshNow() {
    const active = this.plugin.app.workspace.getActiveFile();
    const a = typeof document !== "undefined" ? document.activeElement : null;
    const typing = !!a && this.root.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName);
    if (typing && active?.path === this.renderedPath) {
      this.pending = true;
      return;
    }
    this.pending = false;
    void this.render();
  }

  /** `root` is the element it draws in; `leafOf` is the leaf that notes it opens replace. */
  constructor(private plugin: BookerPlugin, private root: HTMLElement, private leafOf: () => WorkspaceLeaf, private badge?: (text: string | null, kind?: string, action?: { icon: string; label: string; run: () => void }) => void) {
    root.addClass("booker-inspector");
    root.addEventListener("focusout", () => {
      if (this.pending) this.refresh();
    });
  }

  /** Redraw because the open note, or its fields, changed. */
  changed(path?: string) {
    if (path === undefined || path === this.renderedPath) this.refresh();
  }

  private openNote(path: string) {
    const f = this.plugin.app.vault.getFileByPath(path);
    if (f) void openNoteIn(this.plugin, f, this.leafOf());
  }

  private row(parent: HTMLElement, label: string) {
    const r = el(parent, "div", "booker-ins-row");
    el(r, "span", "booker-ins-label", label);
    return el(r, "span", "booker-ins-value");
  }

  async render() {
    const my = ++this.token;
    const root = this.root;
    try {
      const file = this.plugin.app.workspace.getActiveFile();
      this.renderedPath = file?.path ?? "";
      if (my !== this.token) return;
      root.empty();
      this.badge?.(null);
      if (!file) return void el(root, "p", "booker-muted", "Open a note to see its details.");
      const projects = findProjects(this.plugin.app);
      const fm = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
      // a note of a series' shared Codex sits outside every book's folder, so it is found by the book whose layout holds it
      const inside = projects.filter((p) => file.path.startsWith(p.layout.base + "/"));
      const proj = [...inside, ...projects].find((p) => classify(file.path, fm, p.layout).kind !== "none") ?? inside[0];
      const kind = proj ? classify(file.path, fm, proj.layout) : ({ kind: "none" } as const);
      if (!proj || kind.kind === "none") {
        el(root, "h4", undefined, file.basename);
        el(root, "p", "booker-muted", "This note is not a scene or a codex entry in a project.");
        return;
      }
      if (kind.kind === "scene") this.sceneView(root, file, proj, fm);
      else this.codexView(root, file, proj, fm, kind.type, kind.group);
    } catch (e) {
      console.error("Booker inspector", e);
      root.empty();
      const box = el(root, "div", "booker-error");
      el(box, "p", undefined, `Booker could not draw this tab: ${e instanceof Error ? e.message : String(e)}`);
      actionBtn(actionRow(box), "Retry", "refresh-cw", () => void this.render(), { cta: true });
    }
  }

  private ctx(file: TFile, proj: Project, fm: Record<string, any>): FieldCtx {
    const names = (kind: "characters" | "locations") => codexFiles(this.plugin.app, proj, kind).map((f) => f.basename);
    return { app: this.plugin.app, file, fm, characters: names("characters"), locations: names("locations"), plotlines: [], lives: [] };
  }

  // ---------------------------------------------------------------- scene

  private sceneView(r: HTMLElement, file: TFile, proj: Project, fm: Record<string, any>) {
    const scenes = readScenes(this.plugin.app, proj);
    const me = scenes.find((s) => s.path === file.path);
    const ctx = this.ctx(file, proj, fm);
    const w = wordsFor(profileFor(proj));
    this.badge?.(w.item.toLowerCase(), "scene", this.archiveAction(file, proj, fm));
    el(r, "h4", "booker-ins-title", String(fm.title ?? file.basename));
    const where = me ? [w.hasTop ? actTitle(me.act, getLabels(this.plugin.app, proj), w.top) : "", w.hasMid ? chapterTitle(me.chapter, getLabels(this.plugin.app, proj), w.mid) : ""].filter(Boolean) : [];
    if (where.length) el(r, "div", "booker-ins-where", where.join(" · "));
    const target = typeof fm.target_wordcount === "number" ? fm.target_wordcount : 0;
    const words = me?.words ?? 0;

    const basics = box(r, w.item);
    inputField(basics, ctx, "Title", "title");
    const top = line(basics);
    factCell(top, "Words", target ? `${words.toLocaleString()} / ${target.toLocaleString()}` : words.toLocaleString());
    selectField(top, ctx, "Status", "status", statusesFor(proj.profile), statusesFor(proj.profile)[0]);
    inputField(top, ctx, "Target words", "target_wordcount", { kind: "number", placeholder: "none" });

    const people = box(r, "People and place");
    const pp = line(people);
    inputField(pp, ctx, "POV", "pov", { kind: "link", suggestions: ctx.characters, placeholder: "none" });
    inputField(pp, ctx, "Place", "location", { kind: "link", suggestions: ctx.locations, placeholder: "none" });
    chipsField(people, ctx, "Characters", "characters", { asLink: true, suggestions: ctx.characters, placeholder: "Add a character…" });
        // lives of the people in this scene, so a scene can say which life of a character it belongs to
    const present = new Set([...(me?.pov ? [me.pov] : []), ...(me?.characters ?? [])]);
    const lifeNames = readLives(this.plugin.app, proj).filter((l) => present.has(l.character)).map((l) => l.name);
    if (lifeNames.length || (me?.lives ?? []).length) chipsField(people, ctx, "Lives", "lives", { asLink: true, suggestions: lifeNames, placeholder: "Which life?" });
    if (this.plugin.detector.autoOn(file)) actionBtn(actionRow(people, "booker-cells-actions"), "Find names", "scan-search", async () => this.plugin.detector.notice((await this.plugin.detector.detectFile(file)) ? 1 : 0, "scene"), { tip: "Find character and place names in this scene" });

    locationBox(r, this.plugin, file, fm, proj);

    const plot = box(r, "Plot");
    const allTags = [...new Set(scenes.flatMap((s) => s.tags ?? []))];
    chipsField(plot, ctx, "Plotlines", "tags", { asLink: false, suggestions: allTags, placeholder: "Add a plotline…" });
    textareaField(plot, ctx, "Synopsis", "synopsis", 3);
    textareaField(plot, ctx, "AI synopsis", "summary_ai", 4);
    actionBtn(actionRow(plot, "booker-cells-actions"), "Generate AI summary", "sparkles", () => void this.plugin.autoSummary.now(file), { tip: "Write the AI synopsis from the text of this scene" });

    if (proj.setupPayoff) this.setupPayoff(r, file, ctx, scenes, String(fm.title ?? file.basename));
    const sheet = activeSheet(this.plugin.app, proj);
    if (sheet) {
      const beatBox = section(r, "scene-beat", `Beat: ${sheet.name}`, false);
      const labels = ["none", ...sheet.beats.map((b) => b.label)];
      const cur = labels.find((l) => l.toLowerCase() === String(fm.beat ?? "").toLowerCase()) ?? "none";
      ctx.fm = { ...fm, beat: cur };
      const sel = selectField(box(beatBox), ctx, "Beat", "beat", labels, "none");
      sel.onchange = async () => {
        const v = sel.value === "none" ? null : sel.value;
        await setSceneFields(this.plugin.app, file.path, { beat: v, beatsheet: v ? sheet.name : null });
      };
    }

    const timeSec = section(r, "scene-time", "Chronology", false);
    const time = box(timeSec);
    const anchor = timelineAnchor(proj.timelineStart);
    inputField(time, ctx, "Date", "storyDate", {
      placeholder: "e.g. 2031-04-02 or Day 3",
      note: (v) => {
        if (!v.trim()) return null;
        const d = parseStoryDate(v.trim(), anchor);
        if (d) return { text: d.display + (/^(day|week|month|year)\b/i.test(v.trim()) && anchor !== undefined ? ` = ${formatTime(d.start, 1 / 366)}` : ""), bad: false };
        const relative = /^(day|week|month|year)\s*\d+$/i.test(v.trim());
        return relative && anchor === undefined ? { text: "set the book's timeline start first (hub, All tools)", bad: true } : { text: "not understood", bad: true };
      },
    });
    const tl = line(time);
    inputField(tl, ctx, "Time", "storyTime", { placeholder: "e.g. 14:30 or dawn" });
    selectField(tl, ctx, "Time jump", "timeline_mode", TIMELINE_MODES, "linear");

    const craftSec = section(r, "scene-craft", "Craft", false);
    const craft = box(craftSec);
    const cl = line(craft);
    for (const f of SCENE_FIELDS.slice(0, 2)) inputField(cl, ctx, f.label, f.key, { placeholder: f.placeholder });
    const cl2 = line(craft);
    inputField(cl2, ctx, SCENE_FIELDS[2].label, SCENE_FIELDS[2].key, { placeholder: SCENE_FIELDS[2].placeholder });
    inputField(cl2, ctx, "Intensity (1-10)", "intensity", { kind: "number" });

    this.otherProperties(r, ctx, fm, me, proj);

    this.notesAndSnapshots(r, file, proj, String(fm.title ?? file.basename));
  }

  private archiveAction(file: TFile, proj: Project, fm: Record<string, any>) {
    const item = wordsFor(profileFor(proj)).item.toLowerCase();
    return {
      icon: "archive",
      label: `Archive this ${item}`,
      run: () =>
        new ConfirmModal(this.plugin.app, `Archive this ${item}?`, `“${String(fm.title ?? file.basename)}” leaves the book but is kept in the Archive folder. Restore it from the board's Archive button.`, "Archive", async () => {
          try {
            await this.plugin.undoable(`Archive ${item}`, proj, this.plugin.sceneFiles(proj), () => archiveScene(this.plugin.app, proj, readScenes(this.plugin.app, proj), file.path));
            new Notice(`${wordsFor(profileFor(proj)).item} archived.`);
          } catch (e) {
            notifyError(e, `archive the ${item}`);
          }
        }).open(),
    };
  }

  /** Every other property of the note, so nothing in the properties block is out of reach: the fixed ones are shown, the rest can be edited. */
  private otherProperties(r: HTMLElement, ctx: FieldCtx, fm: Record<string, any>, me: ReturnType<typeof readScenes>[number] | undefined, proj: Project) {
    const handled = new Set(["type", "title", "status", "synopsis", "summary_ai", "summary_ai_short", "summary_ai_words", "target_wordcount", "pov", "characters", "location", "lives", "tags", "storyDate", "storyDateEnd", "storyTime", "timeline_mode", "conflict", "emotion", "color", "intensity", "beat", "beatsheet", "setup_scenes", "payoff_scenes", "plotline_setup", "plotline_payoff", "act", "chapter", "sequence", "wordcount", "charcount", "created", "modified", "chronologicalOrder", "setup", "payoff", "address", "geoLat", "geoLng", "geoPlace", "mapPos"]);
    const body = section(r, "scene-props", "All properties", false, true);
    const w = wordsFor(profileFor(proj));
    const fixed: Array<[string, unknown]> = [...(w.hasTop ? [[w.top, fm.act] as [string, unknown]] : []), ...(w.hasMid ? [[w.mid, fm.chapter] as [string, unknown]] : []), [w.hasTop ? `Order in ${w.top.toLowerCase()}` : "Order", fm.sequence], ["Words", me?.words ?? fm.wordcount], ["Created", fm.created], ["Modified", fm.modified]];
    for (const [k, v] of fixed) {
      const row = el(body, "div", "booker-ins-row");
      el(row, "span", "booker-muted", k);
      el(row, "span", undefined, v === undefined || v === null ? "" : String(v));
    }
    el(body, "p", "booker-muted", `${[w.hasTop ? w.top : "", w.hasMid ? w.mid : "", "order"].filter(Boolean).join(", ")} change when you move the ${w.item.toLowerCase()} on the board or in the hub.`);
    const extra = Object.keys(fm).filter((k) => !handled.has(k) && k !== "position");
    const props = extra.length ? box(body) : body;
    for (const k of extra) {
      const v = fm[k];
      if (Array.isArray(v)) chipsField(props, ctx, k, k, { asLink: false });
      else if (v === null || typeof v !== "object") inputField(props, ctx, k, k);
    }
    // a new property of your own
    const add = el(body, "div", "booker-ins-addprop");
    const name = el(add, "input", "booker-input");
    name.type = "text";
    name.placeholder = "New property name";
    const val = el(add, "input", "booker-input");
    val.type = "text";
    val.placeholder = "Value";
    actionBtn(actionRow(add), "Add", "plus", () => {
      const key = name.value.trim().replace(/[:\n]/g, "");
      if (!key || handled.has(key)) return void new Notice("Booker: give the property a name that is not already used above.");
      void writeFm(ctx, (f) => {
        f[key] = val.value.trim();
      }).then(() => this.render());
    }, { tip: "Add this property to the note" });
  }

  /** Which scenes this one sets up, and which set it up. Each link is written on both scenes. */
  private setupPayoff(r: HTMLElement, file: TFile, ctx: FieldCtx, scenes: ReturnType<typeof readScenes>, title: string) {
    const app = this.plugin.app;
    const others = scenes.filter((s) => s.path !== file.path);
    const names = others.map((s) => s.title);
    const body = section(r, "scene-setup", "Setup and payoff", false);
    const sync = (mine: "setup" | "payoff") => async (name: string, added: boolean) => {
      const other = others.find((s) => s.title === name);
      if (!other) return;
      try {
        await (mine === "payoff" ? setLink(app, file.path, other.path, added) : setLink(app, other.path, file.path, added));
      } catch (e) {
        notifyError(e, "save the link");
      }
    };
    const links = box(body);
    chipsField(links, ctx, "Sets up (payoffs later)", "payoff_scenes", { asLink: false, suggestions: names, placeholder: "A scene that pays this off…", after: sync("payoff") });
    chipsField(links, ctx, "Pays off (setups earlier)", "setup_scenes", { asLink: false, suggestions: names, placeholder: "A scene that sets this up…", after: sync("setup") });
  }

  /** Saved versions of the scene to compare with or go back to. */
  private notesAndSnapshots(r: HTMLElement, file: TFile, proj: Project, title: string) {
    const app = this.plugin.app;
    const snaps = listSnapshots(app, proj, title);
    const sb = section(r, "scene-snaps", `Snapshots (${snaps.length})`, false, true);
    const intro = el(sb, "div", "booker-snap-intro");
    el(intro, "div", "booker-snap-lead", "Saved copies of this scene");
    el(intro, "div", "booker-muted", "Take a snapshot before a big rewrite. Later you can compare it with the scene as it is now, or go back to it.");
    const take = () =>
      new NamePrompt(
        app,
        "Take snapshot",
        "A label helps you find it later, such as “before rewrite”. Leave it empty for none.",
        async (label) => {
          try {
            await takeSnapshot(app, proj, file, title, label);
            new Notice("Snapshot saved.");
          } catch (e) {
            notifyError(e, "take the snapshot");
          }
          this.refresh();
        },
        "",
        true
      ).open();
    actionBtn(actionRow(sb), "+Snapshot", "camera", take, { cta: true, tip: "Save the scene as it is now" });
    const list = el(sb, "div", "booker-snap-list");
    if (!snaps.length) el(list, "div", "booker-snap-card is-empty", "No snapshots yet.");
    snaps.forEach((sn, i) => {
      const card = el(list, "div", "booker-snap-card");
      const head = el(card, "div", "booker-snap-head");
      el(head, "strong", "booker-snap-name", sn.label || "Unlabelled snapshot");
      if (i === 0) el(head, "span", "booker-pill", "Latest");
      el(card, "div", "booker-muted booker-snap-when", `${sn.when.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" })} at ${sn.when.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`);
      const btns = actionRow(card, "booker-snap-actions");
      actionBtn(btns, "Compare with now", "git-compare", async () => new SnapshotDiff(app, `${title}: since ${sn.when.toLocaleString()}`, await app.vault.read(sn.file), await app.vault.read(file)).open(), { tip: "See what changed since this snapshot" });
      actionBtn(btns, "Restore this version", "undo-2", () =>
        new ConfirmModal(app, "Restore this version?", "The scene goes back to this version. Its current text is saved as a snapshot first, so you can undo this.", "Restore", async () => {
          try {
            await restoreSnapshot(app, proj, file, title, sn.file);
            new Notice("Scene restored. The earlier text is kept as a snapshot.");
          } catch (e) {
            notifyError(e, "restore the snapshot");
          }
          this.refresh();
        }).open(), { tip: "Go back to this version. The current text is kept as a snapshot first" }
      );
      actionBtn(btns, "Delete", "trash-2", () =>
        new ConfirmModal(app, "Delete this snapshot?", "It is moved to the trash.", "Delete", async () => {
          await app.fileManager.trashFile(sn.file);
          this.refresh();
        }).open()
      );
    });
  }

  // ---------------------------------------------------------------- codex

  private codexView(r: HTMLElement, file: TFile, proj: Project, fm: Record<string, any>, type: string, group: "character" | "location" | "life" | "other") {
    this.badge?.(type, group === "other" ? "codex" : group);
    el(r, "h4", "booker-ins-title", String(fm.name ?? file.basename));
    const ctx = this.ctx(file, proj, fm);

    const fields = codexFields(group);
    const field = (k: string) => fields.find((f) => f.key === k);
    // short fields go two to a row, long ones get a row of their own
    const place = (into: HTMLElement, list: typeof fields) => {
      let pair: HTMLElement | null = null;
      for (const f of list) {
        if (f.long) {
          pair = null;
          textareaField(into, ctx, f.label, f.key, 3);
          continue;
        }
        if (!pair || pair.childElementCount >= 2) pair = line(into);
        inputField(pair, ctx, f.label, f.key, { placeholder: f.placeholder ?? "none" });
      }
    };
    const profile = box(r, group === "character" ? "Who they are" : "Profile");
    const kind = worldKinds(this.plugin.app, proj).find((k) => file.path.startsWith(`${k.folder}/`) && aliasSuggestOn(proj, k.id));
    const others = kind ? aliasEntries(this.plugin.app, proj) : [];
    const me = { path: file.path, name: String(fm.name ?? file.basename), kind: kind?.id ?? "" };
    chipsField(profile, ctx, "Aliases", "aliases", {
      asLink: false,
      validate: validateAlias,
      hint: kind ? (a) => { const d = duplicateOf(others, me, a); return d ? `Is this a duplicate of ${d.name}?` : null; } : undefined,
      placeholder: "Add another name…",
    });
    if (group === "life") inputField(profile, ctx, "Character", "character", { kind: "link", suggestions: ctx.characters });
    if (group === "character") {
      const named = (keys: string[]) => keys.map(field).filter((f): f is NonNullable<ReturnType<typeof field>> => !!f);
      place(profile, named(["role", "occupation", "residency"]));
      place(box(r, "Story"), named(["goal", "belief", "misbelief", "fears", "flaws", "strengths"]));
      place(box(r, "Looks and manner"), named(["appearance", "personality"]));
      const kin = box(r, "Family");
      const fam = field("family");
      if (fam) place(kin, [fam]);
      chipsField(kin, ctx, "Parents", "parents", { asLink: true, suggestions: ctx.characters, placeholder: "Add a parent…" });
      chipsField(kin, ctx, "Partners", "partners", { asLink: true, suggestions: ctx.characters, placeholder: "Add a partner…" });
      this.livesSection(r, file, proj);
    } else place(profile, fields);
    if (fm.template && group !== "life") place(box(r, "Time link"), SEQ_FIELDS);
    locationBox(r, this.plugin, file, fm, proj);

    this.appearances(r, file, proj, fm, group);
  }

  /** A character's lives, with a button to add one. */
  private livesSection(r: HTMLElement, file: TFile, proj: Project) {
    const mine = readLives(this.plugin.app, proj).filter((l) => l.character === file.basename);
    const body = section(r, "char-lives", `Lives (${mine.length})`, true, true);
    if (!mine.length) el(body, "p", "booker-muted", "A character can have several lives, for example one who is reborn. Each life has its own dates and scenes, and shows on the timeline map. Lives in a sequence start three days after the last one ends; a free life is greyed out on the map until you give it a number.");
    const list = el(body, "div", "booker-ins-list booker-lives");
    for (const l of mine) {
      const row = el(list, "div", "booker-life-row" + (l.number > 0 ? "" : " is-free"));
      const a = el(row, "a", undefined, `${l.number > 0 ? `${l.number}. ` : ""}${l.lifeName ?? l.name}`);
      a.onclick = () => this.openNote(l.file.path);
      el(row, "span", "booker-muted", l.dates || (l.number > 0 ? "no dates yet" : "free, no dates"));
    }
    const row = actionRow(body);
    actionBtn(row, "+Life", "repeat", () => this.addLife(file, proj, true), { cta: true, tip: "Add the next life in the sequence" });
    actionBtn(row, "+Free life", "circle-dashed", () => this.addLife(file, proj, false), { tip: "Add a life that is not in the sequence" });
  }

  private addLife(file: TFile, proj: Project, inSequence: boolean) {
    const app = this.plugin.app;
    void readTemplates(app, proj).then((all) => {
      const tpl = all.find((t) => t.id === "life") ?? LIFE_TEMPLATE;
      const { notes } = sequenceChoices(app, proj);
      new SequenceItemModal(app, tpl, { group: file.basename, groupFixed: true, inSequence }, notes, [], async (c) => {
        const f = await createFromTemplate(app, proj, tpl, file.basename, c.label, c.inSequence, c);
        await app.workspace.getLeaf("tab").openFile(f);
      }).open();
    });
  }

  /** Scenes that name this entry, so you can jump to where it appears. */
  private appearances(r: HTMLElement, file: TFile, proj: Project, fm: Record<string, any>, group: "character" | "location" | "life" | "other") {
    if (group === "other") return;
    const names = new Set([file.basename, ...(Array.isArray(fm.aliases) ? fm.aliases.map(String) : [])]);
    const hits = readScenes(this.plugin.app, proj).filter((s) =>
      group === "life" ? (s.lives ?? []).includes(file.basename) : group === "character" ? s.pov && names.has(s.pov) || (s.characters ?? []).some((c) => names.has(c)) : (s.location ?? []).some((c) => names.has(c))
    );
    el(r, "h5", undefined, `Appears in ${hits.length} scene${hits.length === 1 ? "" : "s"}`);
    const list = el(r, "div", "booker-ins-list");
    for (const s of hits) {
      const a = el(list, "a", undefined, s.title);
      a.onclick = () => this.openNote(s.path);
    }
  }
}
