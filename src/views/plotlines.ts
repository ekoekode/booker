import { ItemView, Menu, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import type BookerPlugin from "../main";
import { openNoteIn } from "../openTarget";
import { chapterTitle, Labels } from "../project/format";
import { branchFrom, buildMap, connectors, joinLines, laneOrder, lineEnd, markOf, PlotlineFile, runs, withMark, wouldLoop, type Mark, type RelationKind } from "../project/plotlines";
import { findProjects, getLabels, profileFor, Project, readScopePlotlines, readScopeScenes, seriesBooks, setPlotMark, writePlotlines } from "../project/vaultOps";
import { wordsFor } from "../profiles/words";
import type { HubScene } from "../project/hubModel";
import { actionBtn, actionRow, ListPicker, NamePrompt, notifyError } from "../ui";

export const VIEW_PLOTLINES = "booker-plotlines";

export type Scope = "book" | "series";

const LABEL_W = 170;
const COL_W = 54;
const LANE_H = 46;
const BOOK_H = 22;
const CHAP_H = 22;
const NUM_H = 26;
const NS = "http://www.w3.org/2000/svg";

function svg<K extends keyof SVGElementTagNameMap>(parent: Element, tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent.appendChild(e);
  return e;
}

/** The shape a scene has on a plotline: a ring for a station, a triangle for a setup, a diamond for a payoff. */
export function drawMark(parent: Element, mark: Exclude<Mark, "off">, cx: number, cy: number, color: string): SVGElement {
  if (mark === "setup") return svg(parent, "polygon", { points: `${cx},${cy - 11} ${cx - 11},${cy + 8} ${cx + 11},${cy + 8}`, class: "booker-pl-setup", fill: color });
  if (mark === "payoff") return svg(parent, "polygon", { points: `${cx},${cy - 12} ${cx + 12},${cy} ${cx},${cy + 12} ${cx - 12},${cy}`, class: "booker-pl-payoff", fill: color });
  return svg(parent, "circle", { cx, cy, r: 9, class: "booker-pl-stop", stroke: color });
}

const MARK_NAME: Record<Exclude<Mark, "off">, string> = { scene: "scene on this plotline", setup: "setup", payoff: "payoff" };

/** Plotlines as a subway map: a line per plotline (a tag), a station per scene, interchanges where scenes carry several. */
export class PlotlinesView extends ItemView {
  private projectPath: string | null = null;
  private range: Scope = "book";
  private data: PlotlineFile | null = null;
  private scenes: HubScene[] = [];
  private labels = new Map<string, Labels>();
  private saving = false;
  private marking = 0;
  /** parents whose subplots are folded away */
  private collapsed = new Set<string>();

  constructor(leaf: WorkspaceLeaf, private plugin: BookerPlugin) {
    super(leaf);
  }

  getViewType() {
    return VIEW_PLOTLINES;
  }
  getDisplayText() {
    return "Plotlines";
  }
  getIcon() {
    return "train-front";
  }
  getState() {
    return { project: this.projectPath, scope: this.range };
  }
  async setState(state: any, result: any) {
    if (state?.project) this.projectPath = state.project;
    if (state?.scope === "book" || state?.scope === "series") this.range = state.scope;
    await super.setState(state, result);
    await this.loadLines();
  }

  async onOpen() {
    this.contentEl.addClass("booker-plotlines", "booker-board");
    const reload = (f: unknown) => {
      if (f instanceof TFile && !this.saving && !this.marking && (f.name === "plotlines.json" || f.path.includes("/Scenes/"))) void this.loadLines();
    };
    this.registerEvent(this.plugin.app.metadataCache.on("changed", reload));
    this.registerEvent(this.plugin.app.vault.on("modify", reload));
    await this.loadLines();
  }

  private project(): Project | null {
    const all = findProjects(this.plugin.app);
    return all.find((p) => p.file.path === this.projectPath) ?? all[0] ?? null;
  }

  private async loadLines() {
    const proj = this.project();
    if (!proj) {
      this.contentEl.empty();
      this.contentEl.createEl("p", { cls: "booker-muted", text: "No project yet. Create one from the Booker hub." });
      return;
    }
    const scope: Scope = proj.series ? this.range : "book";
    this.scenes = await readScopeScenes(this.plugin.app, proj, scope);
    this.data = await readScopePlotlines(this.plugin.app, proj, scope);
    this.labels.clear();
    for (const b of scope === "series" ? await seriesBooks(this.plugin.app, proj) : [proj]) this.labels.set(b.name, getLabels(this.plugin.app, b));
    this.render(proj, scope);
  }

  private async save(proj: Project) {
    this.saving = true;
    try {
      await writePlotlines(this.plugin.app, proj, this.data!);
    } catch (e) {
      notifyError(e, "save the plotlines");
    } finally {
      window.setTimeout(() => (this.saving = false), 300);
    }
  }

  private openScene(path: string) {
    const f = this.plugin.app.vault.getFileByPath(path);
    if (f) void openNoteIn(this.plugin, f, this.leaf);
  }

  /** Put a scene on a plotline, or take it off, or make it a setup or payoff. The scene's properties are rewritten to match. */
  private async setMark(proj: Project, scope: Scope, sc: HubScene, tag: string, mark: Mark) {
    const cur = { tags: sc.tags ?? [], setup: sc.plotSetup ?? [], payoff: sc.plotPayoff ?? [] };
    const w = withMark(cur, tag, mark);
    sc.tags = w.tags;
    sc.plotSetup = w.setup;
    sc.plotPayoff = w.payoff;
    this.render(proj, scope);
    this.marking++;
    try {
      await setPlotMark(this.plugin.app, sc.path, tag, mark);
    } catch (e) {
      notifyError(e, "mark the scene");
    } finally {
      window.setTimeout(() => {
        this.marking--;
        if (!this.marking) void this.loadLines();
      }, 400);
    }
  }

  /** A station's pop-up: where the scene sits on this plotline, and the ways a plotline can branch, split or join another. */
  private stationMenu(ev: MouseEvent, proj: Project, scope: Scope, sc: HubScene, tag: string) {
    const mark = markOf(sc.tags ?? [], sc.plotSetup ?? [], sc.plotPayoff ?? [], tag);
    const menu = new Menu();
    const pick = (title: string, icon: string, m: Mark, current: boolean) =>
      menu.addItem((i) => i.setTitle(title).setIcon(current ? "check" : icon).onClick(() => void this.setMark(proj, scope, sc, tag, m)));
    pick("On this plotline", "circle", "scene", mark === "scene");
    if (proj.setupPayoff) {
      pick("Setup", "triangle", "setup", mark === "setup");
      pick("Payoff", "diamond", "payoff", mark === "payoff");
    }
    if (mark !== "off") pick("Remove from plotline", "x", "off", false);
    if (scope === "book") {
      menu.addSeparator();
      menu.addItem((i) => i.setTitle("Branch a new plotline from here…").setIcon("git-branch").onClick(() => this.newOffshoot(proj, scope, sc, tag, "branch")));
      menu.addItem((i) => i.setTitle("Split into two subplots…").setIcon("git-fork").onClick(() => this.newOffshoot(proj, scope, sc, tag, "split")));
      menu.addItem((i) =>
        i
          .setTitle("Run into another plotline…")
          .setIcon("git-merge")
          .onClick(() => {
            const others = Object.keys(this.data!.tagColors).filter((t) => t !== tag);
            new ListPicker(this.plugin.app, others, (t) => t, `Which plotline does “${tag}” join at this ${wordsFor(profileFor(proj)).item.toLowerCase()}?`, (to) => void this.joinAt(proj, scope, sc, tag, to)).open();
          })
      );
    }
    menu.showAtMouseEvent(ev);
  }

  private cleanTag(name: string): string {
    return name.trim().replace(/^#/, "").replace(/\s+/g, "-");
  }

  /** A branch makes one new plotline that starts at this scene; a split makes two and the parent ends here. */
  private newOffshoot(proj: Project, scope: Scope, sc: HubScene, parent: string, kind: RelationKind) {
    const split = kind === "split";
    new NamePrompt(
      this.plugin.app,
      split ? `Split “${parent}”` : `Branch from “${parent}”`,
      split ? "Names of the two subplots, separated by a comma." : "Name the new plotline. The scene joins it, and “" + parent + "” carries on.",
      (text) => {
        const names = (split ? text.split(",") : [text]).map((n) => this.cleanTag(n)).filter(Boolean);
        const d = this.data!;
        const fresh = names.filter((n, i) => !(n in d.tagColors) && names.indexOf(n) === i && !wouldLoop(d.relations, n, parent));
        if ((split && fresh.length < 2) || !fresh.length) return void notifyError(new Error(split ? "Give two new names that are not plotlines yet." : "That name is already a plotline."), "make the plotline");
        let next = d;
        for (const n of fresh.slice(0, split ? 2 : 1)) next = branchFrom(next, parent, n, sc.path, kind, this.nextColor(next));
        this.data = next;
        void (async () => {
          await this.save(proj);
          for (const n of fresh.slice(0, split ? 2 : 1)) await setPlotMark(this.plugin.app, sc.path, n, "scene");
          await this.loadLines();
        })().catch((e) => notifyError(e, "make the plotline"));
      }
    ).open();
  }

  private async joinAt(proj: Project, scope: Scope, sc: HubScene, from: string, to: string) {
    this.data = joinLines(this.data!, from, to, sc.path);
    try {
      await this.save(proj);
      if (!(sc.tags ?? []).includes(to)) await setPlotMark(this.plugin.app, sc.path, to, "scene");
      await this.loadLines();
    } catch (e) {
      notifyError(e, "join the plotlines");
    }
  }

  private render(proj: Project, scope: Scope) {
    const words = wordsFor(profileFor(proj));
    const item = words.item.toLowerCase();
    const itemMany = words.itemMany.toLowerCase();
    const root = this.contentEl;
    const keep = root.querySelector<HTMLElement>(".booker-pl-wrap");
    const scroll = keep ? { x: keep.scrollLeft, y: keep.scrollTop } : null;
    root.empty();
    const d = this.data!;
    const head = root.createDiv({ cls: "booker-board-head" });
    head.createEl("h3", { text: `${scope === "series" && proj.series ? proj.series.name : proj.name} · Plotlines` });
    const acts = actionRow(head, "booker-board-actions");
    if (proj.series) {
      actionBtn(acts, "This book", "book", () => void this.setScope("book"), { cta: scope === "book", tip: `Only this book's ${itemMany}` });
      actionBtn(acts, "Whole series", "library", () => void this.setScope("series"), { cta: scope === "series", tip: "Every book in the series, side by side" });
    }
    actionBtn(acts, "+Plotline", "route", () => this.addLine(proj), { cta: true, tip: "Add a plotline" });

    const used = new Set(this.scenes.flatMap((s) => s.tags ?? []));
    const extra = Object.keys(d.tagColors).filter((t) => !used.has(t));
    const all = buildMap(this.scenes.map((s) => ({ path: s.path, tags: s.tags ?? [] })), d.tagColors, extra);
    // subplots sit under their parent; a folded parent hides them
    const slots = laneOrder(all.lines.map((l) => l.tag), d.relations, this.collapsed);
    const shown = new Set(slots.map((x) => x.tag));
    const depthOf = new Map(slots.map((x) => [x.tag, x]));
    const map = buildMap(this.scenes.map((s) => ({ path: s.path, tags: (s.tags ?? []).filter((t) => shown.has(t)) })), d.tagColors, extra.filter((t) => shown.has(t)), slots.map((x) => x.tag));
    const sceneIndex = (path: string) => this.scenes.findIndex((s) => s.path === path);

    if (!map.lines.length) {
      root.createEl("p", { cls: "booker-muted", text: `A plotline is a tag on a ${item}. Add one, then click a station to put a ${item} on it.` });
      return;
    }
    if (!this.scenes.length) {
      root.createEl("p", { cls: "booker-muted", text: `Add ${itemMany} to see the map.` });
      return;
    }

    this.key(root);

    const showBooks = scope === "series";
    const bookH = showBooks ? BOOK_H : 0;
    const top = bookH + CHAP_H + NUM_H + 8;
    const w = this.scenes.length * COL_W + 20;
    const h = top + map.lines.length * LANE_H + 10;
    const x = (i: number) => i * COL_W + COL_W / 2;
    const y = (l: number) => top + l * LANE_H + LANE_H / 2;

    const wrap = root.createDiv({ cls: "booker-pl-wrap" });

    // plotline names stay at the left while the map scrolls
    const names = wrap.createDiv({ cls: "booker-pl-names" });
    names.style.width = `${LABEL_W}px`;
    names.createDiv({ cls: "booker-pl-names-head" }).style.height = `${top}px`;
    map.lines.forEach((ln) => {
      const row = names.createDiv({ cls: "booker-pl-name" });
      row.style.height = `${LANE_H}px`;
      row.style.color = ln.color;
      const slot = depthOf.get(ln.tag);
      row.style.paddingLeft = `${(slot?.depth ?? 0) * 14}px`;
      if (slot?.depth) setIcon(row.createSpan({ cls: "booker-pl-fork" }), "corner-down-right");
      if (slot?.parent) {
        const fold = row.createSpan({ cls: "booker-pl-fold" });
        setIcon(fold, this.collapsed.has(ln.tag) ? "chevron-right" : "chevron-down");
        fold.setAttr("aria-label", this.collapsed.has(ln.tag) ? "Show the subplots" : "Fold the subplots away");
        fold.addEventListener("click", (e) => {
          e.stopPropagation();
          if (!this.collapsed.delete(ln.tag)) this.collapsed.add(ln.tag);
          this.render(proj, scope);
        });
      }
      row.createSpan({ cls: "booker-pl-swatch" }).style.background = ln.color;
      row.createSpan({ cls: "booker-pl-name-text", text: ln.tag });
      row.setAttr("aria-label", (d.plotlineDescriptions[ln.tag] ? d.plotlineDescriptions[ln.tag] + "\n" : "") + "Click for this plotline's note and options");
      row.addEventListener("click", (e) => this.lineMenu(e, proj, scope, ln.tag, ln.color));
    });

    const s = svg(wrap, "svg", { width: w, height: h, class: "booker-pl-svg" });

    if (showBooks) {
      for (const r of runs(this.scenes, (sc) => sc.book ?? "")) {
        const g = svg(s, "g");
        svg(g, "rect", { x: r.from * COL_W + 1, y: 0, width: (r.to - r.from + 1) * COL_W - 2, height: BOOK_H - 3, rx: 4, class: "booker-pl-bookband" });
        const t = svg(g, "text", { x: r.from * COL_W + 8, y: BOOK_H - 8, class: "booker-pl-bookname" });
        t.textContent = r.key;
        if (r.from > 0) svg(s, "line", { x1: r.from * COL_W, x2: r.from * COL_W, y1: 0, y2: h - 6, class: "booker-pl-book" });
      }
    }

    // chapters: a band over its scenes; pressing it opens its first scene
    const chapterOf = (sc: HubScene) => `${sc.book ?? ""}\u0000${sc.act}\u0000${sc.chapter ?? ""}`;
    for (const r of runs(this.scenes, chapterOf)) {
      const first = this.scenes[r.from];
      const name = chapterTitle(first.chapter, this.labels.get(first.book ?? proj.name));
      const g = svg(s, "g", { class: "booker-pl-chapter" });
      svg(g, "rect", { x: r.from * COL_W + 2, y: bookH, width: (r.to - r.from + 1) * COL_W - 4, height: CHAP_H - 3, rx: 4, class: "booker-pl-chapband" });
      const t = svg(g, "text", { x: r.from * COL_W + 8, y: bookH + CHAP_H - 8, class: "booker-pl-chaptext" });
      const room = Math.floor(((r.to - r.from + 1) * COL_W - 14) / 6.5);
      t.textContent = name.length > room ? name.slice(0, Math.max(room - 1, 0)) + "…" : name;
      svg(g, "title").textContent = `${name}: open its first scene`;
      g.addEventListener("click", () => this.openScene(first.path));
    }

    // scene numbers: hover for the chapter and title, press to open the scene
    this.scenes.forEach((sc, i) => {
      const chap = chapterTitle(sc.chapter, this.labels.get(sc.book ?? proj.name));
      const t = svg(s, "text", { x: x(i), y: bookH + CHAP_H + NUM_H - 8, "text-anchor": "middle", class: "booker-pl-num" });
      t.textContent = String(i + 1);
      svg(t, "title").textContent = `${chap} · ${sc.title}\nClick to open`;
      t.addEventListener("click", () => this.openScene(sc.path));
      const prev = this.scenes[i - 1];
      if (i > 0 && prev.book === sc.book && String(prev.act) !== String(sc.act)) svg(s, "line", { x1: i * COL_W, x2: i * COL_W, y1: bookH + CHAP_H, y2: h - 6, class: "booker-pl-act" });
    });

    map.lines.forEach((ln, li) => {
      const end = lineEnd(ln.tag, ln.stops, d.relations, sceneIndex);
      if (ln.stops.length > 1 && end !== undefined && end > ln.stops[0]) svg(s, "line", { x1: x(ln.stops[0]), x2: x(end), y1: y(li), y2: y(li), stroke: ln.color, "stroke-width": 6, "stroke-linecap": "round", opacity: 0.85 });
    });

    // branches, splits and joins: a curve from one lane to the other
    for (const c of connectors(map, d.relations, d.joins, sceneIndex)) {
      const x1 = x(c.fromAt);
      const x2 = x(c.toAt);
      const y1 = y(c.fromLane);
      const y2 = y(c.toLane);
      const mid = (x1 + x2) / 2;
      const path = x1 === x2 ? `M ${x1} ${y1} L ${x2} ${y2}` : `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`;
      const e = svg(s, "path", { d: path, stroke: c.color, class: `booker-pl-conn is-${c.kind}` });
      svg(e, "title").textContent = c.kind === "join" ? "Runs into another plotline" : c.kind === "split" ? "Splits here" : "Branches here";
    }

    this.scenes.forEach((sc, i) => {
      const span = map.spans[i];
      if (span && span.hi > span.lo) svg(s, "line", { x1: x(i), x2: x(i), y1: y(span.lo), y2: y(span.hi), class: "booker-pl-link" });
      map.lines.forEach((ln, li) => {
        const mark = markOf(sc.tags ?? [], sc.plotSetup ?? [], sc.plotPayoff ?? [], ln.tag);
        const g = svg(s, "g", { class: "booker-pl-cell" });
        svg(g, "rect", { x: i * COL_W, y: top + li * LANE_H, width: COL_W, height: LANE_H, class: "booker-pl-hit" });
        if (mark === "off") svg(g, "circle", { cx: x(i), cy: y(li), r: 6, class: "booker-pl-ghost" });
        else drawMark(g, mark, x(i), y(li), ln.color);
        const now = mark === "off" ? "not on this plotline" : MARK_NAME[mark];
        svg(g, "title").textContent = `${sc.title} (${now}). Click for options.`;
        g.addEventListener("click", (e) => this.stationMenu(e as MouseEvent, proj, scope, sc, ln.tag));
      });
    });

    if (scroll) {
      wrap.scrollLeft = scroll.x;
      wrap.scrollTop = scroll.y;
    }
    root.createEl("p", { cls: "booker-muted booker-pl-hint", text: `Click a station for a list: put the ${item} on the plotline, take it off, or branch, split and join plotlines. Click a ${item} number to open the ${item}${words.hasMid ? `; click a ${words.mid.toLowerCase()} to open its first ${item}` : ""}.` });
  }

  /** The shape key: what a ring, a triangle and a diamond mean. */
  private key(root: HTMLElement) {
    const k = root.createDiv({ cls: "booker-pl-key" });
    const item = (mark: Exclude<Mark, "off"> | "off", text: string) => {
      const e = k.createSpan({ cls: "booker-pl-key-item" });
      const s = svg(e, "svg", { width: 26, height: 26, viewBox: "0 0 26 26" });
      if (mark === "off") svg(s, "circle", { cx: 13, cy: 13, r: 6, class: "booker-pl-ghost", style: "opacity:0.6" });
      else drawMark(s, mark, 13, 13, "var(--text-accent)");
      e.createSpan({ text });
    };
    item("off", "Not on it");
    item("scene", "Scene on the plotline");
    if (this.project()?.setupPayoff) {
      item("setup", "Setup");
      item("payoff", "Payoff");
    }
    k.createSpan({ cls: "booker-muted", text: "Click a station for its options." });
  }

  private async setScope(scope: Scope) {
    this.range = scope;
    await this.loadLines();
    this.app.workspace.requestSaveLayout();
  }

  private addLine(proj: Project) {
    new NamePrompt(this.plugin.app, "New plotline", "Name it: for example a romance, a mystery or a character's arc.", (name) => {
      const tag = name.trim().replace(/^#/, "").replace(/\s+/g, "-");
      if (!tag || this.data!.tagColors[tag]) return;
      this.data!.tagColors[tag] = this.nextColor();
      void this.save(proj).then(() => this.render(proj, proj.series ? this.range : "book"));
    }).open();
  }

  private nextColor(d: PlotlineFile = this.data!): string {
    const n = Object.keys(d.tagColors).length;
    return ["#e5484d", "#3e63dd", "#30a46c", "#f5a524", "#8e4ec6", "#12a594", "#d6409f", "#978365"][n % 8];
  }

  /** Click a plotline's name: its note, or cut it loose from its parent. */
  private lineMenu(ev: MouseEvent, proj: Project, scope: Scope, tag: string, color: string) {
    const menu = new Menu();
    menu.addItem((i) => i.setTitle("Note…").setIcon("pencil").onClick(() => this.editLine(proj, scope, tag, color)));
    const rel = this.data!.relations[tag];
    if (rel && scope === "book")
      menu.addItem((i) =>
        i
          .setTitle(`Cut loose from “${rel.parent}”`)
          .setIcon("unlink")
          .onClick(() => {
            const { [tag]: _gone, ...rest } = this.data!.relations;
            this.data = { ...this.data!, relations: rest };
            void this.save(proj).then(() => this.render(proj, scope));
          })
      );
    menu.showAtMouseEvent(ev);
  }

  /** A short note for one plotline, saved to the book's plotlines.json. */
  private editLine(proj: Project, scope: Scope, tag: string, color: string) {
    new NamePrompt(
      this.plugin.app,
      `${tag}: note`,
      "What is this plotline for? Leave empty to clear.",
      (note) => {
        const d = this.data!;
        d.tagColors[tag] = color;
        if (note.trim()) d.plotlineDescriptions[tag] = note.trim();
        else delete d.plotlineDescriptions[tag];
        void this.save(proj).then(() => this.render(proj, scope));
      },
      this.data!.plotlineDescriptions[tag] ?? "",
      true
    ).open();
  }
}
