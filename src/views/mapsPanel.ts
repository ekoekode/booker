import { FuzzySuggestModal, Menu, Notice, TFile, type App } from "obsidian";
import type BookerPlugin from "../main";
import { COORD_PRESETS, DEFAULT_COORDS, describeXY, normaliseCoords, withPosition, type CoordSystem } from "../project/mapCoords";
import { normaliseGrid, gridLines, type GridSettings } from "../project/mapGrid";
import { RENDERER_SETTINGS, parseRenderer, probeText, type RendererSetting } from "../project/mapRenderer";
import { mapById, newMap, parseMaps, uniqueId, WORLD_ID, type CustomMap, type MapsConfig } from "../project/mapsConfig";
import { countPlaced, importMapImage, IMAGE_EXTENSIONS, isMapImage, linkMapImage, loadMapImage, MAPS_FILE, readMaps, writeMaps } from "../project/mapsStore";
import type { Project } from "../project/vaultOps";
import { pickFiles } from "../scripture/store";
import { ConfirmModal, notifyError } from "../ui";
import { buttonRow, colorRow, footnote, group, pairRow, row, segmented, selectRow, sliderRow, textRow, toggleRow } from "./prefsUi";
import { probeWebGL } from "./webglProbe";
import { toFraction } from "../project/mapCoords";

const ADD = "__add";

/** A search-as-you-type list of the pictures in the vault. */
class ImagePicker extends FuzzySuggestModal<TFile> {
  constructor(app: App, private onChoose: (f: TFile) => void) {
    super(app);
    this.setPlaceholder("Choose a picture from the vault");
  }
  getItems(): TFile[] {
    return this.app.vault.getFiles().filter((f) => isMapImage(f.path));
  }
  getItemText(f: TFile): string {
    return f.path;
  }
  onChooseItem(f: TFile): void {
    this.onChoose(f);
  }
}

export interface PanelOptions {
  plugin: BookerPlugin;
  proj: Project;
  host: HTMLElement;
  start?: string;
  /** Done was pressed */
  close(): void;
  /** the grid of a map changed: repaint it now */
  grid(mapId: string, g: GridSettings): void;
  /** maps.json was written: the Map tab should reread it */
  changed(): void;
}

const sizeText = (m: CustomMap): string => (m.image && m.image.width ? `${m.image.width} × ${m.image.height} pixels` : "size unknown");

/**
 * The maps settings, as a panel that sits over the Map tab: a switcher of maps at the top and the chosen map's settings as inset grouped
 * lists, then the display engine for this computer and the checks. Changes are saved as you make them and shown on the map at once.
 */
export class MapsPanel {
  private cfg: MapsConfig = parseMaps(null);
  private selected: string;
  private saveTimer = 0;
  private head!: HTMLElement;
  private seg!: HTMLElement;
  private body!: HTMLElement;
  private saved!: HTMLElement;
  private placed = new Map<string, number>();
  private orphans: Array<{ file: TFile; mapIds: string[] }> = [];
  private thumb: string | null = null;

  constructor(private o: PanelOptions) {
    this.selected = o.start ?? WORLD_ID;
  }

  private get app() {
    return this.o.plugin.app;
  }

  async open() {
    const root = this.o.host;
    root.empty();
    root.addClass("bp-panel");
    this.head = root.createDiv({ cls: "bp-head" });
    this.head.createSpan({ cls: "bp-head-title", text: "Maps" });
    this.saved = this.head.createSpan({ cls: "bp-saved" });
    const done = this.head.createEl("button", { cls: "bp-done", text: "Done" });
    done.onclick = () => this.o.close();
    this.seg = root.createDiv({ cls: "bp-switcher" });
    this.body = root.createDiv({ cls: "bp-body" });
    try {
      this.cfg = await readMaps(this.app, this.o.proj);
    } catch (e) {
      notifyError(e, "read the maps");
    }
    if (this.selected !== WORLD_ID && !mapById(this.cfg, this.selected)) this.selected = WORLD_ID;
    this.recount();
    this.drawAll();
  }

  /** Write a pending change now and let go of everything. */
  async destroy() {
    if (this.thumb) URL.revokeObjectURL(this.thumb);
    if (this.saveTimer) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = 0;
      await writeMaps(this.app, this.o.proj, this.cfg).catch(() => undefined);
      this.o.changed();
    }
  }

  /** Move to another map (from the Map tab's picker, say). */
  select(id: string) {
    if (id !== WORLD_ID && !mapById(this.cfg, id)) return;
    this.selected = id;
    this.drawAll();
  }

  // ---------------------------------------------------------------- saving

  private path() {
    return `${this.o.proj.layout.system}/${MAPS_FILE}`;
  }

  private mark(text: string) {
    this.saved.setText(text);
    this.saved.toggleClass("is-shown", !!text);
  }

  /** A change worth undoing (adding, deleting, a new picture): written now, with an Undo link. */
  private async commit(label: string, extra: string[] = []) {
    try {
      await this.o.plugin.undoable(label, this.o.proj, [this.path(), ...extra], () => writeMaps(this.app, this.o.proj, this.cfg));
      this.o.changed();
      this.mark("Saved");
    } catch (e) {
      notifyError(e, "save the maps");
    }
  }

  /** A small change while typing: written a moment later. */
  private later() {
    this.mark("Saving…");
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = 0;
      writeMaps(this.app, this.o.proj, this.cfg)
        .then(() => {
          this.o.changed();
          this.mark("Saved");
        })
        .catch((e) => notifyError(e, "save the maps"));
    }, 400);
  }

  private recount() {
    const r = countPlaced(this.app, this.o.proj, this.cfg);
    this.placed = r.byMap;
    this.orphans = r.orphans;
  }

  // ---------------------------------------------------------------- drawing

  private drawAll() {
    this.drawSwitcher();
    this.drawBody();
  }

  private drawSwitcher() {
    this.seg.empty();
    const items = [
      { id: WORLD_ID, label: "Real world", meta: this.cfg.realWorld.enabled ? String(this.placed.get(WORLD_ID) ?? 0) : "off", off: !this.cfg.realWorld.enabled },
      ...this.cfg.maps.map((m) => ({ id: m.id, label: m.name, meta: String(this.placed.get(m.id) ?? 0) })),
      { id: ADD, label: "+ New map" },
    ];
    segmented(
      this.seg,
      items,
      this.selected,
      (id) => {
        if (id === ADD) return this.addMap();
        this.selected = id;
        this.drawAll();
      },
      (id, ev) => {
        const m = mapById(this.cfg, id);
        if (!m) return;
        const menu = new Menu();
        menu.addItem((i) => i.setTitle("Move left").setIcon("arrow-left").onClick(() => this.move(m, -1)));
        menu.addItem((i) => i.setTitle("Move right").setIcon("arrow-right").onClick(() => this.move(m, 1)));
        menu.addItem((i) => i.setTitle("Duplicate").setIcon("copy").onClick(() => this.duplicate(m)));
        menu.addItem((i) => i.setTitle("Delete…").setIcon("trash").onClick(() => this.remove(m)));
        menu.showAtMouseEvent(ev);
      },
    );
  }

  private drawBody() {
    const b = this.body;
    b.empty();
    if (this.selected === WORLD_ID) this.drawWorld(b);
    else {
      const m = mapById(this.cfg, this.selected);
      if (m) this.drawMap(b, m);
    }
    this.drawEngine(b);
    this.drawChecks(b);
  }

  /** The grid section, shared by the real world and drawn maps; changes repaint the map at once. */
  private gridGroup(parent: HTMLElement, mapId: string, grid: GridSettings, world: boolean) {
    const g = group(parent, "Grid");
    const live = () => {
      this.o.grid(mapId, grid);
      this.later();
    };
    toggleRow(g, "Show the grid", grid.show, (v) => {
      grid.show = v;
      live();
    }, world ? "Lines of latitude and longitude." : "Lines at round values in this map's units.");
    textRow(g, "Spacing", grid.major === "auto" ? "" : String(grid.major), (v) => {
      const n = Number(v.trim().replace(",", "."));
      grid.major = v.trim() === "" ? "auto" : Number.isFinite(n) && n > 0 ? n : grid.major;
      live();
      return grid.major === "auto" ? "" : String(grid.major);
    }, { placeholder: "Auto", desc: world ? "In degrees. Empty follows the zoom." : "Empty follows the zoom.", width: 70 });
    textRow(g, "Lines between", String(grid.minor), (v) => {
      grid.minor = normaliseGrid({ minor: Number(v) }, grid).minor;
      live();
      return String(grid.minor);
    }, { desc: "Thin lines between two main lines (0 for none).", width: 70 });
    colorRow(g, "Colour", grid.color, (v) => {
      grid.color = v;
      live();
    });
    sliderRow(g, "Strength", 0.1, 1, 0.05, grid.opacity, (v) => {
      grid.opacity = v;
      live();
    });
    toggleRow(g, "Numbers on the grid", grid.labels, (v) => {
      grid.labels = v;
      live();
    });
  }

  private drawWorld(parent: HTMLElement) {
    const w = this.cfg.realWorld;
    parent.createEl("h3", { cls: "bp-title-lg", text: "Real world" });
    const top = group(parent);
    toggleRow(top, "Use the real-world map", w.enabled, (v) => {
      w.enabled = v;
      void this.commit(v ? "Turn on the real-world map" : "Turn off the real-world map");
      this.recount();
      this.drawAll();
    }, "Switch off for a story set only in invented worlds. The world map, the city and zip lookup and the latitude and longitude on notes are hidden; what is saved on your notes is kept.");
    if (!w.enabled) return;
    const layers = group(parent, "What it shows");
    for (const [key, name] of [["borders", "Country borders"], ["states", "State and province borders"], ["rivers", "Rivers"]] as const)
      toggleRow(layers, name, w[key], (v) => {
        w[key] = v;
        this.later();
      });
    selectRow(layers, "Scale bar", [["metric", "Kilometres"], ["imperial", "Miles"]], w.units, (v) => {
      w.units = v === "imperial" ? "imperial" : "metric";
      this.later();
    });
    this.gridGroup(parent, WORLD_ID, w.grid, true);
    const places = group(parent, "Finding places by name");
    void this.o.plugin.places.status().then((s) => {
      buttonRow(places, "City and zip lookup", [{ text: "Resource manager", onClick: () => (this.app as any).commands.executeCommandById("booker:resource-manager") }], `Cities ${s.cities ? "downloaded" : "not downloaded"}. Postal codes ${s.postal ? "downloaded" : "not downloaded"}. Both work offline once downloaded.`);
    });
    footnote(parent, `${this.placed.get(WORLD_ID) ?? 0} notes are placed on the real world.`);
  }

  private drawMap(parent: HTMLElement, m: CustomMap) {
    const title = parent.createEl("input", { cls: "bp-title-input", attr: { type: "text", "aria-label": "Map name" } });
    title.value = m.name;
    title.addEventListener("change", () => {
      m.name = title.value.trim() || m.name;
      title.value = m.name;
      this.later();
      this.drawSwitcher();
    });

    // picture and a live preview of the coordinate grid over it
    const pic = group(parent, "Picture");
    const card = pic.createDiv({ cls: "bp-picture" });
    const prev = card.createDiv({ cls: "bp-preview" });
    prev.style.background = m.background;
    const img = prev.createEl("img", { cls: "bp-preview-img" });
    img.alt = "";
    img.style.opacity = String(m.image?.opacity ?? 1);
    const gridSvg = () => this.previewGrid(prev, m);
    void loadMapImage(this.app, m).then((url) => {
      if (this.thumb) URL.revokeObjectURL(this.thumb);
      this.thumb = url;
      if (url) img.src = url;
      else img.addClass("is-empty");
      gridSvg();
    });
    const missing = !!m.image && !this.app.vault.getFileByPath(m.image.path);
    card.createDiv({ cls: "bp-picture-meta", text: m.image ? `${m.image.path.split("/").pop()} · ${sizeText(m)}${missing ? " · file not found" : ""}` : "No picture: the map is a plain grid" });
    buttonRow(pic, "Picture file", [
      { text: "Import…", onClick: () => void this.importFromComputer(m) },
      { text: "From vault…", onClick: () => new ImagePicker(this.app, (f) => void this.useVaultFile(m, f)).open() },
      ...(m.image ? [{ text: "Remove", warn: true, onClick: () => ((m.image = null), void this.commit("Remove map picture"), this.drawBody()) }] : []),
    ]);
    if (m.image)
      sliderRow(pic, "Strength", 0.1, 1, 0.05, m.image.opacity, (v) => {
        m.image!.opacity = v;
        img.style.opacity = String(v);
        this.later();
      }, "Fade the picture to see the grid or background through it.");
    colorRow(pic, "Background", m.background, (v) => {
      m.background = v;
      prev.style.background = v;
      this.later();
    }, "Behind the picture, and the whole map when there is none.");

    this.coordsGroup(parent, m, gridSvg);
    this.gridGroup(parent, m.id, m.grid, false);
    footnote(parent, `${this.placed.get(m.id) ?? 0} notes are placed on this map.`);
  }

  /** The coordinate grid over the picture preview, drawn with the same maths as the map. */
  private previewGrid(prev: HTMLElement, m: CustomMap) {
    prev.querySelector("svg")?.remove();
    if (!m.grid.show) return;
    const c = m.coords;
    const lines = gridLines(c, { xMin: c.xMin, xMax: c.xMax, yMin: c.yMin, yMax: c.yMax }, m.grid, 5);
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 100 100");
    svg.setAttribute("preserveAspectRatio", "none");
    svg.addClass("bp-preview-grid");
    for (const l of lines) {
      const p = l.axis === "v" ? toFraction(c, { x: l.value, y: c.yMin }) : toFraction(c, { x: c.xMin, y: l.value });
      const ln = document.createElementNS(NS, "line");
      if (l.axis === "v") [["x1", p.u * 100], ["x2", p.u * 100], ["y1", 0], ["y2", 100]].forEach(([k, v]) => ln.setAttribute(String(k), String(v)));
      else [["y1", p.v * 100], ["y2", p.v * 100], ["x1", 0], ["x2", 100]].forEach(([k, v]) => ln.setAttribute(String(k), String(v)));
      ln.setAttribute("stroke", m.grid.color);
      ln.setAttribute("stroke-opacity", String(m.grid.opacity * (l.major ? 1 : 0.6)));
      ln.setAttribute("stroke-width", l.major ? "0.6" : "0.3");
      svg.appendChild(ln);
    }
    prev.appendChild(svg);
  }

  private coordsGroup(parent: HTMLElement, m: CustomMap, repaint: () => void) {
    parent.createDiv({ cls: "bp-caption", text: "Coordinates" });
    const chips = parent.createDiv({ cls: "bp-chips" });
    for (const p of COORD_PRESETS) {
      const b = chips.createEl("button", { cls: "bp-chip", text: p.label });
      b.onclick = () => {
        const next: Partial<CoordSystem> = { ...p.coords };
        // "image pixels" uses the picture's own size
        if (p.id === "pixels") Object.assign(next, { xMin: 0, xMax: m.image?.width || 1000, yMin: 0, yMax: m.image?.height || 1000 });
        m.coords = normaliseCoords({ ...m.coords, ...next });
        this.later();
        this.drawBody();
      };
    }
    const g = group(parent);
    const mid = () => ({ x: (m.coords.xMin + m.coords.xMax) / 2, y: (m.coords.yMin + m.coords.yMax) / 2 });
    const hint = footnote(parent, "");
    const say = () => hint.setText(`The middle of the map reads ${describeXY(m.coords, mid())}. A note's position is saved as “${m.id}: ${mid().x}, ${mid().y}”.`);
    const apply = (patch: Record<string, unknown>) => {
      m.coords = normaliseCoords({ ...m.coords, ...patch });
      this.later();
      say();
      repaint();
    };
    pairRow(g, "Left to right", String(m.coords.xMin), String(m.coords.xMax), (a, b) => {
      apply({ xMin: a, xMax: b });
      return [String(m.coords.xMin), String(m.coords.xMax)];
    }, "The x value at the left edge and at the right.");
    pairRow(g, "Bottom to top", String(m.coords.yMin), String(m.coords.yMax), (a, b) => {
      apply({ yMin: a, yMax: b });
      return [String(m.coords.yMin), String(m.coords.yMax)];
    }, m.coords.yUp ? "The y value at the bottom edge and at the top." : "The y value at the top edge and at the bottom.");
    selectRow(g, "Direction of y", [["up", "Up, like a graph"], ["down", "Down, like pixels"]], m.coords.yUp ? "up" : "down", (v) => {
      apply({ yUp: v === "up" });
      this.drawBody();
    });
    textRow(g, "Unit name", m.coords.unit, (v) => {
      apply({ unit: v });
      return m.coords.unit;
    }, { desc: "Shown after a position, such as leagues or km.", width: 100 });
    textRow(g, "Decimal places", String(m.coords.decimals), (v) => {
      apply({ decimals: v });
      return String(m.coords.decimals);
    }, { width: 60 });
    say();
  }

  private drawEngine(parent: HTMLElement) {
    const g = group(parent, "This computer");
    const status = g.createDiv({ cls: "bp-row bp-status" });
    const probe = () => status.setText(probeText(probeWebGL()));
    probe();
    const r = g.createDiv({ cls: "bp-row" });
    r.createDiv({ cls: "bp-label" }).createDiv({ cls: "bp-title", text: "Engine for the real-world map" });
    const cur = parseRenderer(this.o.plugin.settings.mapRenderer);
    const seg = segmented(
      r.createDiv({ cls: "bp-ctrl" }),
      RENDERER_SETTINGS.map((s) => ({ id: s, label: s === "auto" ? "Auto" : s === "webgl" ? "WebGL" : "Compatible" })),
      cur,
      async (id) => {
        this.o.plugin.settings.mapRenderer = parseRenderer(id) as RendererSetting;
        await this.o.plugin.persist();
        this.o.changed();
        seg.querySelectorAll(".bp-seg-item").forEach((e, i) => {
          const on = RENDERER_SETTINGS[i] === id;
          e.toggleClass("is-on", on);
          e.setAttr("aria-selected", String(on));
        });
      },
    );
    buttonRow(g, "Check again", [{ text: "Test WebGL", onClick: probe }], "Kept on this computer, not in your book. Auto uses WebGL when it is real hardware WebGL, and the compatible engine otherwise. Picture maps always use the compatible engine.");
  }

  private drawChecks(parent: HTMLElement) {
    const g = group(parent, "Checks");
    if (!this.orphans.length) {
      row(g, "Every position is on a map that exists");
      return;
    }
    const ids = [...new Set(this.orphans.flatMap((o) => o.mapIds))];
    buttonRow(g, `${this.orphans.length} notes are placed on a map that no longer exists`, [{ text: "Clear…", warn: true, onClick: () => this.clearOrphans() }], `Missing: ${ids.join(", ")}. The positions are still in the notes.`);
  }

  // ---------------------------------------------------------------- actions

  private addMap() {
    const m = newMap(`Map ${this.cfg.maps.length + 1}`, this.cfg.maps.map((x) => x.id));
    this.cfg.maps.push(m);
    this.selected = m.id;
    void this.commit("Add map");
    this.recount();
    this.drawAll();
  }

  private move(m: CustomMap, by: -1 | 1) {
    const i = this.cfg.maps.indexOf(m);
    const j = i + by;
    if (j < 0 || j >= this.cfg.maps.length) return;
    [this.cfg.maps[i], this.cfg.maps[j]] = [this.cfg.maps[j], this.cfg.maps[i]];
    this.later();
    this.drawSwitcher();
  }

  private duplicate(m: CustomMap) {
    const id = uniqueId(`${m.name} copy`, this.cfg.maps.map((x) => x.id));
    const copy: CustomMap = parseMaps({ maps: [{ ...JSON.parse(JSON.stringify(m)), id, name: `${m.name} copy` }] }).maps[0];
    this.cfg.maps.splice(this.cfg.maps.indexOf(m) + 1, 0, copy);
    this.selected = copy.id;
    void this.commit("Duplicate map");
    this.recount();
    this.drawAll();
  }

  private remove(m: CustomMap) {
    const n = this.placed.get(m.id) ?? 0;
    new ConfirmModal(this.app, `Delete “${m.name}”?`, `${n ? `${n} notes are placed on it. Their positions stay in the notes, and you can clear them under Checks. ` : ""}The picture file is not deleted.`, "Delete", () => {
      this.cfg.maps = this.cfg.maps.filter((x) => x !== m);
      if (this.cfg.last === m.id) this.cfg.last = WORLD_ID;
      this.selected = WORLD_ID;
      void this.commit("Delete map");
      this.recount();
      this.drawAll();
    }).open();
  }

  private async setImage(m: CustomMap, img: { path: string; width: number; height: number }) {
    const first = !m.image;
    const opacity = m.image?.opacity ?? 1;
    m.image = { path: img.path, width: img.width, height: img.height, opacity };
    // a new picture on a map still using the default range: make the units square to the picture
    const untouched = JSON.stringify(m.coords) === JSON.stringify(DEFAULT_COORDS);
    if (first && untouched && img.width && img.height) m.coords = normaliseCoords({ ...m.coords, yMax: Math.max(1, Math.round((1000 * img.height) / img.width)) });
    await this.commit("Set map picture", [img.path]);
    this.drawBody();
  }

  private async importFromComputer(m: CustomMap) {
    const f = (await pickFiles(IMAGE_EXTENSIONS))[0];
    if (!f) return;
    try {
      await this.setImage(m, await importMapImage(this.app, this.o.proj, m.id, f.name.split(".").pop() ?? "", await f.arrayBuffer()));
      new Notice(`Booker: picture added to “${m.name}”.`);
    } catch (e) {
      notifyError(e, "add the picture");
    }
  }

  private async useVaultFile(m: CustomMap, f: TFile) {
    try {
      await this.setImage(m, await linkMapImage(this.app, f));
    } catch (e) {
      notifyError(e, "use the picture");
    }
  }

  private clearOrphans() {
    const files = this.orphans.map((o) => o.file.path);
    new ConfirmModal(this.app, "Clear these positions?", `${this.orphans.length} notes lose their position on a map that no longer exists. This can be undone.`, "Clear", () => {
      void this.o.plugin
        .undoable("Clear map positions", this.o.proj, files, async () => {
          for (const o of this.orphans)
            await this.app.fileManager.processFrontMatter(o.file, (fm) => {
              let list: unknown = fm.mapPos;
              for (const id of o.mapIds) list = withPosition(list, id, null);
              if (list) fm.mapPos = list;
              else delete fm.mapPos;
            });
        })
        .then(() => {
          this.recount();
          this.drawAll();
          this.o.changed();
        })
        .catch((e) => notifyError(e, "clear the positions"));
    }).open();
  }
}
