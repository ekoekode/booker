import { ItemView, Menu, Notice, Platform, WorkspaceLeaf, debounce, setIcon } from "obsidian";
import type BookerPlugin from "../main";
import { GroupBy, groupLanes, packRows, TimelineItem } from "../analysis";
import { formatTime, parseStoryDate, resizeStoryDate, shiftStoryDate, WhenPair } from "../dates";
import { findProjects, Project, readLives, readScopeScenes, readSystemJson, writeSystemJson } from "../project/vaultOps";
import { gatherMapItems } from "../project/timelineData";
import { buildLanes, candidateSources, itemColor, MapConfig, MapLane, parseConfig, SOURCE_LABELS, Source, sourceKey, textOn } from "../project/timelineSources";
import { codexFiles } from "../project/vaultOps";
import { SOURCE_ICONS } from "./timelineSourcesUi";
import { makeTicks } from "../ticks";
import { applyEdit, followers, sequenceOf, splitDate, type SeqLife } from "../project/lifeSequence";
import { openNoteIn } from "../openTarget";
import { actionBtn, actionRow } from "../ui";

export const VIEW_TIMELINE_MAP = "booker-timeline-map";

const NS = "http://www.w3.org/2000/svg";
const MIN_SPAN = 1 / 365 / 4;
const MAX_SPAN = 20_000_000;
const ROW_H = 22;
const BAR_H = 16;
const MAX_ROWS = 8;
const LANE_PAD = 8;
const CLICK_SLOP = 3;

function s<K extends keyof SVGElementTagNameMap>(parent: SVGElement, tag: K, attrs: Record<string, string | number> = {}, text?: string): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (text !== undefined) e.textContent = text;
  parent.appendChild(e);
  return e;
}

/** The zoomable timeline: scenes with a story date as bars on a time axis. Pinch or Ctrl/Cmd+scroll to zoom, drag to pan, drag a bar to change its date. */
export class TimelineMapView extends ItemView {
  private projectPath: string | null = null;
  private groupBy: GroupBy = "character";
  private cfg: MapConfig = parseConfig(null);
  private cfgLoaded = false;
  private saveTimer = 0;
  private bookFilter = "";
  private laneFilter = "";
  private items: TimelineItem[] = [];
  private t0 = 0;
  private t1 = 1;
  private fitted = false;
  private selected: TimelineItem | null = null;
  /** the playhead: a moment you clicked, which zooming pivots on */
  private playhead: number | null = null;
  /** the Custom sources box starts minimised */
  private customOpen = false;

  private toolbar!: HTMLElement;
  private axisSvg!: SVGSVGElement;
  private bodyWrap!: HTMLElement;
  private bodySvg!: SVGSVGElement;
  private info!: HTMLElement;
  private width = 800;
  private labelW = 120;

  private packCache: { key: string; rows: Map<string, number[]> } | null = null;
  private lanes: MapLane[] = [];
  private raf = 0;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinchDist = 0;
  private dragMoved = false;
  private drag: ItemDrag | null = null;
  private dragTip: HTMLElement | null = null;
  private reload = debounce(() => this.refreshData(false), 500, true);
  private ro: ResizeObserver | null = null;

  constructor(leaf: WorkspaceLeaf, private plugin: BookerPlugin) {
    super(leaf);
  }

  getViewType() {
    return VIEW_TIMELINE_MAP;
  }
  getDisplayText() {
    return "Timeline map";
  }
  getIcon() {
    return "git-commit-horizontal";
  }

  getState() {
    return { project: this.projectPath, groupBy: this.groupBy, scope: this.range };
  }
  async setState(state: any, result: any) {
    if (state?.project) this.projectPath = state.project;
    if (state?.groupBy) this.groupBy = state.groupBy;
    if (state?.scope === "book" || state?.scope === "series") this.range = state.scope;
    await super.setState(state, result);
    if (this.toolbar) await this.refreshData(true);
  }

  async onOpen() {
    const root = this.contentEl;
    root.empty();
    root.addClass("booker-timeline");
    this.toolbar = root.createDiv({ cls: "booker-tl-toolbar" });
    this.axisSvg = document.createElementNS(NS, "svg") as SVGSVGElement;
    this.axisSvg.addClass("booker-tl-axis");
    root.appendChild(this.axisSvg);
    this.bodyWrap = root.createDiv({ cls: "booker-tl-body" });
    this.bodySvg = document.createElementNS(NS, "svg") as SVGSVGElement;
    this.bodySvg.addClass("booker-tl-svg");
    this.bodyWrap.appendChild(this.bodySvg);
    this.info = root.createDiv({ cls: "booker-tl-info" });

    this.attachGestures(this.bodySvg);
    this.attachGestures(this.axisSvg);

    this.ro = new ResizeObserver(() => {
      this.measure();
      this.schedule();
    });
    this.ro.observe(this.bodyWrap);
    this.register(() => this.ro?.disconnect());
    this.registerEvent(this.plugin.app.metadataCache.on("changed", (f) => (f.path.includes("/Scenes/") || f.path.includes("/Codex/")) && !this.drag && this.reload()));
    await this.refreshData(true);
  }

  private measure() {
    this.width = Math.max(240, this.bodyWrap.clientWidth || 800);
    this.labelW = this.width < 520 ? 84 : 130;
  }

  private project(): Project | null {
    const all = findProjects(this.plugin.app);
    return all.find((p) => p.file.path === this.projectPath) ?? all[0] ?? null;
  }

  async refreshData(fit: boolean) {
    try {
      await this.refreshDataInner(fit);
    } catch (e) {
      console.error("Booker timeline", e);
      try {
        this.info.empty();
        this.info.createSpan({ cls: "booker-muted", text: `Booker could not draw this tab: ${e instanceof Error ? e.message : String(e)} ` });
        this.info.createEl("button", { cls: "booker-btn mod-cta", text: "Retry" }).onclick = () => void this.refreshData(true);
      } catch (e2) {
        console.error("Booker timeline", e2);
      }
    }
  }

  private async refreshDataInner(fit: boolean) {
    const proj = this.project();
    this.buildToolbar();
    if (!proj) {
      this.items = [];
      this.render();
      return;
    }
    if (!this.cfgLoaded) {
      this.cfg = parseConfig(await readSystemJson(this.plugin.app, proj, "timeline-map.json"));
      this.cfgLoaded = true;
    }
    const scope = proj.series ? this.range : "book";
    this.items = gatherMapItems(this.plugin.app, proj, await readScopeScenes(this.plugin.app, proj, scope));
    const d = { books: [...new Set(this.items.filter((i) => i.kind === "scene").map((i) => i.book))].map((title) => ({ title })) };
    this.books = d.books.map((b) => b.title);
    this.buildToolbar();
    if (fit || !this.fitted) this.fit();
    this.measure();
    this.packCache = null;
    this.render();
  }

  private books: string[] = [];
  private range: "book" | "series" = "book";

  private setRange(range: "book" | "series") {
    this.range = range;
    this.bookFilter = "";
    this.app.workspace.requestSaveLayout();
    void this.refreshData(true);
  }

  private buildToolbar() {
    const t = this.toolbar;
    t.empty();
    t.createEl("h3", { cls: "booker-tl-title", text: "Timeline map" });
    const row = t.createDiv({ cls: "booker-tl-bar" });
    // the custom sources box sits under the filter bar and is shown or hidden by the Custom button
    const custom = t.createDiv({ cls: "booker-tl-custom" });
    custom.style.display = this.customOpen ? "" : "none";
    this.buildAdders(custom);
    const box = custom.createDiv({ cls: "booker-tl-sources" });
    const mk = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string) => {
      const e = row.createEl(tag, { cls });
      if (text) e.setText(text);
      return e;
    };
    const f = mk("input", "booker-tl-filter");
    f.type = "search";
    f.placeholder = "Filter lanes";
    f.value = this.laneFilter;
    f.oninput = () => {
      this.laneFilter = f.value.trim().toLowerCase();
      this.packCache = null;
      this.render();
    };

    if (!this.cfg.sources.length) {
      const g = mk("select", "dropdown");
      const opts: [GroupBy, string][] = [
        ["character", "Lanes: characters"],
        ["plotline", "Lanes: plotlines"],
        ["location", "Lanes: locations"],
        ["book", "Lanes: acts"],
        ["none", "One lane"],
      ];
      for (const [v, label] of opts) {
        const o = g.createEl("option", { text: label });
        o.value = v;
        if (v === this.groupBy) o.selected = true;
      }
      g.onchange = () => {
        this.groupBy = g.value as GroupBy;
        this.packCache = null;
        this.render();
      };
    }

    if (this.books.length > 1) {
      const b = mk("select", "dropdown");
      const all = b.createEl("option", { text: "All books" });
      all.value = "";
      for (const name of this.books) {
        const o = b.createEl("option", { text: name });
        o.value = name;
        if (name === this.bookFilter) o.selected = true;
      }
      b.onchange = () => {
        this.bookFilter = b.value;
        this.packCache = null;
        this.render();
      };
    }

    const zoomBox = mk("span", "booker-tl-zoom");
    const btn = (label: string, title: string, fn: () => void) => {
      const b = zoomBox.createEl("button", { cls: "booker-btn", text: label });
      b.title = title;
      b.onclick = fn;
    };
    btn("−", "Zoom out", () => this.zoomBy(1.6, this.plotW() / 2));
    btn("+", "Zoom in", () => this.zoomBy(1 / 1.6, this.plotW() / 2));
    btn("◀", "Pan left", () => this.pan(-this.plotW() * 0.4));
    btn("▶", "Pan right", () => this.pan(this.plotW() * 0.4));
    btn("Fit", "Fit everything", () => {
      this.fit();
      this.render();
    });

    if (this.project()?.series) {
      const scope = row.createDiv({ cls: "booker-tl-btnrow" });
      actionBtn(scope, "This book", "book", () => this.setRange("book"), { cta: this.range === "book", tip: "Only this book's scenes" });
      actionBtn(scope, "Whole series", "library", () => this.setRange("series"), { cta: this.range === "series", tip: "Every book in the series on one timeline" });
    }

    const right = row.createDiv({ cls: "booker-tl-btnrow booker-tl-right" });
    if (this.cfg.sources.length) {
      const kinds = [...new Set(this.items.map((i) => i.kind))].sort();
      actionBtn(right, "Show", "eye", (ev) => this.openShow(kinds, ev), { tip: "Choose which kinds of element to show" });
      if (this.cfg.sources.length > 1) actionBtn(right, "Merge lanes", "merge", () => this.setCfg({ merge: !this.cfg.merge }), { cta: this.cfg.merge, tip: "Put everything in one lane" });
    }
    actionBtn(right, "Custom", "plus", () => {
      this.customOpen = !this.customOpen;
      this.buildToolbar();
      this.measure();
      this.render();
    }, { cta: this.customOpen, tip: "Add or remove the lanes of characters, places, plotlines and lives" });

    const pills = box.createDiv({ cls: "booker-tl-pills" });
    if (!this.cfg.sources.length) pills.createSpan({ cls: "booker-muted", text: "No sources yet. Add a character, place, plotline or life to build lanes from." });
    for (const src of this.cfg.sources) this.sourcePill(pills, src);
  }

  /** A thin pill: icon and name. Pressing it anywhere but the x opens the colour picker for that source. */
  private sourcePill(parent: HTMLElement, src: Source) {
    const pill = parent.createDiv({ cls: "booker-tl-pill" });
    const color = src.color ?? "#8e4ec6";
    pill.style.setProperty("--pill", color);
    pill.style.setProperty("--pill-text", textOn(color));
    setIcon(pill.createSpan({ cls: "booker-tl-pill-ico" }), SOURCE_ICONS[src.kind]);
    pill.createSpan({ cls: "booker-tl-pill-name", text: src.kind === "all" ? "Everything" : src.name });
    pill.setAttr("aria-label", `${SOURCE_LABELS[src.kind]}${src.kind === "all" ? "" : `: ${src.name}`}. Press to change its colour.`);
    const picker = pill.createEl("input", { type: "color", cls: "booker-tl-pill-color" });
    picker.value = color;
    picker.onchange = () => {
      src.color = picker.value;
      this.cfgChanged();
    };
    picker.onclick = (e) => e.stopPropagation();
    pill.onclick = () => {
      try {
        picker.showPicker();
      } catch {
        picker.click();
      }
    };
    const x = pill.createEl("button", { cls: "booker-tl-pill-x", text: "×" });
    x.setAttr("aria-label", "Remove from the map");
    x.onclick = (e) => {
      e.stopPropagation();
      this.cfg.sources = this.cfg.sources.filter((o) => sourceKey(o) !== sourceKey(src));
      this.cfgChanged();
    };
  }

  // ----------------------------------------------------------- sources

  private makeLanes(items: TimelineItem[]): MapLane[] {
    if (this.cfg.sources.length) return buildLanes(items, this.cfg);
    return groupLanes(items, this.groupBy).map((l) => ({ key: l.key, items: l.items, colors: l.items.map((it) => itemColor(it, this.cfg)) }));
  }

  private setCfg(change: Partial<MapConfig>) {
    this.cfg = { ...this.cfg, ...change };
    this.cfgChanged();
  }

  /** Redraw after the sources or colours changed, and save them in the project (System/timeline-map.json). */
  private cfgChanged() {
    this.packCache = null;
    this.buildToolbar();
    this.fit();
    this.render();
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      const proj = this.project();
      if (proj) void writeSystemJson(this.plugin.app, proj, "timeline-map.json", this.cfg);
    }, 400);
  }

  private candidates(): Source[] {
    const proj = this.project();
    if (!proj) return [];
    const known = {
      characters: codexFiles(this.plugin.app, proj, "characters").map((f) => f.basename),
      locations: codexFiles(this.plugin.app, proj, "locations").map((f) => f.basename),
      lives: readLives(this.plugin.app, proj).map((l) => l.name),
    };
    const have = new Set(this.cfg.sources.map(sourceKey));
    return candidateSources(this.items, known).filter((o) => !have.has(sourceKey(o)));
  }

  /** A row of dropdowns above the sources, one for each thing that can be added. */
  private buildAdders(t: HTMLElement) {
    const options = this.candidates();
    const sceneKinds = ["scene", "chapter", "act"];
    const groups: Array<[string, (s: Source) => boolean, (s: Source) => string]> = [
      ["Character", (s) => s.kind === "character", (s) => s.name],
      ["Scene / Chapter", (s) => s.kind === "kind" && sceneKinds.includes(s.name), (s) => ({ scene: "All scenes", chapter: "All chapters", act: "All acts" })[s.name] ?? s.name],
      ["Place", (s) => s.kind === "location", (s) => s.name],
      ["Plotline", (s) => s.kind === "plotline", (s) => s.name],
      ["Life", (s) => s.kind === "life", (s) => s.name],
      ["More", (s) => s.kind === "all" || (s.kind === "kind" && !sceneKinds.includes(s.name)), (s) => (s.kind === "all" ? "Everything" : `All ${s.name}s`)],
    ];
    const row = t.createDiv({ cls: "booker-tl-adders" });
    for (const [label, test, text] of groups) {
      const list = options.filter(test);
      if (!list.length) continue;
      const sel = row.createEl("select", { cls: "dropdown booker-tl-adder" });
      sel.createEl("option", { text: `+${label}`, value: "" });
      list.forEach((o, i) => sel.createEl("option", { text: text(o), value: String(i) }));
      sel.onchange = () => {
        const src = list[Number(sel.value)];
        if (src) this.setCfg({ sources: [...this.cfg.sources, src] });
      };
    }
  }

  private openShow(kinds: string[], ev: MouseEvent) {
    const menu = new Menu();
    for (const k of kinds) {
      menu.addItem((i) =>
        i.setTitle(k).setChecked(!this.cfg.hidden.includes(k)).onClick(() => this.setCfg({ hidden: this.cfg.hidden.includes(k) ? this.cfg.hidden.filter((x) => x !== k) : [...this.cfg.hidden, k] }))
      );
    }
    // drop the menu from the button that opened it
    const r = (ev.currentTarget as HTMLElement | null)?.getBoundingClientRect();
    if (r) menu.showAtPosition({ x: r.left, y: r.bottom + 4 });
    else menu.showAtMouseEvent(ev);
  }

  // ----------------------------------------------------------- viewport

  private plotW() {
    return Math.max(100, this.width - this.labelW);
  }
  private X(t: number) {
    return this.labelW + ((t - this.t0) / (this.t1 - this.t0)) * this.plotW();
  }
  private T(x: number) {
    return this.t0 + ((x - this.labelW) / this.plotW()) * (this.t1 - this.t0);
  }

  private visibleItems(): TimelineItem[] {
    const byAct = (i: TimelineItem) => !this.bookFilter || i.kind !== "scene" || i.book === this.bookFilter;
    // with no sources chosen the map shows scenes and dated notes in the lanes picked above; spans of acts and chapters need a source
    return this.items.filter((i) => byAct(i) && (this.cfg.sources.length > 0 || !i.derived));
  }

  /** What is on screen: the items in the lanes, or all of them when there are no sources. */
  private shownItems(): TimelineItem[] {
    const vis = this.visibleItems();
    if (!this.cfg.sources.length) return vis;
    return [...new Map(buildLanes(vis, this.cfg).flatMap((l) => l.items).map((i) => [i.id, i])).values()];
  }

  private fit() {
    const its = this.shownItems();
    if (!its.length) {
      this.t0 = 0;
      this.t1 = 100;
      this.fitted = true;
      return;
    }
    const lo = Math.min(...its.map((i) => i.start - i.fuzz));
    const closed = its.filter((i) => !i.open);
    const hi = Math.max(...(closed.length ? closed : its).map((i) => i.end + i.fuzz));
    let span = Math.max(hi - lo, MIN_SPAN * 20);
    const margin = span * 0.06;
    this.t0 = lo - margin;
    this.t1 = hi + margin;
    if (this.t1 - this.t0 < MIN_SPAN * 20) this.t1 = this.t0 + MIN_SPAN * 20;
    this.fitted = true;
  }

  private zoomBy(factor: number, anchorX: number) {
    let span = (this.t1 - this.t0) * factor;
    span = Math.min(MAX_SPAN, Math.max(MIN_SPAN, span));
    const sel = this.selected;
    const pivot = this.playhead ?? (sel && Number.isFinite(sel.start) ? (sel.open ? sel.start : (sel.start + sel.end) / 2) : null);
    if (pivot !== null) {
      // the playhead (or else the selected item) is the pivot: it stays put while the rest scales around it, or is centred if it is out of view
      const mid = pivot;
      const inView = mid >= this.t0 && mid <= this.t1;
      const frac = inView ? (mid - this.t0) / (this.t1 - this.t0) : 0.5;
      this.t0 = mid - span * frac;
    } else {
      const anchorT = this.T(this.labelW + anchorX);
      const frac = anchorX / this.plotW();
      this.t0 = anchorT - span * frac;
    }
    this.t1 = this.t0 + span;
    this.schedule();
  }

  /** Put the playhead where the plot was clicked. */
  private placePlayhead(clientX: number) {
    const rect = this.bodySvg.getBoundingClientRect();
    const x = clientX - rect.left;
    if (x < this.labelW) return;
    this.playhead = this.T(x);
    this.render();
  }

  private pan(dx: number) {
    const dt = (dx / this.plotW()) * (this.t1 - this.t0);
    this.t0 += dt;
    this.t1 += dt;
    this.schedule();
  }

  private attachGestures(svg: SVGSVGElement) {
    svg.style.touchAction = "pan-y";
    svg.addEventListener(
      "wheel",
      (e: WheelEvent) => {
        const rect = svg.getBoundingClientRect();
        const x = e.clientX - rect.left - this.labelW;
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          this.zoomBy(Math.exp(e.deltaY * 0.01), Math.max(0, x));
        } else if (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey) {
          e.preventDefault();
          this.pan(e.shiftKey ? e.deltaY : e.deltaX);
        } else if (svg === this.axisSvg) {
          e.preventDefault();
          this.zoomBy(Math.exp(e.deltaY * 0.004), Math.max(0, x));
        }
      },
      { passive: false }
    );
    svg.addEventListener("pointerdown", (e: PointerEvent) => {
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.dragMoved = false;
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      }
    });
    svg.addEventListener("pointermove", (e: PointerEvent) => {
      const prev = this.pointers.get(e.pointerId);
      if (!prev) return;
      const cur = { x: e.clientX, y: e.clientY };
      if (this.pointers.size === 1) {
        const dx = cur.x - prev.x;
        if (Math.abs(dx) > 0) {
          if (Math.abs(dx) > 2 || this.dragMoved) {
            this.dragMoved = true;
            svg.setPointerCapture?.(e.pointerId);
            this.pan(-dx);
          }
        }
      } else if (this.pointers.size === 2) {
        this.pointers.set(e.pointerId, cur);
        const [a, b] = [...this.pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (this.pinchDist > 0 && dist > 0) {
          const rect = svg.getBoundingClientRect();
          const cx = (a.x + b.x) / 2 - rect.left - this.labelW;
          this.zoomBy(this.pinchDist / dist, Math.max(0, cx));
        }
        this.pinchDist = dist;
        this.dragMoved = true;
        return;
      }
      this.pointers.set(e.pointerId, cur);
    });
    const up = (e: PointerEvent) => {
      const clicked = this.pointers.size === 1 && this.pointers.has(e.pointerId) && !this.dragMoved && svg === this.axisSvg;
      if (clicked) this.placePlayhead(e.clientX);
      this.pointers.delete(e.pointerId);
      this.pinchDist = 0;
      if (this.pointers.size === 0) window.setTimeout(() => (this.dragMoved = false), 0);
    };
    svg.addEventListener("pointerup", up);
    svg.addEventListener("pointercancel", up);
  }

  // --------------------------------------------------------- date dragging

  private fmOf(path: string): Record<string, any> | null {
    const f = this.plugin.app.vault.getFileByPath(path);
    const fm = (f && this.plugin.app.metadataCache.getFileCache(f)?.frontmatter) || null;
    if (!fm) return null;
    const [when, end] = splitDate(fm.storyDate ?? fm.story_date);
    return { when, when_end: end };
  }

  /** Snap unit in years for the current zoom: a day, a month or a year (same breakpoints as the axis). */
  private snapUnit(): number {
    const span = this.t1 - this.t0;
    const count = Math.max(3, Math.floor(this.plotW() / 110));
    if (span / count >= 1) return 1;
    if (span > 0.3) return 1 / 12;
    return 1 / 365;
  }

  private compute(mode: DragMode, when: unknown, whenEnd: unknown, dT: number, open: boolean, anchor?: number): WhenPair {
    const r = mode === "move" ? shiftStoryDate(when, whenEnd, dT, anchor) : resizeStoryDate(when, whenEnd, mode, dT, anchor);
    if (open && mode === "move") r.when_end = "";
    return r;
  }

  private describe(r: WhenPair): string {
    const a = parseStoryDate(r.when);
    const b = r.when_end ? parseStoryDate(r.when_end) : null;
    return a ? a.display + (b ? `–${b.display}` : "") : r.when;
  }

  private beginDrag(ev: PointerEvent, it: TimelineItem, grp: SVGGElement) {
    if (ev.button !== undefined && ev.button !== 0) return;
    if (this.pointers.size > 0) return;
    const fm = this.fmOf(it.path);
    if (!fm || fm.when === undefined || fm.when === null || String(fm.when).trim() === "") return;
    ev.stopPropagation();
    const edge = (ev.target as Element).getAttribute?.("data-edge");
    const mode: DragMode = edge === "start" || edge === "end" ? edge : "move";
    const bar = grp.querySelector("rect.bar") as SVGRectElement | null;
    const label = grp.querySelector("text.label") as SVGTextElement | null;
    const d: ItemDrag = {
      it,
      mode,
      grp,
      pointerId: ev.pointerId,
      startX: ev.clientX,
      moved: false,
      dT: 0,
      when: fm.when,
      whenEnd: fm.when_end,
      barX: bar ? Number(bar.getAttribute("x")) : 0,
      barW: bar ? Number(bar.getAttribute("width")) : 0,
      labelX: label ? Number(label.getAttribute("x")) : 0,
    };
    this.drag = d;
    const move = (e: PointerEvent) => {
      if (e.pointerId !== d.pointerId) return;
      const dx = e.clientX - d.startX;
      if (!d.moved && Math.abs(dx) < CLICK_SLOP) return;
      d.moved = true;
      this.dragMoved = true;
      const unit = this.snapUnit();
      const raw = (dx / this.plotW()) * (this.t1 - this.t0);
      d.dT = Math.round(raw / unit) * unit;
      this.updateDragVisual(d);
    };
    const finish = (e: PointerEvent) => {
      if (e.pointerId !== d.pointerId) return;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
      this.drag = null;
      d.shift = e.shiftKey;
      this.hideDragTip();
      window.setTimeout(() => (this.dragMoved = false), 0);
      if (d.moved && d.dT !== 0) void this.commitDrag(d);
      else if (d.moved) this.render();
    };
    const cancel = (e: PointerEvent) => {
      if (e.pointerId !== d.pointerId) return;
      d.moved = false;
      finish(e);
      this.render();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", cancel);
  }

  private updateDragVisual(d: ItemDrag) {
    const r = this.compute(d.mode, d.when, d.whenEnd, d.dT, d.it.open, d.it.anchor);
    const a = parseStoryDate(r.when);
    const b = r.when_end ? parseStoryDate(r.when_end) : a;
    if (!a || !b) return;
    const x0 = this.X(a.start);
    const x1 = d.it.open && d.mode !== "end" ? d.barX + d.barW + (x0 - this.X(d.it.start)) : this.X(Math.max(a.end, b.end));
    const w = Math.max(x1 - x0, 7);
    const bar = d.grp.querySelector("rect.bar");
    bar?.setAttribute("x", String(x0));
    bar?.setAttribute("width", String(w));
    d.grp.querySelector("text.label")?.setAttribute("x", String(x0 + 4));
    d.grp.querySelectorAll(".fuzz, .arrow").forEach((e) => e.remove());
    d.grp.querySelectorAll("rect.handle").forEach((h) => {
      const hw = Number(h.getAttribute("width"));
      h.setAttribute("x", String(h.getAttribute("data-edge") === "start" ? x0 : x0 + w - hw));
    });
    d.grp.addClass("is-dragging");
    this.showDragTip(`${d.it.label}: ${this.describe(r)}`, x0 + w / 2, d.grp);
  }

  private showDragTip(text: string, x: number, grp: SVGGElement) {
    if (!this.dragTip) this.dragTip = this.bodyWrap.createDiv({ cls: "booker-tl-dragtip" });
    this.dragTip.setText(text);
    const wrapRect = this.bodyWrap.getBoundingClientRect();
    const gRect = grp.getBoundingClientRect();
    const left = Math.min(Math.max(x, 60), this.width - 60);
    this.dragTip.style.left = `${left + this.bodyWrap.scrollLeft}px`;
    this.dragTip.style.top = `${gRect.top - wrapRect.top + this.bodyWrap.scrollTop - 26}px`;
  }

  private hideDragTip() {
    this.dragTip?.remove();
    this.dragTip = null;
  }

  /** Write dates for one note; returns the previous values (for undo), or null if nothing changed. */
  private async writeDates(path: string, fn: (when: unknown, whenEnd: unknown) => WhenPair): Promise<SavedDates | null> {
    const f = this.plugin.app.vault.getFileByPath(path);
    if (!f) return null;
    let saved: SavedDates | null = null;
    await this.plugin.app.fileManager.processFrontMatter(f, (fm) => {
      const key = fm.storyDate !== undefined ? "storyDate" : "story_date";
      const [when, end] = splitDate(fm[key]);
      if (!when) return;
      const r = fn(when, end || undefined);
      if (r.when === when && r.when_end === end) return;
      saved = { path, when: fm[key], whenEnd: undefined, hadEnd: false };
      fm[key] = joinDate(r.when, r.when_end);
    });
    return saved;
  }

  /** Lives in a sequence keep their gaps: the lives next to the dragged one follow it. */
  private async moveSequence(it: TimelineItem, mode: DragMode, dT: number, all: boolean): Promise<SavedDates[]> {
    const character = it.seqGroup;
    if (!character) return [];
    const lives: SeqLife[] = [];
    for (const x of this.items) {
      if (x.kind !== it.kind || !(x.seq && x.seq > 0) || x.seqGroup !== character) continue;
      const fm = this.fmOf(x.path);
      if (fm?.when) lives.push({ path: x.path, character, seq: x.seq, when: String(fm.when), whenEnd: String(fm.when_end ?? "") });
    }
    // the dragged life's own dates are already written; read from the pre-drag state
    const seq = sequenceOf(lives, character);
    const out: SavedDates[] = [];
    for (const e of followers(seq, it.path, mode, all)) {
      const life = seq.find((l) => l.path === e.path);
      if (!life) continue;
      const anchor = this.items.find((x) => x.path === e.path)?.anchor;
      const saved = await this.writeDates(e.path, () => applyEdit(life, e, dT, anchor));
      if (saved) out.push(saved);
    }
    return out;
  }

  private async restoreDates(list: SavedDates[]) {
    for (const o of list) {
      const f = this.plugin.app.vault.getFileByPath(o.path);
      if (!f) continue;
      await this.plugin.app.fileManager.processFrontMatter(f, (fm) => {
        fm[fm.storyDate !== undefined ? "storyDate" : "story_date"] = o.when;
      });
    }
    await this.refreshData(false);
  }

  private async commitDrag(d: ItemDrag) {
    const { it, mode, dT } = d;
    const saved: SavedDates[] = [];
    let shown = "";
    try {
      const main = await this.writeDates(it.path, (w, e) => {
        const r = this.compute(mode, w, e, dT, it.open, it.anchor);
        shown = this.describe(r);
        return r;
      });
      if (main) saved.push(main);
      if (main && it.seq !== undefined && it.seq > 0) saved.push(...(await this.moveSequence(it, mode, dT, !!d.shift)));
    } catch (err) {
      new Notice(`Booker: could not save the new dates (${(err as Error).message ?? err}).`);
    }
    if (!saved.length) {
      await this.refreshData(false);
      return;
    }
    const n = new Notice("", 8000);
    const box = n.messageEl ?? (n as any).noticeEl;
    box.empty();
    const extra = saved.length > 1 ? ` (+${saved.length - 1} more ${it.seq !== undefined ? "in the sequence" : saved.length > 2 ? "scenes" : "scene"})` : "";
    box.createSpan({ text: `Moved ${it.label}: ${shown}${extra}. ` });
    const undo = box.createEl("button", { text: "Undo", cls: "mod-cta" });
    undo.onclick = () => {
      undo.disabled = true;
      void this.restoreDates(saved).then(() => n.hide());
    };
    await this.refreshData(false);
  }

  // ---------------------------------------------------------- rendering

  private schedule() {
    if (this.raf) return;
    this.raf = window.requestAnimationFrame(() => {
      this.raf = 0;
      this.render();
    });
  }

  private laneKey(): string {
    return [this.groupBy, this.cfg.sources.map(sourceKey).join(","), this.cfg.merge, this.items.length, this.bookFilter, this.laneFilter, (this.t1 - this.t0).toPrecision(6), this.width].join("|");
  }

  private render() {
    try {
      this.renderInner();
    } catch (e) {
      console.error("Booker timeline", e);
      try {
        this.info.empty();
        this.info.createSpan({ cls: "booker-muted", text: `Booker could not draw this tab: ${e instanceof Error ? e.message : String(e)} ` });
        this.info.createEl("button", { cls: "booker-btn mod-cta", text: "Retry" }).onclick = () => this.render();
      } catch (e2) {
        console.error("Booker timeline", e2);
      }
    }
  }

  private renderInner() {
    if (!this.bodySvg) return;
    this.measure();
    const W = this.width;
    this.axisSvg.setAttribute("viewBox", `0 0 ${W} 34`);
    this.axisSvg.setAttribute("width", String(W));
    this.axisSvg.setAttribute("height", "34");
    this.axisSvg.empty();

    // axis
    const ticks = makeTicks(this.t0, this.t1, Math.max(3, Math.floor(this.plotW() / 110)));
    s(this.axisSvg, "rect", { x: 0, y: 0, width: W, height: 34, class: "booker-tl-axisbg" });
    for (const tk of ticks) {
      const x = this.X(tk.t);
      s(this.axisSvg, "line", { x1: x, x2: x, y1: 20, y2: 34, class: tk.major ? "booker-tl-tick major" : "booker-tl-tick" });
      s(this.axisSvg, "text", { x: x + 3, y: 14, class: "booker-tl-ticklabel" }, tk.label);
    }
    s(this.axisSvg, "rect", { x: 0, y: 0, width: this.labelW, height: 34, class: "booker-tl-axisbg" });
    s(this.axisSvg, "text", { x: 8, y: 20, class: "booker-tl-ticklabel" }, formatSpan(this.t1 - this.t0));

    // body
    const items = this.visibleItems();
    this.lanes = this.makeLanes(items).filter((l) => !this.laneFilter || l.key.toLowerCase().includes(this.laneFilter));

    const key = this.laneKey();
    if (!this.packCache || this.packCache.key !== key) {
      const rows = new Map<string, number[]>();
      for (const lane of this.lanes) {
        const boxes = lane.items.map((it) => {
          const x0 = this.X(it.start);
          const x1 = it.seq !== undefined && it.open ? 1e9 : Math.max(this.X(it.end), x0 + 7);
          return { x0, x1 };
        });
        // a character's lives share one row at the top of the lane, scenes and events pack below it
        const lifeAt = lane.items.map((it, i) => (it.seq !== undefined ? i : -1)).filter((i) => i >= 0);
        const restAt = lane.items.map((it, i) => (it.seq !== undefined ? -1 : i)).filter((i) => i >= 0);
        const out: number[] = new Array(lane.items.length).fill(0);
        const lr = lifeAt.map(() => 0);
        const used = lr.length ? 1 : 0;
        lifeAt.forEach((i, n) => (out[i] = lr[n]));
        const rr = packRows(restAt.map((i) => boxes[i]), 3);
        restAt.forEach((i, n) => (out[i] = used + rr[n]));
        rows.set(lane.key, out);
      }
      this.packCache = { key, rows };
    }

    this.bodySvg.empty();
    let y = 0;
    const clipId = "nvl-clip";
    const defs = s(this.bodySvg, "defs");
    const clip = s(defs, "clipPath", { id: clipId });
    s(clip, "rect", { x: this.labelW, y: 0, width: this.plotW(), height: 100000 });

    const laneLayouts: { lane: MapLane; y: number; h: number; rows: number[] }[] = [];
    for (const lane of this.lanes) {
      const rows = this.packCache.rows.get(lane.key) ?? [];
      const nRows = Math.min(MAX_ROWS, (rows.length ? Math.max(...rows) : 0) + 1);
      const h = nRows * ROW_H + LANE_PAD * 2;
      laneLayouts.push({ lane, y, h, rows });
      y += h;
    }
    const total = Math.max(y, 60);
    this.bodySvg.setAttribute("viewBox", `0 0 ${W} ${total}`);
    this.bodySvg.setAttribute("width", String(W));
    this.bodySvg.setAttribute("height", String(total));

    // lane backgrounds + gridlines
    laneLayouts.forEach((L, i) => s(this.bodySvg, "rect", { x: 0, y: L.y, width: W, height: L.h, class: "booker-tl-lane" + (i % 2 ? " alt" : "") }));
    const grid = s(this.bodySvg, "g", { class: "booker-tl-grid", "clip-path": `url(#${clipId})` });
    for (const tk of ticks) {
      const x = this.X(tk.t);
      s(grid, "line", { x1: x, x2: x, y1: 0, y2: total, class: tk.major ? "booker-tl-gridline major" : "booker-tl-gridline" });
    }

    const maxEnd = items.length ? Math.max(...items.map((i) => i.end)) : this.t1;
    const g = s(this.bodySvg, "g", { "clip-path": `url(#${clipId})` });
    let hidden = 0;
    for (const L of laneLayouts) {
      L.lane.items.forEach((it, idx) => {
        const row = L.rows[idx] ?? 0;
        if (row >= MAX_ROWS) {
          hidden++;
          return;
        }
        const end = it.open ? Math.max(it.end, maxEnd) : it.end;
        const x0 = this.X(it.start);
        const x1 = this.X(end);
        if (x1 < this.labelW - 2 || x0 > W + 2) return;
        const w = Math.max(x1 - x0, 7);
        const yy = L.y + LANE_PAD + row * ROW_H + (ROW_H - BAR_H) / 2;
        const thin = !!it.derived;
        const h = thin ? 8 : it.seq !== undefined ? 16 : BAR_H;
        const y0 = thin ? yy + (BAR_H - h) / 2 : yy;
        const free = it.seq !== undefined && !(it.seq && it.seq > 0);
        const grp = s(g, "g", { class: `booker-tl-item ${it.kind}` + (free ? " is-free" : "") + (this.selected?.id === it.id ? " is-selected" : "") });
        if (it.fuzz > 0) {
          const fx0 = this.X(it.start - it.fuzz);
          const fx1 = this.X(end + it.fuzz);
          s(grp, "rect", { x: fx0, y: y0, width: Math.max(fx1 - fx0, w), height: h, rx: 3, class: "fuzz" });
        }
        const r = s(grp, "rect", { x: x0, y: y0, width: w, height: h, rx: 3, class: "bar" });
        const col = L.lane.colors[idx];
        if (!free && col && /^(#[0-9a-f]{3,8}|[a-z]{3,20}|(rgb|hsl)a?\([0-9 ,.%/]{3,40}\)|var\(--[a-z0-9-]{1,40}\))$/i.test(col.trim())) r.style.fill = col.trim();
        if (it.open) s(grp, "path", { d: `M${x0 + w - 2},${y0} l8,${h / 2} l-8,${h / 2}z`, class: "arrow" });
        if (w > 36 && !thin) {
          const label = s(grp, "text", { x: x0 + 4, y: y0 + h - 4.5, class: "label" }, it.label);
          // crude clipping by approximate char width
          const maxChars = Math.floor((w - 8) / 6.2);
          if (it.label.length > maxChars) label.textContent = maxChars > 2 ? it.label.slice(0, maxChars - 1) + "…" : "";
        }
        const title = s(grp, "title", {}, `${it.label}${it.detail ? `\n${it.detail}` : ""}\n${free ? "life, not in a sequence" : it.kind}`);
        void title;
        grp.addEventListener("click", (ev) => {
          if (this.dragMoved) return;
          ev.stopPropagation();
          this.playhead = it.open ? it.start : (it.start + it.end) / 2;
          this.select(it);
        });
        grp.addEventListener("dblclick", () => this.openPath(it.path));
        if (!it.derived) {
          grp.style.touchAction = "none";
          grp.addClass("is-draggable");
          if (Number.isFinite(it.start) && it.end - it.start > 1 / 400) {
            const hw = Math.min(Platform.isMobile ? 16 : 8, w / 3);
            s(grp, "rect", { x: x0, y: y0, width: hw, height: h, class: "handle", "data-edge": "start" });
            if (!it.open) s(grp, "rect", { x: x0 + w - hw, y: y0, width: hw, height: h, class: "handle", "data-edge": "end" });
          }
          grp.addEventListener("pointerdown", (ev: PointerEvent) => this.beginDrag(ev, it, grp));
        }
      });
    }

    // the playhead
    if (this.playhead !== null) {
      const px = this.X(this.playhead);
      if (px >= this.labelW && px <= W) {
        const g = s(this.bodySvg, "g", { class: "booker-tl-playhead", "clip-path": `url(#${clipId})` });
        s(g, "line", { x1: px, x2: px, y1: 0, y2: total });
        const flag = s(this.axisSvg, "g", { class: "booker-tl-playflag" });
        s(flag, "path", { d: `M${px - 7},22 h14 v6 l-7,6 l-7,-6z` });
        s(flag, "title", {}, "Playhead: zooming pivots here. Click to remove.");
        flag.addEventListener("pointerdown", (e) => e.stopPropagation());
        flag.addEventListener("click", () => {
          this.playhead = null;
          this.render();
        });
      }
    }

    // lane labels (drawn on top, with opaque background)
    for (const L of laneLayouts) {
      s(this.bodySvg, "rect", { x: 0, y: L.y, width: this.labelW, height: L.h, class: "booker-tl-labelbg" });
      if (L.lane.source?.color) s(this.bodySvg, "circle", { cx: 12, cy: L.y + LANE_PAD + 10, r: 5, fill: L.lane.source.color });
      const t = s(this.bodySvg, "text", { x: L.lane.source?.color ? 22 : 8, y: L.y + LANE_PAD + 14, class: "booker-tl-lanelabel" }, L.lane.key);
      const maxChars = Math.floor((this.labelW - 14) / 6.6);
      if (L.lane.key.length > maxChars) t.textContent = L.lane.key.slice(0, maxChars - 1) + "…";
      s(this.bodySvg, "title", {}, L.lane.key);
      s(this.bodySvg, "line", { x1: 0, x2: W, y1: L.y + L.h, y2: L.y + L.h, class: "booker-tl-laneline" });
    }
    s(this.bodySvg, "line", { x1: this.labelW, x2: this.labelW, y1: 0, y2: total, class: "booker-tl-laneline" });

    if (!this.lanes.some((l) => l.items.length)) {
      const msg = this.items.length === 0 ? "Nothing to show yet. Give scenes, lives or events a story date (in the Inspector or on the timeline cards), written like 2031-04-02, 4/2/2031, Oct 2 2031 or 1850." : this.cfg.sources.length ? "Nothing connected to your sources has a date yet." : "Everything is filtered out.";
      s(this.bodySvg, "text", { x: this.labelW + 16, y: 32, class: "booker-tl-empty" }, msg);
    }
    this.renderInfo(hidden);
  }

  private select(it: TimelineItem) {
    this.selected = it;
    this.render();
  }

  private openPath(path: string) {
    const f = this.plugin.app.vault.getFileByPath(path);
    if (f) void openNoteIn(this.plugin, f, this.leaf);
  }

  private renderInfo(hidden: number) {
    this.info.empty();
    const it = this.selected;
    if (!it) {
      const hint = Platform.isMobile ? "Drag to pan. Pinch to zoom. Tap a bar for details." : "Drag to pan. Ctrl/⌘ + scroll to zoom. Click a bar for details, double-click to open.";
      this.info.createSpan({ cls: "booker-muted", text: hint });
      if (hidden) this.info.createSpan({ cls: "booker-muted", text: `  ${hidden} items hidden: zoom in to see them.` });
      return;
    }
    this.info.createEl("strong", { text: it.label });
    this.info.createSpan({
      cls: "booker-muted",
      text: `  ${it.kind}${it.detail ? ` · ${it.detail}` : ""} · ${formatTime(it.start, 1 / 365)}${it.end - it.start > 1 / 300 ? " → " + (it.open ? "ongoing" : formatTime(it.end, 1 / 365)) : ""}`,
    });
    const infoActs = actionRow(this.info);
    actionBtn(infoActs, "Open note", "file-text", () => this.openPath(it.path), { cta: true });
    actionBtn(infoActs, "Close", "x", () => {
      this.selected = null;
      this.render();
    });
    if (hidden) this.info.createSpan({ cls: "booker-muted", text: `  ${hidden} hidden` });
  }
}

type DragMode = "move" | "start" | "end";

interface ItemDrag {
  it: TimelineItem;
  mode: DragMode;
  grp: SVGGElement;
  pointerId: number;
  startX: number;
  moved: boolean;
  /** snapped change in years */
  dT: number;
  when: unknown;
  whenEnd: unknown;
  barX: number;
  barW: number;
  labelX: number;
  /** shift was held when the drag ended */
  shift?: boolean;
}

interface SavedDates {
  path: string;
  when: unknown;
  whenEnd: unknown;
  hadEnd: boolean;
}

function formatSpan(years: number): string {
  if (years >= 1_000_000) return `${(years / 1_000_000).toFixed(1)}M yrs`;
  if (years >= 10_000) return `${Math.round(years / 1000)}k yrs`;
  if (years >= 2) return `${Math.round(years).toLocaleString()} yrs`;
  if (years >= 1 / 12) return `${(years * 12).toFixed(1)} mo`;
  return `${Math.max(1, Math.round(years * 365))} days`;
}

function joinDate(when: string, end: string): string {
  return end ? `${when}..${end}` : when;
}
