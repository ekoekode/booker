import { ConfirmModal, notifyError, NamePrompt } from "../ui";
import { ItemView, Menu, WorkspaceLeaf, debounce, setIcon } from "obsidian";
import type BookerPlugin from "../main";
import { openNoteIn } from "../openTarget";
import { actTitle, compareScenes, chapterTitle, Labels, Model, planMove, planMoveChapter, positionInAct, setLabel } from "../project/format";
import { HubScene } from "../project/hubModel";
import {
  applyChapterPlan,
  applyMoves,
  archiveScene,
  listArchived,
  restoreScene,
  createSceneNamed,
  findProjects,
  getLabels,
  profileFor,
  getModel,
  Project,
  syncActFolders,
  readScenes,
  removeEmpty,
  swapActs,
  syncStructure,
  toRefs,
  updateLabels,
} from "../project/vaultOps";
import { ArchiveModal } from "./archiveModal";
import { NewItemModal, type NewKind } from "./newItemModal";
import { wordsFor, type Words } from "../profiles/words";

export const VIEW_BOARD = "booker-board";

function el<K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = parent.createEl(tag, { cls });
  if (text !== undefined) e.setText(text);
  return e;
}

const SCENE = "application/x-booker-scene";
const CHAPTER = "application/x-booker-chapter";

interface Ctx {
  proj: Project;
  scenes: HubScene[];
  labels: Labels;
  model: Model;
  w: Words;
}

/** The board: one column per chapter, grouped by act. Drag cards to move scenes, drag a chapter's title to move the chapter. */
export class BoardView extends ItemView {
  private projectPath: string | null = null;
  private busy = false;
  private refresh = debounce(() => void this.render(), 250, true);

  constructor(leaf: WorkspaceLeaf, private plugin: BookerPlugin) {
    super(leaf);
  }

  getViewType() {
    return VIEW_BOARD;
  }
  getDisplayText() {
    return "Board";
  }
  getIcon() {
    return "layout-grid";
  }
  getState() {
    return { project: this.projectPath };
  }
  async setState(state: any, result: any) {
    if (state?.project) this.projectPath = state.project;
    await super.setState(state, result);
    await this.render();
  }

  async onOpen() {
    this.contentEl.addClass("booker-board");
    const { vault, metadataCache } = this.plugin.app;
    this.registerEvent(metadataCache.on("changed", () => !this.busy && this.refresh()));
    this.registerEvent(vault.on("create", () => !this.busy && this.refresh()));
    this.registerEvent(vault.on("delete", () => !this.busy && this.refresh()));
    this.registerEvent(vault.on("rename", () => !this.busy && this.refresh()));
    await this.render();
  }

  private project(): Project | null {
    const all = findProjects(this.plugin.app);
    return all.find((p) => p.file.path === this.projectPath) ?? all[0] ?? null;
  }

  async render() {
    const root = this.contentEl;
    root.empty();
    const proj = this.project();
    if (!proj) return void el(root, "p", "booker-muted", "No project yet. Create one from the Booker hub.");
    const app = this.plugin.app;
    const scenes = readScenes(app, proj).sort(compareScenes); // vault order is by file name, not reading order
    // remember every act and chapter, including empty ones, so they are never lost
    if (!this.busy) await syncStructure(app, proj, scenes).catch(() => undefined);
    const ctx: Ctx = { proj, scenes, labels: getLabels(app, proj), model: getModel(app, proj, scenes), w: wordsFor(profileFor(proj)) };
    if (!this.busy) await syncActFolders(app, proj, ctx.model.acts).catch(() => undefined);

    const head = el(root, "div", "booker-board-head");
    el(head, "h3", undefined, `${proj.name} · Board`);
    const actions = el(head, "div", "booker-board-actions");
    const w = ctx.w;
    this.headBtn(actions, w.item, "file-plus", true, () => this.newItem(ctx, "scene"));
    if (w.hasMid) this.headBtn(actions, w.mid, "layers", false, () => this.newItem(ctx, "chapter"));
    if (w.hasTop) this.headBtn(actions, w.top, "library", false, () => this.newItem(ctx, "act"));
    const archived = listArchived(app, proj).length;
    const ab = el(actions, "button", "booker-btn");
    setIcon(el(ab, "span", "booker-hub-ico booker-btn-icon"), "archive");
    el(ab, "span", "booker-btn-label", archived ? `Archive (${archived})` : "Archive");
    ab.setAttr("aria-label", `Archived ${w.itemMany.toLowerCase()}`);
    ab.addEventListener("click", () => this.openArchive(ctx));

    if (ctx.model.acts.length === 0) return void el(root, "p", "booker-muted", `Nothing here yet. Add ${[w.item, w.hasMid ? w.mid : "", w.hasTop ? w.top : ""].filter(Boolean).map((x) => `a ${x.toLowerCase()}`).join(", ").replace(/, ([^,]*)$/, " or $1")} to start the board.`);

    const acts = el(root, "div", "booker-board-acts");
    ctx.model.acts.forEach((act, ai) => this.actSection(acts, ctx, act, ai));
  }

  private headBtn(parent: HTMLElement, label: string, icon: string, cta: boolean, run: () => void) {
    const b = el(parent, "button", "booker-btn" + (cta ? " mod-cta" : ""));
    setIcon(el(b, "span", "booker-hub-ico booker-btn-icon"), icon);
    el(b, "span", "booker-btn-label", "+" + label);
    b.setAttr("aria-label", "New " + label.toLowerCase());
    b.addEventListener("click", run);
  }

  private iconBtn(parent: HTMLElement, icon: string, label: string, run: () => void) {
    const b = el(parent, "button", "clickable-icon booker-board-icon");
    setIcon(b, icon);
    b.setAttr("aria-label", label);
    b.addEventListener("click", (ev) => {
      ev.stopPropagation();
      run();
    });
  }

  // -------------------------------------------------------------- structure

  private actSection(parent: HTMLElement, ctx: Ctx, act: number, ai: number) {
    const chapters = ctx.model.chapters.filter((c) => c.act === act);
    const actScenes = ctx.scenes.filter((s) => String(s.act) === String(act));
    const words = actScenes.reduce((n, s) => n + s.words, 0);

    const w = ctx.w;
    const topLow = w.top.toLowerCase();
    const midLow = w.mid.toLowerCase();
    const sec = el(parent, "section", "booker-board-act");
    // a book with no top level is one list with no heading
    const h = w.hasTop ? el(sec, "div", "booker-board-act-head") : createDiv();
    el(h, "strong", undefined, actTitle(act, ctx.labels, w.top));
    el(h, "span", "booker-muted", `${words.toLocaleString()} words`);
    const tools = el(h, "span", "booker-board-tools");
    this.iconBtn(tools, "pencil", `Name this ${topLow}`, () => this.rename(ctx, "act", act));
    if (ai > 0) this.iconBtn(tools, "chevron-up", `Move ${topLow} up`, () => void this.run(() => swapActs(this.plugin.app, ctx.proj, ctx.scenes, act, ctx.model.acts[ai - 1]), "reorder"));
    if (ai < ctx.model.acts.length - 1) this.iconBtn(tools, "chevron-down", `Move ${topLow} down`, () => void this.run(() => swapActs(this.plugin.app, ctx.proj, ctx.scenes, act, ctx.model.acts[ai + 1]), "reorder"));
    if (actScenes.length === 0 && chapters.length === 0) this.iconBtn(tools, "trash-2", `Remove this empty ${topLow}`, () => void this.run(() => removeEmpty(this.plugin.app, ctx.proj, ctx.scenes, "act", act), `remove the ${topLow}`));

    const cols = el(sec, "div", "booker-board-cols");
    const nums = chapters.map((c) => c.num);
    chapters.forEach((c, ci) => this.column(cols, ctx, act, c.num, nums, ci));
    // scenes whose chapter is not a number cannot be reordered, but they must still show
    const known = new Set(nums.map(String));
    const odd = [...new Set(actScenes.filter((s) => !known.has(String(s.chapter ?? ""))).map((s) => String(s.chapter ?? "")))];
    for (const key of odd) this.column(cols, ctx, act, key, [], -1);

    // dropping a chapter on the empty space at the end of an act puts it last in that act
    cols.addEventListener("dragover", (ev) => {
      if (ev.target !== cols || !ev.dataTransfer?.types.includes(CHAPTER)) return;
      ev.preventDefault();
      cols.addClass("is-over");
    });
    cols.addEventListener("dragleave", (ev) => ev.target === cols && cols.removeClass("is-over"));
    cols.addEventListener("drop", (ev) => {
      if (ev.target !== cols) return;
      cols.removeClass("is-over");
      const n = ev.dataTransfer?.getData(CHAPTER);
      if (!n) return;
      ev.preventDefault();
      void this.moveChapter(ctx, Number(n), act, null);
    });

    if (w.hasMid) {
      const add = el(cols, "button", "booker-board-newcol");
      setIcon(el(add, "span", "booker-hub-ico"), "plus");
      el(add, "span", undefined, w.mid);
      add.addEventListener("click", () => this.newItem(ctx, "chapter", { act }));
    }
  }

  private column(parent: HTMLElement, ctx: Ctx, act: number, chapter: number | string, siblings: number[], at: number) {
    const list = ctx.scenes.filter((s) => String(s.act) === String(act) && String(s.chapter ?? "") === String(chapter));
    const numeric = typeof chapter === "number";
    const w = ctx.w;
    const midLow = w.mid.toLowerCase();
    const itemLow = w.item.toLowerCase();
    const col = el(parent, "div", "booker-board-col" + (w.hasMid ? "" : " is-bare"));
    // without a middle level the column is only a place for the items: no heading, no chapter tools
    const head = w.hasMid ? el(col, "div", "booker-board-col-head") : createDiv();
    el(head, "strong", undefined, numeric ? chapterTitle(chapter, ctx.labels, w.mid) : chapterTitle(chapter === "" ? undefined : chapter, undefined, w.mid));
    if (numeric && w.hasMid) {
      head.draggable = true;
      head.addClass("is-draggable");
      head.setAttr("aria-label", `Drag to move this ${midLow}`);
      head.addEventListener("dragstart", (ev) => {
        ev.dataTransfer?.setData(CHAPTER, String(chapter));
        if (ev.dataTransfer) ev.dataTransfer.effectAllowed = "move";
        window.setTimeout(() => col.addClass("is-dragging"), 0);
      });
      head.addEventListener("dragend", () => col.removeClass("is-dragging"));
      const tools = el(head, "span", "booker-board-tools");
      this.iconBtn(tools, "pencil", `Name this ${midLow}`, () => this.rename(ctx, "chapter", chapter));
      if (at > 0) this.iconBtn(tools, "chevron-left", `Move ${midLow} left`, () => void this.moveChapter(ctx, chapter, act, siblings[at - 1]));
      if (at < siblings.length - 1) this.iconBtn(tools, "chevron-right", `Move ${midLow} right`, () => void this.moveChapter(ctx, chapter, act, siblings[at + 2] ?? null));
      if (list.length === 0) this.iconBtn(tools, "trash-2", `Remove this empty ${midLow}`, () => void this.run(() => removeEmpty(this.plugin.app, ctx.proj, ctx.scenes, "chapter", chapter), `remove the ${midLow}`));
    }
    if (w.hasMid) el(col, "div", "booker-muted booker-board-col-words", `${list.reduce((n, s) => n + s.words, 0).toLocaleString()} words`);
    const body = el(col, "div", "booker-board-col-body");
    for (const s of list) this.card(body, s, ctx.w);
    if (list.length === 0) el(body, "div", "booker-board-empty booker-muted", w.hasMid ? `Empty ${midLow}` : `No ${w.itemMany.toLowerCase()} yet`);
    const add = el(col, "button", "booker-board-add", `+${itemLow}`);
    add.addEventListener("click", () => this.newItem(ctx, "scene", { act, chapter }));

    // drop target for scene cards (slot by pointer height) and for whole chapters (before or after this one)
    const cards = () => Array.from(body.querySelectorAll<HTMLElement>(".booker-card:not(.is-dragging)"));
    const slotAt = (y: number) => cards().filter((c) => y > c.getBoundingClientRect().top + c.getBoundingClientRect().height / 2).length;
    const clear = () => {
      body.querySelectorAll(".booker-drop").forEach((m) => m.remove());
      col.removeClass("is-over", "drop-before", "drop-after");
    };
    col.addEventListener("dragover", (ev) => {
      const types = ev.dataTransfer?.types ?? [];
      if (types.includes(SCENE)) {
        ev.preventDefault();
        if (ev.dataTransfer) ev.dataTransfer.dropEffect = "move";
        clear();
        col.addClass("is-over");
        const m = el(body, "div", "booker-drop");
        body.insertBefore(m, cards()[slotAt(ev.clientY)] ?? null);
      } else if (types.includes(CHAPTER) && numeric) {
        ev.preventDefault();
        clear();
        const r = col.getBoundingClientRect();
        col.addClass(ev.clientX < r.left + r.width / 2 ? "drop-before" : "drop-after");
      }
    });
    col.addEventListener("dragleave", (ev) => {
      if (!(ev.relatedTarget instanceof Node && col.contains(ev.relatedTarget))) clear();
    });
    col.addEventListener("drop", (ev) => {
      const sceneId = ev.dataTransfer?.getData(SCENE);
      const chapterId = ev.dataTransfer?.getData(CHAPTER);
      const r = col.getBoundingClientRect();
      const before = ev.clientX < r.left + r.width / 2;
      const idx = slotAt(ev.clientY);
      clear();
      if (sceneId) {
        ev.preventDefault();
        void this.moveScene(ctx, sceneId, act, chapter, idx);
      } else if (chapterId && numeric) {
        ev.preventDefault();
        void this.moveChapter(ctx, Number(chapterId), act, before ? chapter : siblings[at + 1] ?? null);
      }
    });
  }

  private card(parent: HTMLElement, s: HubScene, w: Words) {
    const c = el(parent, "div", `booker-card status-${s.status}`);
    c.draggable = true;
    c.addEventListener("dragstart", (ev) => {
      ev.stopPropagation();
      ev.dataTransfer?.setData(SCENE, s.path);
      if (ev.dataTransfer) ev.dataTransfer.effectAllowed = "move";
      window.setTimeout(() => c.addClass("is-dragging"), 0);
    });
    c.addEventListener("dragend", () => c.removeClass("is-dragging"));
    c.addEventListener("click", () => {
      const f = this.plugin.app.vault.getFileByPath(s.path);
      if (f) void openNoteIn(this.plugin, f, this.leaf);
    });
    c.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      const menu = new Menu();
      menu.addItem((i) => i.setTitle("Open").setIcon("file-text").onClick(() => c.click()));
      menu.addItem((i) => i.setTitle(`Archive ${w.item.toLowerCase()}`).setIcon("archive").onClick(() => this.archive(s, w)));
      menu.showAtMouseEvent(ev);
    });
    const top = el(c, "div", "booker-card-top");
    el(top, "span", `booker-dot status-${s.status}`);
    el(top, "span", "booker-card-title", s.title);
    const meta = el(c, "div", "booker-card-meta booker-muted");
    el(meta, "span", undefined, `${s.words.toLocaleString()} words`);
    if (s.pov) el(meta, "span", undefined, `POV ${s.pov}`);
    if (s.characters?.length) el(meta, "span", undefined, s.characters.slice(0, 3).join(", ") + (s.characters.length > 3 ? "…" : ""));
    // the summary (or the description, when there is none) under the title, so a merged chapter keeps what its scenes said
    const about = s.ownSummary ?? s.aiShort ?? s.description ?? s.aiFull;
    if (about) {
      const d = el(c, "div", "booker-card-summary" + (s.ownSummary || (!s.aiShort && s.description) ? "" : " is-ai"), about);
      d.setAttr("title", about);
    }
  }

  // ---------------------------------------------------------------- actions

  private archive(s: HubScene, w: Words) {
    const proj = this.project();
    if (!proj) return;
    const app = this.plugin.app;
    new ConfirmModal(app, `Archive this ${w.item.toLowerCase()}?`, `“${s.title}” leaves the book but is kept in the Archive folder. You can restore it from the Archive button.`, "Archive", () =>
      void this.run(() => archiveScene(app, proj, readScenes(app, proj), s.path), `archive the ${w.item.toLowerCase()}`)
    ).open();
  }

  private openArchive(ctx: Ctx) {
    const app = this.plugin.app;
    new ArchiveModal(
      app,
      () => listArchived(app, ctx.proj),
      (a) => this.run(() => restoreScene(app, ctx.proj, readScenes(app, ctx.proj), a), `restore the ${ctx.w.item.toLowerCase()}`),
      (a) => void openNoteIn(this.plugin, a.file, this.leaf),
      ctx.w,
      ctx.labels
    ).open();
  }

  /** Run a change to the vault without the board redrawing halfway, then redraw once. */
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

  private async moveScene(ctx: Ctx, path: string, act: number | string, chapter: number | string, index: number) {
    const refs = toRefs(ctx.scenes);
    const position = positionInAct(refs, path, act, chapter, index);
    const ops = planMove(refs, path, { act, chapter, position }, ctx.proj.layout.scenes);
    if (!ops.length) return;
    await this.run(async () => {
      await applyMoves(this.plugin.app, ops);
      await syncActFolders(this.plugin.app, ctx.proj, ctx.model.acts);
    }, `move the ${ctx.w.item.toLowerCase()}`);
  }

  private async moveChapter(ctx: Ctx, chapter: number | string, act: number, before: number | string | null) {
    if (typeof chapter !== "number") return;
    const plan = planMoveChapter(toRefs(ctx.scenes), ctx.model, ctx.labels, chapter, act, typeof before === "number" ? before : null, ctx.proj.layout.scenes);
    if (!plan) return;
    await this.run(() => applyChapterPlan(this.plugin.app, ctx.proj, ctx.scenes, plan), `move the ${ctx.w.mid.toLowerCase()}`);
  }

  private rename(ctx: Ctx, kind: "act" | "chapter", key: number | string) {
    const map = kind === "act" ? ctx.labels.acts : ctx.labels.chapters;
    const what = `${kind === "act" ? ctx.w.top : ctx.w.mid} ${key}`;
    new NamePrompt(
      this.plugin.app,
      `Name ${what}`,
      "Leave empty to remove the name. Folders and files stay numbered so other tools can read them.",
      (name) => void this.run(() => updateLabels(this.plugin.app, ctx.proj, (l) => setLabel(l, kind, key, name)), "save the name"),
      map[String(key)] ?? "",
      true
    ).open();
  }

  /** The same one-row dialog as the hub: only what the book has is offered. */
  private newItem(ctx: Ctx, kind: NewKind, at?: { act: number | string; chapter?: number | string }) {
    new NewItemModal(this.plugin.app, ctx.scenes, ctx.labels, kind, at, (c) => {
      void this.run(async () => {
        const f = await createSceneNamed(this.plugin.app, ctx.proj, c, ctx.scenes);
        if (kind === "scene") void openNoteIn(this.plugin, f, this.leaf);
      }, `add the ${(kind === "act" ? ctx.w.top : kind === "chapter" ? ctx.w.mid : ctx.w.item).toLowerCase()}`);
    }, profileFor(ctx.proj)).open();
  }
}
