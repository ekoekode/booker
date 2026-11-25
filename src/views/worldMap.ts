import { ItemView, Menu, Notice, TFile, WorkspaceLeaf, debounce, setIcon } from "obsidian";
import type BookerPlugin from "../main";
import { formatTime } from "../dates";
import { formatCoords } from "../project/geo";
import { describeXY, type XY } from "../project/mapCoords";
import { buildPins, dateExtent, emptyFilter, facets, filterPins, type MapFilter, type MapPin, type PinRecord } from "../project/mapData";
import { gatherPinRecords } from "../project/mapPins";
import { chooseRenderer, parseRenderer, whyCompatible, type WebGLProbe } from "../project/mapRenderer";
import { mapById, mapChoices, resolveMap, WORLD_ID, parseMaps, type MapsConfig } from "../project/mapsConfig";
import { loadMapImage, readMaps, setPosition, writeMaps } from "../project/mapsStore";
import { clampCentre, fanLayout } from "../project/mapFan";
import { groupByScreen } from "../project/mapGroups";
import { codexFiles, createCodex, findProjects, readScopeScenes, readSystemJson, writeSystemJson, type Project } from "../project/vaultOps";
import { ConfirmModal, NamePrompt } from "../ui";
import { openNoteIn } from "../openTarget";
import { DARK, LIGHT, parseBasemap, type Basemap, type MapController, type MapSpec } from "./mapTypes";
import { MapsPanel } from "./mapsPanel";
import { openFilters } from "./mapFilters";
import { probeWebGL } from "./webglProbe";

export const VIEW_WORLD_MAP = "booker-world-map";

const BASEMAP_10M = "basemap/natural-earth-10m.json.gz";
const BASEMAP_50M = "basemap/natural-earth-50m.json.gz";
/** colours for the kinds, handed out in the order the kinds are first seen so they stay put while the filters change */
const KIND_COLORS = ["#534ab7", "#d85a30", "#1d9e75", "#378add", "#d4537e", "#ba7517", "#639922", "#7f77dd", "#a32d2d", "#5f5e5a"];
const STEPS = 1000;

const basemaps = new Map<string, Promise<Basemap | null>>();

interface MapCfg {
  hidden: string[];
  undated: boolean;
  /** chapter positions set by hand: chapter key, then map id, then [x, y] */
  chapterPos?: Record<string, Record<string, [number, number]>>;
}

/** Ask every open Map tab to reread its maps (after the Maps settings changed them). */
export function refreshMapViews(app: BookerPlugin["app"]) {
  for (const leaf of app.workspace.getLeavesOfType(VIEW_WORLD_MAP)) void (leaf.view as WorldMapView).reloadConfig?.();
}

/** The Map tab: everything with a position on a map (the real world or a drawn one), narrowed by a story-date window and by type, character, plotline and book. */
export class WorldMapView extends ItemView {
  private projectPath: string | null = null;
  private range: "book" | "series" = "book";
  private mapId: string | null = null;
  /** pick mode: the next click on the map sets this note's position on the current map */
  private pick: { path: string } | null = null;
  private records: PinRecord[] = [];
  private pins: MapPin[] = [];
  private maps: MapsConfig = parseMaps(null);
  private filter: MapFilter = emptyFilter();
  private cfgLoaded = false;
  private chapterPos: Record<string, Record<string, [number, number]>> = {};
  private saveTimer = 0;
  private extent: [number, number] | null = null;
  /** the slider's two handles, 0 to STEPS */
  private lo = 0;
  private hi = STEPS;
  private windowOn = false;
  private playTimer = 0;
  private kindColor = new Map<string, string>();
  /** the first fit happens once the pane has a size (a tab opened in the background has none) */
  private fitPending = true;
  /** the map on screen and the blob URL of its picture */
  /** undefined: nothing is on screen yet; null: the "no map" message is */
  private mountedId: string | null | undefined = undefined;
  private imageUrl: string | null = null;
  private forceCompatible = false;
  /** a pin lifted for editing: where it has been dragged to so far, and the timer that sets it down */
  private editing: { pin: MapPin; pos: XY | null; timer: number } | null = null;

  /** top-left capsule: map picker, search, filters */
  private bar!: HTMLElement;
  /** the time dock along the bottom */
  private sliderRow!: HTMLElement;
  /** the pane itself: the map fills it edge to edge and the controls float over it */
  private mapWrap!: HTMLElement;
  private mapEl!: HTMLElement;
  private tip!: HTMLElement;
  /** "5 on the map" */
  private note!: HTMLElement;
  private readout!: HTMLElement;
  private banner!: HTMLElement;
  private controls!: HTMLElement;
  private card!: HTMLElement;
  private panelHost!: HTMLElement;
  private panel: MapsPanel | null = null;
  private closeFilters: (() => void) | null = null;
  /** the pin that is selected (ringed, with its card) */
  private selected: MapPin | null = null;
  private idleTimer = 0;
  /** pins fanned out round a spot, so each can be picked */
  private fan: { el: HTMLElement; pins: MapPin[] } | null = null;
  private fanGrace = 0;
  /** Maps settings asked for in the state before the view was ready ('' = just open it) */
  private pendingSettings: string | null = null;
  private ctl: MapController | null = null;
  private reload = debounce(() => void this.refreshData(false), 700, true);

  constructor(leaf: WorkspaceLeaf, private plugin: BookerPlugin) {
    super(leaf);
  }

  getViewType() {
    return VIEW_WORLD_MAP;
  }
  getDisplayText() {
    return "Map";
  }
  getIcon() {
    return "map";
  }

  getState() {
    return { project: this.projectPath, scope: this.range, map: this.mapId };
  }
  async setState(state: any, result: any) {
    if (state?.project) this.projectPath = state.project;
    if (state?.scope === "book" || state?.scope === "series") this.range = state.scope;
    if (typeof state?.map === "string") this.mapId = state.map;
    // a pick request comes in the state and is used once
    this.pick = typeof state?.pick === "string" && state.pick ? { path: state.pick } : null;
    await super.setState(state, result);
    // the Maps settings panel is asked for in the state (from the command, the Location box, Settings)
    if (typeof state?.settings === "string") this.pendingSettings = state.settings;
    if (this.bar) await this.refreshData(true);
    if (this.bar && this.pendingSettings !== null) {
      this.openSettings(this.pendingSettings || undefined);
      this.pendingSettings = null;
    }
  }

  async onOpen() {
    const root = this.contentEl;
    root.empty();
    root.addClass("booker-map");
    // the map fills the pane; everything else floats over it
    this.mapWrap = root;
    this.mapEl = root.createDiv({ cls: "booker-map-canvas" });
    const chrome = root.createDiv({ cls: "bm-chrome" });
    this.bar = chrome.createDiv({ cls: "bm-topleft bm-glass bm-cap" });
    this.controls = chrome.createDiv({ cls: "bm-controls bm-glass bm-vert" });
    this.card = chrome.createDiv({ cls: "bm-card bm-glass is-hidden" });
    this.banner = chrome.createDiv({ cls: "bm-banner bm-glass bm-cap is-hidden" });
    this.sliderRow = chrome.createDiv({ cls: "bm-dock bm-glass is-hidden" });
    this.note = chrome.createDiv({ cls: "bm-count bm-glass bm-pill is-hidden" });
    this.readout = chrome.createDiv({ cls: "bm-readout bm-glass bm-pill is-hidden" });
    this.tip = chrome.createDiv({ cls: "booker-map-tip is-hidden" });
    this.panelHost = chrome.createDiv({ cls: "bm-panel bm-glass is-hidden" });
    // chrome that has not been touched for a while rests at lower strength; any movement over the map brings it back
    const wake = () => {
      root.removeClass("is-idle");
      window.clearTimeout(this.idleTimer);
      this.idleTimer = window.setTimeout(() => root.addClass("is-idle"), 4000);
    };
    this.registerDomEvent(root, "pointermove", wake);
    this.registerDomEvent(root, "pointerdown", wake);
    wake();
    this.buildControls();

    const ro = new ResizeObserver(() => {
      root.toggleClass("is-narrow", root.clientWidth > 0 && root.clientWidth < 520);
      this.ctl?.resize();
      this.applyInset();
      if (this.fitPending && this.mapWrap.clientWidth > 0 && this.mapWrap.clientHeight > 0 && this.pins.length) {
        this.fitPending = false;
        this.ctl?.fit(this.visible(), false);
      }
    });
    ro.observe(this.mapWrap);
    this.register(() => ro.disconnect());
    this.registerDomEvent(document, "keydown", (ev) => {
      if (ev.key !== "Escape") return;
      if (this.fan) this.closeFan();
      else if (this.editing) void this.finishEdit(false);
    });
    this.registerEvent(this.app.workspace.on("css-change", () => this.ctl?.setPalette(this.palette())));
    this.registerEvent(this.app.metadataCache.on("changed", (f) => (f.path.includes("/Scenes/") || f.path.includes("/Codex/")) && this.reload()));
    await this.refreshData(true);
    if (this.pendingSettings !== null) {
      this.openSettings(this.pendingSettings || undefined);
      this.pendingSettings = null;
    }
  }

  async onClose() {
    window.clearInterval(this.playTimer);
    window.clearTimeout(this.saveTimer);
    window.clearTimeout(this.idleTimer);
    window.clearTimeout(this.regroupTimer);
    this.closeFilters?.();
    void this.panel?.destroy();
    this.panel = null;
    this.unmount();
  }

  private palette() {
    return document.body.hasClass("theme-dark") ? DARK : LIGHT;
  }

  /** Read once per session: what this computer's WebGL is like. */
  private probe: WebGLProbe | null = null;
  private async webgl(): Promise<WebGLProbe> {
    if (!this.probe) this.probe = probeWebGL();
    return this.probe;
  }

  private loadBasemap(file: string): Promise<Basemap | null> {
    let p = basemaps.get(file);
    if (!p) {
      p = (async () => {
        try {
          const path = `${this.plugin.manifest.dir ?? `${this.app.vault.configDir}/plugins/booker`}/${file}`;
          if (!(await this.app.vault.adapter.exists(path))) return null;
          return await parseBasemap(await this.app.vault.adapter.readBinary(path));
        } catch (e) {
          console.error("Booker map: could not read the basemap", e);
          return null;
        }
      })();
      basemaps.set(file, p);
    }
    return p;
  }

  private project(): Project | null {
    const all = findProjects(this.app);
    return all.find((p) => p.file.path === this.projectPath) ?? all[0] ?? null;
  }

  /** Reread maps.json (the Maps settings changed it) and redraw. */
  async reloadConfig() {
    const proj = this.project();
    if (!proj) return;
    this.maps = await readMaps(this.app, proj);
    this.mountedId = undefined;
    await this.refreshData(true);
  }

  /** Redraws run one after another: opening the tab asks for two at once, and a map must not be built twice. */
  private chain: Promise<void> = Promise.resolve();
  private refreshData(fit: boolean): Promise<void> {
    const run = this.chain.then(() => this.refreshInner(fit));
    this.chain = run.catch(() => undefined);
    return run;
  }

  private async refreshInner(fit: boolean) {
    try {
      const proj = this.project();
      if (!proj) {
        this.records = [];
        this.pins = [];
        this.draw(false);
        return;
      }
      if (!this.cfgLoaded) {
        const c = (await readSystemJson(this.app, proj, "map.json")) as Partial<MapCfg> | null;
        this.filter.hidden = new Set(Array.isArray(c?.hidden) ? c!.hidden!.map(String) : []);
        this.filter.undated = c?.undated !== false;
        this.chapterPos = {};
        for (const [k, byMap] of Object.entries(c?.chapterPos ?? {}))
          for (const [m, v] of Object.entries(byMap ?? {})) if (Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === "number" && Number.isFinite(n))) (this.chapterPos[k] ??= {})[m] = [v[0], v[1]];
        this.maps = await readMaps(this.app, proj);
        this.cfgLoaded = true;
      }
      const scope = proj.series ? this.range : "book";
      this.records = gatherPinRecords(this.app, proj, await readScopeScenes(this.app, proj, scope));
      const id = resolveMap(this.maps, this.mapId);
      if (id !== this.mapId) this.mapId = id;
      if (id !== this.mountedId) {
        fit = true;
        await this.mount(id);
      }
      this.pins = id ? buildPins(this.records, id, this.chapterOverrides(id)) : [];
      for (const k of facets(this.pins).kinds.map(([n]) => n)) if (!this.kindColor.has(k)) this.kindColor.set(k, KIND_COLORS[this.kindColor.size % KIND_COLORS.length]);
      this.extent = dateExtent(this.pins);
      this.draw(fit);
    } catch (e) {
      console.error("Booker map", e);
      this.note.setText(`Booker could not draw the map: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // ---------------------------------------------------------------- the map on screen

  private unmount() {
    this.closeFan(false);
    if (this.editing) window.clearTimeout(this.editing.timer);
    this.editing = null;
    this.ctl?.destroy();
    this.ctl = null;
    if (this.imageUrl) URL.revokeObjectURL(this.imageUrl);
    this.imageUrl = null;
    this.mountedId = undefined;
  }

  /** The floating message at the top: what is happening, and optionally a Cancel for it. */
  private say(text: string, cancel?: () => void) {
    this.banner.empty();
    if (!text) return void this.banner.addClass("is-hidden");
    this.banner.removeClass("is-hidden");
    this.banner.createSpan({ cls: "bm-banner-text", text });
    if (cancel) {
      const b = this.banner.createEl("button", { cls: "bm-btn bm-banner-cancel", text: "Cancel" });
      b.onclick = cancel;
    }
  }

  /** Put the chosen map on screen with the right engine. */
  private async mount(id: string | null) {
    this.unmount();
    this.mapEl.remove();
    this.mapEl = this.mapWrap.createDiv({ cls: "booker-map-canvas" });
    this.mapWrap.prepend(this.mapEl);
    this.fitPending = true;
    this.mountedId = id;
    this.readout.addClass("is-hidden");
    const handlers = {
      // a single click selects (ring and card), a double click opens the note and a right click offers Move or Open
      click: (pin: MapPin) => {
        // a grey badge with a number stands for several pins close together: click it to fan them out
        if (pin.members) {
          const c = this.ctl?.toScreen(pin.x, pin.y);
          if (c) this.openFan(pin.members, c.x, c.y);
          return;
        }
        this.selectPin(pin);
      },
      settled: () => this.regroup(),
      blank: () => {
        this.closeFan();
        this.selectPin(null);
      },
      stack: (pins: MapPin[], x: number, y: number) => this.openFan(pins, x, y),
      mapMenu: (p: XY, x: number, y: number) => this.mapMenu(p, x, y),
      // the map was dragged or zoomed: a fan drawn over it would be in the wrong place (a moment's grace after it opens)
      moving: () => {
        if (Date.now() > this.fanGrace) this.closeFan(false);
      },
      open: (pin: MapPin) => void this.openPin(pin),
      menu: (pin: MapPin, x: number, y: number) => this.pinMenu(pin, x, y),
      hover: (pin: MapPin | null, x: number, y: number) => this.showTip(pin, x, y),
      pointer: (p: XY | null) => this.showReadout(p),
      pick: (p: XY) => void this.picked(p),
      edit: (pin: MapPin) => void this.onEdit(pin),
      moved: (pin: MapPin, p: XY) => this.onMoved(pin, p),
    };
    if (!id) {
      const empty = this.mapEl.createDiv({ cls: "bm-empty bm-glass" });
      empty.createDiv({ cls: "bm-empty-title", text: "No map to show" });
      empty.createDiv({ cls: "bm-empty-text", text: "The real world is switched off and no drawn map has been added." });
      const b = empty.createEl("button", { cls: "bp-button is-cta", text: "Add a map" });
      b.onclick = () => this.openSettings();
      return;
    }
    const mapMod = id === WORLD_ID ? null : mapById(this.maps, id);
    const pickedFile = this.pick ? this.app.vault.getAbstractFileByPath(this.pick.path) : null;
    const ok = this.pick ? `Click the map to place ${pickedFile instanceof TFile ? pickedFile.basename : "it"}.` : "";
    let notice = ok;
    try {
      if (mapMod) {
        this.imageUrl = await loadMapImage(this.app, mapMod);
        if (mapMod.image && !this.imageUrl) notice = `The picture ${mapMod.image.path} was not found. Open Maps settings to choose it again.`;
        const spec: MapSpec = { kind: "flat", map: mapMod, imageUrl: this.imageUrl };
        this.ctl = (await import("./mapLeaflet")).createLeaflet(this.mapEl, spec, this.palette(), handlers);
        this.ctl.setGrid(mapMod.grid);
      } else {
        const w = this.maps.realWorld;
        const setting = parseRenderer(this.plugin.settings.mapRenderer);
        const probe = await this.webgl();
        const choice = this.forceCompatible ? "compatible" : chooseRenderer(setting, probe);
        if (choice === "webgl") {
          const eng = await import("./mapEngine");
          const base = await this.loadBasemap(BASEMAP_10M);
          this.ctl = eng.createMap(this.mapEl, base, w, this.palette(), handlers, {
            onFailure: () => {
              this.forceCompatible = true;
              new Notice("Booker: the WebGL map failed, so the compatible map is shown. You can change this in Maps settings.");
              this.mountedId = undefined;
              void this.refreshData(true);
            },
          });
        } else {
          const base = (await this.loadBasemap(BASEMAP_50M)) ?? (await this.loadBasemap(BASEMAP_10M));
          this.ctl = (await import("./mapLeaflet")).createLeaflet(this.mapEl, { kind: "world", basemap: base, world: w }, this.palette(), handlers);
          notice = [whyCompatible(setting, probe, this.forceCompatible), notice].filter(Boolean).join(" ");
        }
        this.ctl.setGrid(w.grid);
      }
    } catch (e) {
      console.error("Booker map", e);
      notice = `The map could not start: ${e instanceof Error ? e.message : String(e)}`;
    }
    this.ctl?.setPick(!!this.pick);
    this.say(notice, this.pick ? () => this.cancelPick() : undefined);
    this.applyInset();
  }

  private cancelPick() {
    this.pick = null;
    this.ctl?.setPick(false);
    this.say("");
    this.app.workspace.requestSaveLayout();
  }

  private showReadout(p: XY | null) {
    if (!p) return void this.readout.addClass("is-hidden");
    const id = this.mapId;
    const text = id === WORLD_ID || !id ? formatCoords({ lat: p.y, lng: p.x }, 3) : describeXY(mapById(this.maps, id)!.coords, p);
    this.readout.setText(text);
    this.readout.removeClass("is-hidden");
  }

  private async picked(p: XY) {
    const pick = this.pick;
    const id = this.mapId;
    if (!pick || !id) return;
    const f = this.app.vault.getAbstractFileByPath(pick.path);
    if (!(f instanceof TFile)) return;
    const proj = this.project();
    try {
      const run = () => setPosition(this.app, f, id, p, { decimals: id === WORLD_ID ? 5 : mapById(this.maps, id)!.coords.decimals + 2 });
      if (proj) await this.plugin.undoable("Place on map", proj, [f.path], run);
      else await run();
      const shown = id === WORLD_ID ? formatCoords({ lat: p.y, lng: p.x }, 4) : describeXY(mapById(this.maps, id)!.coords, p);
      new Notice(`Placed ${f.basename} at ${shown}.`);
    } catch (e) {
      new Notice(`Booker could not place it: ${e instanceof Error ? e.message : String(e)}`);
    }
    this.pick = null;
    this.ctl?.setPick(false);
    this.say("");
    this.app.workspace.requestSaveLayout();
    await this.refreshData(false);
  }

  // ---------------------------------------------------------------- editing a pin's position

  /** Seconds of no dragging after which an edited pin is set down by itself. */
  private static readonly EDIT_IDLE_MS = 10_000;

  private armEdit() {
    const e = this.editing;
    if (!e) return;
    window.clearTimeout(e.timer);
    e.timer = window.setTimeout(() => void this.finishEdit(true), WorldMapView.EDIT_IDLE_MS);
  }

  // ---------------------------------------------------------------- stacked pins and new places

  /** Pins on top of each other fly out round their spot, so each can be selected, opened or moved. */
  private openFan(pins: MapPin[], x: number, y: number) {
    if (this.pick) return;
    this.closeFan(false);
    const list = [...pins].sort((a, b) => (a.start ?? Infinity) - (b.start ?? Infinity) || a.label.localeCompare(b.label)).slice(0, 48);
    const layout = fanLayout(list.length, 34, 44);
    const root = this.mapWrap.getBoundingClientRect();
    const rect = (e: HTMLElement) => (e.hasClass("is-hidden") ? null : e.getBoundingClientRect());
    const tl = rect(this.bar);
    const dock = rect(this.sliderRow);
    const c = clampCentre(x, y, layout.radius, root.width, root.height, 8, tl ? tl.bottom - root.top : 0, dock ? root.bottom - dock.top : 0);
    const el = this.mapWrap.querySelector<HTMLElement>(".bm-chrome")!.createDiv({ cls: "bm-fan", attr: { role: "group", "aria-label": `${list.length} items at this spot` } });
    el.style.left = `${c.x}px`;
    el.style.top = `${c.y}px`;
    el.createDiv({ cls: "bm-fan-ring" }).style.setProperty("--r", `${layout.radius}px`);
    const hub = el.createEl("button", { cls: "bm-fan-hub", text: String(list.length), attr: { "aria-label": "Close" } });
    hub.onclick = (ev) => {
      ev.stopPropagation();
      this.closeFan();
    };
    list.forEach((pin, i) => {
      const slot = layout.slots[i];
      const b = el.createEl("button", { cls: "bm-fan-dot", attr: { "aria-label": `${pin.label}, ${pin.kind}` } });
      b.style.setProperty("--c", this.colorOf(pin));
      b.style.setProperty("--dx", `${slot.dx}px`);
      b.style.setProperty("--dy", `${slot.dy}px`);
      b.style.setProperty("--i", String(i));
      b.toggleClass("is-selected", this.selected?.id === pin.id);
      b.onclick = (ev) => {
        ev.stopPropagation();
        this.selectPin(pin);
        el.querySelectorAll(".bm-fan-dot").forEach((d) => d.removeClass("is-selected"));
        b.addClass("is-selected");
      };
      b.ondblclick = (ev) => {
        ev.stopPropagation();
        void this.openPin(pin);
      };
      b.oncontextmenu = (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        this.pinMenu(pin, ev.clientX, ev.clientY);
      };
      b.onmouseenter = () => this.showTip(pin, c.x + slot.dx + 18, c.y + slot.dy - 10);
      b.onmouseleave = () => this.showTip(null, 0, 0);
    });
    this.fan = { el, pins: list };
    this.fanGrace = Date.now() + 700;
    // two frames, so the dots start at the centre and then fly out
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => el.addClass("is-open")));
  }

  private closeFan(animated = true) {
    const f = this.fan;
    if (!f) return;
    this.fan = null;
    this.tip.addClass("is-hidden");
    if (!animated) return void f.el.remove();
    f.el.removeClass("is-open");
    window.setTimeout(() => f.el.remove(), 280);
  }

  /** Right click on empty map: make a new place here, or copy the position. */
  private mapMenu(p: XY, x: number, y: number) {
    if (this.pick || !this.mapId) return;
    this.closeFan(false);
    const id = this.mapId;
    const text = id === WORLD_ID ? formatCoords({ lat: p.y, lng: p.x }, 5) : describeXY(mapById(this.maps, id)!.coords, p);
    const menu = new Menu();
    menu.addItem((i) => i.setTitle("New place here…").setIcon("map-pin").onClick(() => this.newPlaceHere(p)));
    menu.addItem((i) =>
      i.setTitle("Copy position").setIcon("copy").onClick(() => {
        void navigator.clipboard?.writeText(text);
        new Notice(`Copied ${text}.`);
      }),
    );
    menu.showAtPosition({ x, y });
  }

  /** Name a spot on the map: it becomes a Codex place (a note you can use as a scene's Place) positioned here. */
  private newPlaceHere(p: XY) {
    const proj = this.project();
    const id = this.mapId;
    if (!proj || !id) return;
    const mapName = id === WORLD_ID ? "the real world" : mapById(this.maps, id)?.name ?? "this map";
    const decimals = id === WORLD_ID ? 5 : mapById(this.maps, id)!.coords.decimals + 2;
    const where = id === WORLD_ID ? formatCoords({ lat: p.y, lng: p.x }, 4) : describeXY(mapById(this.maps, id)!.coords, p);
    const sameName = (a: string, b: string) => a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();
    const placeAt = async (file: TFile, created: boolean) => {
      const run = async () => {
        await setPosition(this.app, file, id, p, { decimals });
        return file;
      };
      const f = await this.plugin.undoable(created ? "New place" : "Move place", proj, created ? [] : [file.path], run);
      await new Promise((r) => window.setTimeout(r, 500));
      await this.refreshData(false);
      const pin = this.pins.find((x) => x.path === f.path && x.kind === "location");
      if (pin) this.selectPin(pin);
    };
    new NamePrompt(
      this.app,
      "New place here",
      `On ${mapName}, at ${where}. It becomes a place in your Codex: type its name as a scene's Place and the scene sits here.`,
      async (name) => {
        const clean = name.trim();
        const existing = codexFiles(this.app, proj, "locations").find((f) => sameName(f.basename, clean) || sameName(String(this.app.metadataCache.getFileCache(f)?.frontmatter?.name ?? ""), clean));
        if (existing) {
          new ConfirmModal(this.app, `“${existing.basename}” already exists`, `Move it to this spot on ${mapName}?`, "Move it here", () => void placeAt(existing, false)).open();
          return;
        }
        try {
          const file = await createCodex(this.app, proj, "location", clean);
          await placeAt(file, true);
        } catch (e) {
          new Notice(`Booker could not make the place: ${e instanceof Error ? e.message : String(e)}`);
        }
      },
    ).open();
  }

  /** Right click on a pin: Move or Open (or, on the pin being moved, set it down, put it back or open). */
  private pinMenu(pin: MapPin, x: number, y: number) {
    if (this.pick) return;
    const menu = new Menu();
    if (this.editing?.pin.id === pin.id) {
      menu.addItem((i) => i.setTitle("Set down here").setIcon("check").onClick(() => void this.finishEdit(true)));
      menu.addItem((i) => i.setTitle("Put back").setIcon("undo").onClick(() => void this.finishEdit(false)));
    } else {
      menu.addItem((i) => i.setTitle("Move").setIcon("move").onClick(() => void this.onEdit(pin)));
      // a chapter moved by hand stays there until it is reset to the centre of its scenes
      if (pin.source === "chapterSet" && pin.chapterKey && this.mapId)
        menu.addItem((i) => i.setTitle("Reset to the centre of its scenes").setIcon("rotate-ccw").onClick(() => void this.setChapterPosition(pin.chapterKey!, this.mapId!, null, "Reset chapter pin").then(() => this.refreshData(false))));
    }
    menu.addItem((i) => i.setTitle(pin.kind === "chapter" ? "Open its first scene" : "Open item").setIcon("file-text").onClick(() => void this.openPin(pin)));
    menu.showAtPosition({ x, y });
  }

  /** Lift a pin for dragging (from the Move menu item). On the pin being edited it sets it down (double click). */
  private async onEdit(pin: MapPin) {
    if (this.pick || !this.mapId) return;
    if (this.editing?.pin.id === pin.id) return void (await this.finishEdit(true));
    if (this.editing) await this.finishEdit(true);
    // Move from a fanned-out pin: the fan folds away and that pin is the live one, lifted where the pin is
    this.closeFan(false);
    this.editing = { pin, pos: null, timer: 0 };
    this.ctl?.beginEdit(pin, this.colorOf(pin));
    this.applyPins();
    this.armEdit();
    const inherited = pin.kind === "chapter" ? " A chapter sits at the centre of its scenes until you move it; then it stays where you put it, until you reset it (right-click)." : pin.source === "place" ? ` It takes its position from ${pin.placeName ?? "its place"}; moving it gives ${pin.label} a position of its own.` : "";
    this.say(`Drag it to move it. Double-click it, or wait ten seconds, to set it down. Esc puts it back.${inherited}`, () => void this.finishEdit(false));
  }

  private onMoved(pin: MapPin, p: XY) {
    if (this.editing?.pin.id !== pin.id) return;
    // a pin only gets a position of its own when it was really moved: a nudge of a few pixels is a click, not a move
    const a = this.ctl?.toScreen(pin.x, pin.y);
    const b = this.ctl?.toScreen(p.x, p.y);
    this.editing.pos = a && b && Math.hypot(a.x - b.x, a.y - b.y) < 4 ? null : p;
    this.armEdit();
  }

  /** Set the edited pin down (animated) and save where it ended up, or put it back (`save` false). */
  private async finishEdit(save: boolean) {
    const e = this.editing;
    if (!e) return;
    window.clearTimeout(e.timer);
    this.editing = null;
    this.say("");
    const id = this.mapId;
    const moved = save && !!e.pos && !!id;
    await this.ctl?.endEdit();
    // put the pin back on the map straight away, where it now is, so it does not vanish until the notes are read again
    if (moved) {
      const there = (p: MapPin): MapPin => (p.id === e.pin.id ? { ...p, x: e.pos!.x, y: e.pos!.y, source: e.pin.chapterKey ? "chapterSet" : "own" } : p);
      this.pins = this.pins.map(there);
      this.shownPins = this.shownPins.map(there);
    }
    this.applyPins();
    const f = this.app.vault.getAbstractFileByPath(e.pin.path);
    let waitFor: TFile | null = null;
    if (moved && id && e.pin.chapterKey) {
      try {
        await this.setChapterPosition(e.pin.chapterKey, id, e.pos!, "Move chapter pin");
      } catch (err) {
        new Notice(`Booker could not move it: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else if (moved && id && f instanceof TFile) {
      const proj = this.project();
      const decimals = id === WORLD_ID ? 5 : mapById(this.maps, id)!.coords.decimals + 2;
      try {
        const run = () => setPosition(this.app, f, id, e.pos!, { decimals });
        if (proj) await this.plugin.undoable("Move pin", proj, [f.path], run);
        else await run();
        waitFor = f;
      } catch (err) {
        new Notice(`Booker could not move it: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    // Obsidian reads the changed note a moment after it is written; redrawing before then would put the pin back where it was
    if (waitFor) await this.noteRead(waitFor);
    await this.refreshData(false);
  }

  /** Resolve once Obsidian has read a note again after a change (or after two seconds). */
  private noteRead(file: TFile): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        this.app.metadataCache.offref(ref);
        window.clearTimeout(t);
        resolve();
      };
      const ref = this.app.metadataCache.on("changed", (f) => f.path === file.path && done());
      const t = window.setTimeout(done, 2000);
    });
  }

  /** Slide the Maps settings panel in over the map. */
  private openSettings(start?: string) {
    const proj = this.project();
    if (!proj) return;
    if (this.panel) return void this.panel.select(start ?? this.mapId ?? WORLD_ID);
    this.panelHost.removeClass("is-hidden");
    this.mapWrap.addClass("has-panel");
    window.requestAnimationFrame(() => this.panelHost.addClass("is-open"));
    this.panel = new MapsPanel({
      plugin: this.plugin,
      proj,
      host: this.panelHost,
      start: start ?? this.mapId ?? undefined,
      close: () => this.closeSettings(),
      grid: (id, g) => {
        if (id === this.mapId) this.ctl?.setGrid(g);
      },
      changed: () => this.panelChanged(),
    });
    void this.panel.open().then(() => this.applyInset());
    window.setTimeout(() => this.applyInset(), 260);
  }

  private closeSettings() {
    const p = this.panel;
    this.panel = null;
    this.panelHost.removeClass("is-open");
    this.mapWrap.removeClass("has-panel");
    window.setTimeout(() => {
      if (this.panel) return;
      this.panelHost.addClass("is-hidden");
      this.panelHost.empty();
      this.applyInset();
    }, 240);
    void p?.destroy();
  }

  /** The panel wrote maps.json: reread it and redraw (the grid already repainted by itself). */
  private panelChanged = debounce(() => void this.reloadConfig(), 300, true);

  /** The chapters whose position was set by hand on this map. */
  private chapterOverrides(mapId: string): Map<string, XY> {
    const out = new Map<string, XY>();
    for (const [k, byMap] of Object.entries(this.chapterPos)) {
      const v = byMap[mapId];
      if (v) out.set(k, { x: v[0], y: v[1] });
    }
    return out;
  }

  private mapCfgJson(): MapCfg {
    return { hidden: [...this.filter.hidden], undated: this.filter.undated, chapterPos: this.chapterPos };
  }

  /** Store (or, with null, forget) a chapter's position on a map. Saved at once, as one undoable step. */
  private async setChapterPosition(key: string, mapId: string, p: XY | null, label: string) {
    const proj = this.project();
    if (!proj) return;
    const run = async () => {
      const byMap = (this.chapterPos[key] ??= {});
      if (p) byMap[mapId] = [p.x, p.y];
      else delete byMap[mapId];
      if (!Object.keys(byMap).length) delete this.chapterPos[key];
      await writeSystemJson(this.app, proj, "map.json", this.mapCfgJson());
    };
    await this.plugin.undoable(label, proj, [`${proj.layout.system}/map.json`], run);
  }

  private colorOf = (p: MapPin): string => p.color || this.kindColor.get(p.kind) || KIND_COLORS[0];

  /** The window in story time the slider is set to, or null for all of time. */
  private window(): [number, number] | null {
    if (!this.extent || !this.windowOn) return null;
    const [a, b] = this.extent;
    const at = (v: number) => (b > a ? a + ((b - a) * v) / STEPS : a);
    return [at(this.lo), at(this.hi)];
  }

  private visible(): MapPin[] {
    return filterPins(this.pins, { ...this.filter, range: this.window() });
  }

  /** What is on the map now (after the filters), before pins close together are gathered into badges. */
  private shownPins: MapPin[] = [];
  private regroupTimer = 0;

  /** Pins close together on screen become one grey badge with their number; the rest stay as they are. */
  private applyPins(shown: MapPin[] = this.shownPins) {
    this.shownPins = shown;
    const ctl = this.ctl;
    if (!ctl) return;
    const editId = this.editing?.pin.id;
    const { singles, groups } = groupByScreen(
      shown.filter((p) => p.id !== editId),
      (p) => ctl.toScreen(p.x, p.y),
      14,
    );
    const badges: MapPin[] = groups.map((g) => {
      const starts = g.members.map((m) => m.start).filter((n): n is number => n !== null);
      const ends = g.members.map((m) => m.end).filter((n): n is number => n !== null);
      const ordered = [...g.members].sort((a, b) => (a.start ?? Infinity) - (b.start ?? Infinity) || a.label.localeCompare(b.label));
      return {
        id: `group:${ordered[0].id}+${ordered.length}`,
        path: ordered[0].path,
        kind: "group",
        label: `${ordered.length} here`,
        x: g.x,
        y: g.y,
        source: "own",
        start: starts.length ? Math.min(...starts) : null,
        end: ends.length ? Math.max(...ends) : null,
        characters: [],
        plotlines: [],
        book: "",
        members: ordered,
      };
    });
    ctl.setPins([...singles, ...badges], this.colorOf);
  }

  /** The map stopped moving: gather and spread pins for the new zoom (not while a fan is open, which would be pulled apart). */
  private regroup() {
    window.clearTimeout(this.regroupTimer);
    this.regroupTimer = window.setTimeout(() => {
      if (!this.fan) this.applyPins();
    }, 120);
  }

  private draw(fit: boolean) {
    this.buildBar();
    this.buildSlider();
    const shown = this.visible();
    this.applyPins(shown);
    if (this.selected && !this.pins.some((p) => p.id === this.selected!.id)) this.selectPin(null);
    this.applyInset();
    if (fit) {
      if (this.mapWrap.clientWidth > 0 && this.mapWrap.clientHeight > 0) {
        this.fitPending = false;
        this.ctl?.fit(shown, false);
      } else this.fitPending = true;
    }
    this.updateNote(shown);
  }

  private updateNote(shown: MapPin[]) {
    const total = this.pins.length;
    if (!this.mapId) return void this.note.addClass("is-hidden");
    this.note.removeClass("is-hidden");
    if (!total) {
      const where = this.mapId === WORLD_ID ? "the real world" : mapById(this.maps, this.mapId)?.name ?? "this map";
      this.note.setText(`Nothing on ${where} yet. Place a note from its Location box.`);
      return;
    }
    this.note.setText(shown.length === total ? `${total} on the map` : `${shown.length} of ${total} on the map`);
  }

  private showTip(pin: MapPin | null, x: number, y: number) {
    if (!pin) return void this.tip.addClass("is-hidden");
    this.tip.empty();
    this.tip.createDiv({ cls: "booker-map-tip-title", text: pin.members ? `${pin.members.length} items here` : pin.label });
    if (pin.members) {
      const kinds = new Map<string, number>();
      for (const m of pin.members) kinds.set(m.kind, (kinds.get(m.kind) ?? 0) + 1);
      this.tip.createDiv({ cls: "booker-muted", text: [...kinds.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} ${k}`).join(", ") + ". Click to spread them out." });
      this.tip.style.left = `${Math.min(x + 12, Math.max(0, this.mapWrap.clientWidth - 220))}px`;
      this.tip.style.top = `${y + 12}px`;
      this.tip.removeClass("is-hidden");
      return;
    }
    const meta = [pin.kind, pin.display, pin.placeName && pin.source === "place" ? `at ${pin.placeName}` : ""].filter(Boolean).join(" · ");
    this.tip.createDiv({ cls: "booker-muted", text: meta });
    this.tip.style.left = `${Math.min(x + 12, Math.max(0, this.mapWrap.clientWidth - 220))}px`;
    this.tip.style.top = `${y + 12}px`;
    this.tip.removeClass("is-hidden");
  }

  private async openPin(pin: MapPin) {
    const f = this.app.vault.getAbstractFileByPath(pin.path);
    if (f instanceof TFile) await openNoteIn(this.plugin, f, this.leaf);
  }

  // ---------------------------------------------------------------- floating controls

  private save() {
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      const proj = this.project();
      if (proj) void writeSystemJson(this.app, proj, "map.json", this.mapCfgJson());
    }, 600);
  }

  /** Keep maps.json in step with a change made here (the open map, a quick grid toggle). */
  private saveMaps() {
    const proj = this.project();
    if (proj) void writeMaps(this.app, proj, this.maps);
  }

  /** Tell the map how much of its edges the floating controls cover, so Fit and fly-to frame things inside what you can see. */
  private applyInset() {
    if (!this.ctl || !this.mapWrap) return;
    const r = this.mapWrap.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const rect = (e: HTMLElement) => (e.hasClass("is-hidden") ? null : e.getBoundingClientRect());
    const tl = rect(this.bar);
    const dock = rect(this.sliderRow);
    const ctrls = rect(this.controls);
    const panel = rect(this.panelHost);
    this.ctl.setInset({
      top: tl ? Math.max(0, tl.bottom - r.top + 4) : 0,
      left: 0,
      bottom: dock ? Math.max(0, r.bottom - dock.top + 4) : 36,
      right: panel ? Math.max(0, r.right - panel.left + 4) : ctrls ? Math.max(0, r.right - ctrls.left + 4) : 0,
    });
  }

  private iconButton(parent: HTMLElement, name: string, label: string, onClick: (e: MouseEvent) => void, cls = "bm-btn bm-icon"): HTMLButtonElement {
    const b = parent.createEl("button", { cls, attr: { "aria-label": label, title: label } });
    setIcon(b, name);
    b.onclick = onClick;
    return b;
  }

  /** The current grid of the map on screen. */
  private currentGrid() {
    return this.mapId === WORLD_ID ? this.maps.realWorld.grid : this.mapId ? mapById(this.maps, this.mapId)?.grid : undefined;
  }

  /** Top right: zoom, fit, grid and settings. */
  private buildControls() {
    const c = this.controls;
    c.empty();
    this.iconButton(c, "plus", "Zoom in", () => this.ctl?.zoomBy(1));
    this.iconButton(c, "minus", "Zoom out", () => this.ctl?.zoomBy(-1));
    c.createDiv({ cls: "bm-hr" });
    this.iconButton(c, "locate-fixed", "Fit everything shown", () => {
      this.applyInset();
      this.ctl?.fit(this.visible(), true);
    });
    const grid = this.iconButton(c, "layout-grid", "Show or hide the grid", () => {
      const g = this.currentGrid();
      if (!g) return;
      g.show = !g.show;
      grid.toggleClass("is-on", g.show);
      grid.setAttr("aria-pressed", String(g.show));
      this.ctl?.setGrid(g);
      this.saveMaps();
    });
    grid.addClass("bm-grid-btn");
    this.iconButton(c, "settings", "Maps settings", () => (this.panel ? this.closeSettings() : this.openSettings()));
  }

  private syncGridButton() {
    const b = this.controls.querySelector<HTMLElement>(".bm-grid-btn");
    const g = this.currentGrid();
    if (!b) return;
    b.toggleClass("is-on", !!g?.show);
    b.setAttr("aria-pressed", String(!!g?.show));
    b.toggleClass("is-hidden", !g);
  }

  /** Top left: the map picker, the search box and the filters. */
  private buildBar() {
    const bar = this.bar;
    bar.empty();
    this.syncGridButton();
    bar.toggleClass("is-hidden", false);

    const choices = mapChoices(this.maps);
    const cur = choices.find((c) => c.id === this.mapId);
    const picker = bar.createEl("button", { cls: "bm-btn bm-picker", attr: { "aria-label": "Choose a map" } });
    setIcon(picker.createSpan({ cls: "bm-ico" }), "map");
    picker.createSpan({ cls: "bm-picker-name", text: cur?.name ?? "Map" });
    if (choices.length > 1) setIcon(picker.createSpan({ cls: "bm-chev" }), "chevron-down");
    picker.onclick = (e) => {
      if (choices.length < 2) return this.openSettings();
      const m = new Menu();
      for (const c of choices)
        m.addItem((i) =>
          i.setTitle(c.name).setChecked(c.id === this.mapId).onClick(() => {
            this.mapId = c.id;
            this.maps.last = c.id;
            this.saveMaps();
            this.panel?.select(c.id);
            this.app.workspace.requestSaveLayout();
            void this.refreshData(true);
          }),
        );
      m.showAtMouseEvent(e);
    };

    bar.createSpan({ cls: "bm-sep" });
    const box = bar.createDiv({ cls: "bm-searchbox" });
    setIcon(box.createSpan({ cls: "bm-ico" }), "search");
    const f = box.createEl("input", { cls: "bm-search", attr: { type: "search", placeholder: "Search", "aria-label": "Search the map" } });
    f.value = this.filter.text;
    f.oninput = () => {
      this.filter.text = f.value;
      this.refilter();
    };

    const active = this.filter.hidden.size + this.filter.characters.length + this.filter.plotlines.length + this.filter.books.length + (this.filter.undated ? 0 : 1);
    const fb = bar.createEl("button", { cls: "bm-btn bm-filters", attr: { "aria-label": "Filters", "aria-expanded": String(!!this.closeFilters) } });
    setIcon(fb.createSpan({ cls: "bm-ico" }), "sliders-horizontal");
    fb.createSpan({ cls: "bm-filters-label", text: "Filters" });
    if (active) fb.createSpan({ cls: "bm-badge", text: String(active) });
    fb.toggleClass("is-on", !!this.closeFilters);
    fb.onclick = () => {
      if (this.closeFilters) {
        this.closeFilters();
        return;
      }
      const fc = facets(this.pins);
      this.closeFilters = openFilters(
        this.mapWrap,
        fb,
        {
          filter: this.filter,
          kinds: fc.kinds,
          characters: fc.characters,
          plotlines: fc.plotlines,
          books: fc.books,
          colorOf: (k) => this.kindColor.get(k) ?? KIND_COLORS[0],
          series: !!this.project()?.series,
          scope: this.range,
          changed: () => {
            this.refilter();
            this.refreshBadge();
          },
          remember: () => this.save(),
          setScope: (r) => {
            this.range = r;
            this.filter.books = [];
            this.app.workspace.requestSaveLayout();
            void this.refreshData(true);
          },
        },
        () => {
          this.closeFilters = null;
          fb.toggleClass("is-on", false);
          fb.setAttr("aria-expanded", "false");
        },
      );
      fb.toggleClass("is-on", true);
      fb.setAttr("aria-expanded", "true");
    };
  }

  /** Update the count on the Filters button without rebuilding the bar (the sheet may be open). */
  private refreshBadge() {
    const fb = this.bar.querySelector(".bm-filters");
    if (!fb) return;
    fb.querySelector(".bm-badge")?.remove();
    const n = this.filter.hidden.size + this.filter.characters.length + this.filter.plotlines.length + this.filter.books.length + (this.filter.undated ? 0 : 1);
    if (n) fb.createSpan({ cls: "bm-badge", text: String(n) });
  }

  // ---------------------------------------------------------------- selection card

  /** Select a pin (a ring on the map and a card with what it is), or nothing. A click never opens the note: double click does. */
  private selectPin(pin: MapPin | null) {
    this.selected = pin;
    this.ctl?.select(pin?.id ?? null);
    const c = this.card;
    c.empty();
    if (!pin) return void c.addClass("is-hidden");
    c.removeClass("is-hidden");
    const head = c.createDiv({ cls: "bm-card-head" });
    head.createSpan({ cls: "bm-dot" }).style.background = this.colorOf(pin);
    head.createSpan({ cls: "bm-card-title", text: pin.label });
    this.iconButton(head, "x", "Close", () => this.selectPin(null), "bm-btn bm-icon bm-card-x");
    const id = this.mapId;
    const where = pin.source === "place" && pin.placeName ? `at ${pin.placeName}` : pin.source === "chapter" ? "centre of its scenes" : pin.source === "chapterSet" ? "set by hand" : "";
    c.createDiv({ cls: "bm-card-meta", text: [pin.kind, pin.display, where].filter(Boolean).join(" · ") });
    const pos = id === WORLD_ID || !id ? formatCoords({ lat: pin.y, lng: pin.x }, 3) : describeXY(mapById(this.maps, id)!.coords, pin);
    c.createDiv({ cls: "bm-card-meta", text: pos });
    const row = c.createDiv({ cls: "bm-card-actions" });
    const open = row.createEl("button", { cls: "bp-button is-cta", text: pin.kind === "chapter" ? "Open first scene" : "Open" });
    open.onclick = () => void this.openPin(pin);
    const move = row.createEl("button", { cls: "bp-button", text: "Move" });
    move.onclick = () => void this.onEdit(pin);
    if (pin.source === "chapterSet" && pin.chapterKey && id) {
      const reset = row.createEl("button", { cls: "bp-button", text: "Reset" });
      reset.title = "Back to the centre of its scenes";
      reset.onclick = () => void this.setChapterPosition(pin.chapterKey!, id, null, "Reset chapter pin").then(() => this.refreshData(false));
    }
  }

  /** Re-apply the filters without rebuilding the bar (so a search box keeps focus while typing). */
  private refilter() {
    const shown = this.visible();
    this.applyPins(shown);
    this.updateNote(shown);
  }

  // ---------------------------------------------------------------- time dock

  private buildSlider() {
    const row = this.sliderRow;
    row.empty();
    if (!this.extent || this.extent[0] === this.extent[1]) {
      row.addClass("is-hidden");
      return;
    }
    row.removeClass("is-hidden");
    const [a, b] = this.extent;
    const res = Math.max(1 / 365, (b - a) / 40);
    const label = (v: number) => formatTime(a + ((b - a) * v) / STEPS, res);

    const play = row.createEl("button", { cls: "bm-btn bm-icon", attr: { "aria-label": "Play through story time", title: "Play through story time" } });
    const from = row.createSpan({ cls: "booker-map-date" });
    const track = row.createDiv({ cls: "booker-map-track" });
    const lo = track.createEl("input", { attr: { type: "range", min: "0", max: String(STEPS), step: "1", "aria-label": "Window start" } });
    const hi = track.createEl("input", { attr: { type: "range", min: "0", max: String(STEPS), step: "1", "aria-label": "Window end" } });
    const to = row.createSpan({ cls: "booker-map-date is-end" });
    lo.value = String(this.lo);
    hi.value = String(this.hi);
    const reset = row.createEl("button", { cls: "bm-btn bm-text", text: "All time" });

    const paint = () => {
      from.setText(label(this.lo));
      to.setText(label(this.hi));
      track.toggleClass("is-off", !this.windowOn);
      reset.toggleClass("is-on", !this.windowOn);
      lo.value = String(this.lo);
      hi.value = String(this.hi);
      setIcon(play, this.playTimer ? "pause" : "play");
    };
    const apply = () => {
      paint();
      this.refilter();
    };
    const stop = () => {
      window.clearInterval(this.playTimer);
      this.playTimer = 0;
    };
    lo.oninput = () => {
      this.windowOn = true;
      this.lo = Math.min(Number(lo.value), this.hi);
      apply();
    };
    hi.oninput = () => {
      this.windowOn = true;
      this.hi = Math.max(Number(hi.value), this.lo);
      apply();
    };
    reset.onclick = () => {
      stop();
      this.windowOn = false;
      this.lo = 0;
      this.hi = STEPS;
      apply();
    };
    play.onclick = () => {
      if (this.playTimer) {
        stop();
        return paint();
      }
      // slide a window the size of the current one (or a tenth of time when it is wide open) from its start to the end
      this.windowOn = true;
      let width = this.hi - this.lo;
      if (width >= STEPS * 0.9) {
        width = Math.round(STEPS / 10);
        this.lo = 0;
        this.hi = width;
      }
      this.playTimer = window.setInterval(() => {
        if (this.hi >= STEPS) {
          stop();
          return paint();
        }
        const step = Math.max(2, Math.round(width / 12));
        this.lo = Math.min(STEPS - width, this.lo + step);
        this.hi = Math.min(STEPS, this.lo + width);
        apply();
      }, 350);
      apply();
    };
    paint();
  }
}
