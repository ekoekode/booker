import { timelineAnchor } from "../dates";
import { checkContinuity } from "../project/continuity";
import { compareScenes } from "../project/format";
import { ItemView, Menu, Notice, TFile, WorkspaceLeaf, debounce, setIcon } from "obsidian";
import type BookerPlugin from "../main";
import { beatCoverage, BeatSheet } from "../project/beats";
import { checkLinks, pairs } from "../project/setupPayoff";
import { wordsFor } from "../profiles/words";
import { activeSheet, applyBeatSheet, createSceneNamed, findProjects, getLabels, linkScenes, profileFor, Project, readScenes, readScopeScenes, setLink, setSceneFields } from "../project/vaultOps";
import { openNoteIn } from "../openTarget";
import { actionBtn, actionRow, ListPicker, notifyError } from "../ui";
import { BeatSheetModal } from "./beatSheetModal";
import { allProfiles, profileById } from "../profiles/profile";

export const VIEW_CHECKS = "booker-checks";

function el<K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = parent.createEl(tag, { cls });
  if (text !== undefined) e.setText(text);
  return e;
}

/** Story checks: which beats of the chosen structure have a scene, and how setups and payoffs line up. */
export class ChecksView extends ItemView {
  private refresh = debounce(() => void this.render(), 400, true);
  private busy = false;
  private projectPath: string | null = null;
  /** this book, or every book of its series (named `range` because View already has a `scope`) */
  private range: "book" | "series" = "book";

  constructor(leaf: WorkspaceLeaf, private plugin: BookerPlugin) {
    super(leaf);
  }
  getViewType() {
    return VIEW_CHECKS;
  }
  getDisplayText() {
    return "Story checks";
  }
  getIcon() {
    return "list-checks";
  }

  getState() {
    return { project: this.projectPath, scope: this.range };
  }
  async setState(state: any, result: any) {
    if (state?.project) this.projectPath = state.project;
    if (state?.scope === "book" || state?.scope === "series") this.range = state.scope;
    await super.setState(state, result);
    await this.render();
  }

  async onOpen() {
    this.contentEl.addClass("booker-checks");
    const { vault, metadataCache } = this.plugin.app;
    this.registerEvent(metadataCache.on("changed", () => !this.busy && this.refresh()));
    this.registerEvent(vault.on("rename", () => !this.busy && this.refresh()));
    this.registerEvent(vault.on("delete", () => !this.busy && this.refresh()));
    await this.render();
  }

  private openScene(path: string) {
    const f = this.plugin.app.vault.getFileByPath(path);
    if (f) void openNoteIn(this.plugin, f, this.leaf);
  }

  private async run(change: () => Promise<unknown>, what: string) {
    this.busy = true;
    try {
      const proj = this.project();
      const label = what.charAt(0).toUpperCase() + what.slice(1);
      if (proj) await this.plugin.undoable(label, proj, this.plugin.sceneFiles(proj), async () => void (await change()));
      else await change();
    } catch (e) {
      notifyError(e, what);
    } finally {
      this.busy = false;
      await this.render();
    }
  }

  private setRange(r: "book" | "series") {
    this.range = r;
    void this.render();
  }

  private project(): Project | undefined {
    const all = findProjects(this.plugin.app);
    return all.find((p) => p.file.path === this.projectPath) ?? all[0];
  }

  async render() {
    const root = this.contentEl;
    root.empty();
    const all = findProjects(this.plugin.app);
    const proj = all.find((p) => p.file.path === this.projectPath) ?? all[0];
    if (!proj) return void el(root, "p", "booker-muted", "No project yet. Create one from the Booker hub.");
    const app = this.plugin.app;
    const whole = !!proj.series && this.range === "series";
    const scenes = await readScopeScenes(app, proj, whole ? "series" : "book");
    const head = el(root, "div", "booker-board-head");
    el(head, "h3", undefined, `${whole && proj.series ? proj.series.name : proj.name} · Story checks`);
    if (all.length > 1) {
      const sel = el(head, "select", "dropdown");
      for (const p of all) {
        const o = el(sel, "option", undefined, p.name);
        o.value = p.file.path;
        o.selected = p.file.path === proj.file.path;
      }
      sel.onchange = () => {
        this.projectPath = sel.value;
        void this.render();
      };
    }

    if (proj.series) {
      const acts = actionRow(head);
      actionBtn(acts, "This book", "book", () => this.setRange("book"), { cta: !whole, tip: "Check only this book" });
      actionBtn(acts, "Whole series", "library", () => this.setRange("series"), { cta: whole, tip: "Check every book in the series together" });
    }

    const sheet = activeSheet(app, proj);
    if (whole) el(el(root, "section", "booker-checks-sec"), "p", "booker-muted", "Beat sheets belong to one book, so they are hidden here. Continuity below covers every book in the series, in reading order.");
    else this.beatsSection(root, proj, sheet, scenes);
    if (proj.setupPayoff) this.linksSection(root, proj, scenes);
    this.continuitySection(root, proj, scenes);
  }

  // ------------------------------------------------------------- continuity

  private continuitySection(root: HTMLElement, proj: Project, scenes: ReturnType<typeof readScenes>) {
    const sec = el(root, "section", "booker-checks-sec");
    el(sec, "h4", undefined, "Continuity");
    // scenes arrive in reading order (each book sorted, books in series order); a single book is sorted here
    const ordered = this.range === "series" && proj.series ? [...scenes] : [...scenes].sort(compareScenes);
    const anchors = new Map(ordered.map((x) => [x.path, timelineAnchor(x.anchor ?? proj.timelineStart)]));
    const issues = checkContinuity(
      ordered.map((s, i) => ({
        path: s.path,
        title: s.title,
        order: i,
        tags: s.tags ?? [],
        plotSetup: proj.setupPayoff ? s.plotSetup ?? [] : [],
        plotPayoff: proj.setupPayoff ? s.plotPayoff ?? [] : [],
        characters: s.characters ?? [],
        pov: s.pov,
        location: s.location ?? [],
        storyDate: s.storyDate,
        storyTime: s.storyTime,
        timelineMode: s.timelineMode,
      })),
      (c) => anchors.get(c.path)
    );
    if (!ordered.length) return void el(sec, "p", "booker-muted", "Add scenes to check them.");
    el(sec, "p", "booker-muted", issues.length ? `${issues.length} thing${issues.length === 1 ? "" : "s"} to look at. These are prompts, not errors: the book may be doing it on purpose.` : `Nothing found. Checked: ${proj.setupPayoff ? "setups and payoffs on plotlines, " : ""}quiet plotlines, story dates running backwards, and a character in two places at once.`);
    for (const i of issues) {
      const row = el(sec, "div", "booker-checks-issue");
      el(row, "span", undefined, i.message);
      if (i.path) actionBtn(actionRow(row), "Open", "file-text", () => this.openScene(i.path!), { tip: "Open the scene" });
    }
  }

  // ------------------------------------------------------------------ beats

  private chooseSheet(proj: Project) {
    new BeatSheetModal(this.plugin.app, profileById(allProfiles(), proj.profile).beatSheets, activeSheet(this.plugin.app, proj)?.name, async (sheet, make) => {
      await this.run(async () => {
        const n = await applyBeatSheet(this.plugin.app, proj, sheet, make);
        new Notice(n ? `Using ${sheet.name}: ${n} ${wordsFor(profileFor(proj)).itemMany.toLowerCase()} added.` : `Using ${sheet.name}.`);
      }, "use the beat sheet");
    }).open();
  }

  private beatsSection(root: HTMLElement, proj: Project, sheet: BeatSheet | undefined, scenes: ReturnType<typeof readScenes>) {
    const w = wordsFor(profileFor(proj));
    const item = w.item.toLowerCase();
    const sec = el(root, "section", "booker-checks-sec");
    const h = el(sec, "div", "booker-checks-h");
    el(h, "h4", undefined, sheet ? `Beats: ${sheet.name}` : "Beats");
    actionBtn(actionRow(h), sheet ? "Change" : "Choose a beat sheet", "list-ordered", () => this.chooseSheet(proj), { cta: !sheet, tip: "Choose a story structure" });
    if (!sheet) return void el(sec, "p", "booker-muted", `Pick a story structure to see which of its beats your book already has a ${item} for.`);
    const rows = beatCoverage(sheet, scenes.map((s) => ({ path: s.path, title: s.title, beat: s.beat, beatsheet: s.beatsheet })));
    const done = rows.filter((r) => r.scenes.length).length;
    if (done < rows.length)
      actionBtn(actionRow(h), `Add missing ${w.itemMany.toLowerCase()}`, "plus", () => void this.run(async () => {
        const n = await applyBeatSheet(this.plugin.app, proj, sheet, true);
        new Notice(`${n} ${(n === 1 ? w.item : w.itemMany).toLowerCase()} added.`);
      }, "add the beat scenes"), { tip: `Add ${w.hasMid ? `a ${w.mid.toLowerCase()} and ` : ""}a ${item} for each beat that has none` });
    el(sec, "p", "booker-muted", `${done} of ${rows.length} beats have a ${item}.`);
    let lastAct = 0;
    for (const r of rows) {
      if (r.beat.act !== lastAct) {
        lastAct = r.beat.act;
        el(sec, "div", "booker-checks-act", sheet.actLabels[r.beat.act] ?? `Act ${r.beat.act}`);
      }
      const row = el(sec, "div", "booker-checks-row" + (r.scenes.length ? "" : " is-empty"));
      const left = el(row, "div", "booker-checks-main");
      el(left, "strong", undefined, r.beat.label);
      el(left, "div", "booker-muted", r.beat.description);
      const right = el(row, "div", "booker-checks-side");
      for (const s of r.scenes) {
        const chip = el(right, "span", "booker-checks-chip");
        el(chip, "a", undefined, s.title).onclick = () => this.openScene(s.path);
        const x = el(chip, "button", "clickable-icon booker-checks-unlink");
        setIcon(x, "x");
        x.setAttr("aria-label", `Unlink this ${item} from the beat`);
        x.onclick = () => void this.run(() => setSceneFields(this.plugin.app, s.path, { beat: null, beatsheet: null }), `unlink the ${item}`);
      }
      const add = el(right, "button", "clickable-icon booker-checks-add");
      setIcon(add, "plus");
      add.setAttr("aria-label", `Add or link a ${item} for “${r.beat.label}”`);
      add.onclick = (ev) => this.beatMenu(ev, proj, sheet, r.beat, scenes);
    }
  }

  /** The beat's + : a new item for it, or point it at one (or a whole middle-level item) that is already written. */
  private beatMenu(ev: MouseEvent, proj: Project, sheet: BeatSheet, beat: BeatSheet["beats"][number], scenes: ReturnType<typeof readScenes>) {
    const menu = new Menu();
    const w = wordsFor(profileFor(proj));
    const item = w.item.toLowerCase();
    menu.addItem((i) => i.setTitle(`New ${w.hasMid ? w.mid.toLowerCase() : item} for this beat`).setIcon("file-plus").onClick(() => this.makeBeatScene(proj, sheet, beat)));
    menu.addItem((i) =>
      i
        .setTitle(`Link to a ${item}…`)
        .setIcon("link")
        .onClick(() => {
          const list = [...scenes].sort(compareScenes);
          new ListPicker(this.plugin.app, list, (s) => `${s.act}.${s.chapter ?? "-"} ${s.title}`, `Which ${item} shows “${beat.label}”?`, (s) => this.linkBeat(sheet, beat, [s.path], item)).open();
        })
    );
    if (w.hasMid)
    menu.addItem((i) =>
      i
        .setTitle(`Link to a ${w.mid.toLowerCase()}…`)
        .setIcon("book-open")
        .onClick(() => {
          const labels = getLabels(this.plugin.app, proj);
          const byChapter = new Map<string, { label: string; paths: string[] }>();
          for (const s of [...scenes].sort(compareScenes)) {
            const key = `${s.act}/${s.chapter ?? ""}`;
            const name = labels.chapters[String(s.chapter)];
            const e = byChapter.get(key) ?? { label: `${w.mid} ${s.chapter ?? "?"}${name ? `: ${name}` : ""}`, paths: [] };
            e.paths.push(s.path);
            byChapter.set(key, e);
          }
          new ListPicker(this.plugin.app, [...byChapter.values()], (c) => c.label, `Which ${w.mid.toLowerCase()} shows “${beat.label}”?`, (c) => this.linkBeat(sheet, beat, c.paths, item)).open();
        })
    );
    menu.showAtMouseEvent(ev);
  }

  private linkBeat(sheet: BeatSheet, beat: BeatSheet["beats"][number], paths: string[], item: string) {
    void this.run(async () => {
      for (const path of paths) await setSceneFields(this.plugin.app, path, { beatsheet: sheet.name, beat: beat.label });
      new Notice(`Linked ${paths.length} ${item}${paths.length === 1 ? "" : "s"} to “${beat.label}”.`);
    }, "link the beat");
  }

  private makeBeatScene(proj: Project, sheet: BeatSheet, beat: BeatSheet["beats"][number]) {
    void this.run(async () => {
      const app = this.plugin.app;
      const f = await createSceneNamed(app, proj, { title: beat.label, act: beat.act, chapter: 0, newChapter: true, chapterName: beat.label }, readScenes(app, proj));
      await setSceneFields(app, f.path, { beatsheet: sheet.name, beat: beat.label, synopsis: beat.description });
      await openNoteIn(this.plugin, f as TFile, this.leaf);
    }, `add the ${wordsFor(profileFor(proj)).item.toLowerCase()}`);
  }

  // ------------------------------------------------------------ setup/payoff

  private linksSection(root: HTMLElement, _proj: Project, scenes: ReturnType<typeof readScenes>) {
    const sec = el(root, "section", "booker-checks-sec");
    el(sec, "h4", undefined, "Setup and payoff");
    const ls = linkScenes(scenes);
    const found = pairs(ls);
    if (!found.length) return void el(sec, "p", "booker-muted", "Nothing linked yet. Open a scene in the inspector and list the scenes it sets up or pays off.");
    const byTitle = new Map(ls.map((s) => [s.title, s]));
    const issues = checkLinks(ls);
    el(sec, "p", "booker-muted", `${found.length} link${found.length === 1 ? "" : "s"}, ${issues.length ? `${issues.length} to look at` : "all consistent"}.`);
    for (const { setup, payoff } of found) {
      const row = el(sec, "div", "booker-checks-link");
      const link = (title: string) => {
        const s = byTitle.get(title);
        const a = el(row, "a", s ? undefined : "booker-warn", title);
        if (s) a.onclick = () => this.openScene(s.path);
        return a;
      };
      link(setup);
      el(row, "span", "booker-muted", " → ");
      link(payoff);
    }
    if (!issues.length) return;
    el(sec, "h5", undefined, "To look at");
    for (const i of issues) {
      const row = el(sec, "div", "booker-checks-issue");
      el(row, "span", undefined, i.message);
      const btns = actionRow(row);
      const a = byTitle.get(i.setup);
      const c = byTitle.get(i.payoff);
      if (i.kind === "one-way" && a && c) actionBtn(btns, "Fix", "link", () => void this.run(() => setLink(this.plugin.app, a.path, c.path, true), "fix the link"), { cta: true, tip: "Record the link on both scenes" });
      if (i.kind === "missing" || i.kind === "self") {
        const owner = a ?? c;
        if (owner) actionBtn(btns, "Remove link", "unlink", () => void this.run(() => setLink(this.plugin.app, a?.path ?? owner.path, c?.path ?? owner.path, false), "remove the link"), { tip: "Take this link off the scene" });
      }
      if (i.path) actionBtn(btns, "Open", "file-text", () => this.openScene(i.path!), { tip: "Open the scene" });
    }
  }
}
