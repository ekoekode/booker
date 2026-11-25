import { TFile, setIcon } from "obsidian";
import type BookerPlugin from "../main";
import { formatCoords, geoFields, parseCoords, readLatLng, type LatLng } from "../project/geo";
import { pickConfident, type PlaceHit } from "../project/gazetteer";
import { describeXY, formatXY, inRange, parseXY, type XY } from "../project/mapCoords";
import { positionsOf } from "../project/mapPins";
import { mapById, parseMaps, WORLD_ID, type CustomMap, type MapsConfig } from "../project/mapsConfig";
import { readMaps, setPosition } from "../project/mapsStore";
import type { Project } from "../project/vaultOps";
import { PLACES_RESOURCES } from "../resources/catalog";
import { VIEW_WORLD_MAP } from "./worldMap";
import { MapsSettingsModal } from "./mapsSettings";
import { box, writeFm } from "./inspectorFields";

/**
 * "Location" on any scene or Codex note: where it is on each map. The real world takes a typed city, state, country, zip or
 * coordinates (worked out from the place data the author has downloaded); a drawn map takes x and y in its own units. A note can be on
 * several maps at once. The real world is kept in `address`, `geoLat`, `geoLng` and `geoPlace`; drawn maps in the `mapPos` list.
 */
export function locationBox(parent: HTMLElement, plugin: BookerPlugin, file: TFile, fm: Record<string, any>, proj?: Project) {
  const body = box(parent, "Location", { key: "box:Location", open: positionsOf(fm).length > 0 || !!fm.address });
  const root = body.createDiv({ cls: "booker-geo" });
  let cfg: MapsConfig = parseMaps(null);
  // the maps this note has a row for, in the order they were added
  const rows: string[] = positionsOf(fm).map((p) => p.mapId);
  const spots = new Map<string, XY>(positionsOf(fm).map((p) => [p.mapId, { x: p.x, y: p.y }]));
  const world = { at: readLatLng(fm) as LatLng | null, shown: String(fm.geoPlace || fm.address || "On the map"), address: String(fm.address ?? "") };

  const open = (mapId: string, pick = false) =>
    void plugin.openView(VIEW_WORLD_MAP, { ...(proj ? { project: proj.file.path } : {}), map: mapId, pick: pick ? file.path : "" });

  const build = () => {
    root.empty();
    const usable = (id: string) => (id === WORLD_ID ? cfg.realWorld.enabled : !!mapById(cfg, id));
    // positions on maps that are gone (or the real world while it is off) are kept in the note but not edited here
    const shownRows = rows.filter(usable);
    const hidden = rows.length - shownRows.length;
    for (const id of shownRows) (id === WORLD_ID ? worldRow : mapRow)(id);
    if (!shownRows.length) root.createDiv({ cls: "booker-muted", text: cfg.realWorld.enabled || cfg.maps.length ? "Not on any map yet." : "There is no map to place this on. Add one in Maps settings." });
    if (hidden) root.createDiv({ cls: "booker-muted", text: `${hidden} position${hidden === 1 ? " is" : "s are"} saved on a map that is switched off or gone.` });

    const free = [...(cfg.realWorld.enabled ? [{ id: WORLD_ID, name: "Real world" }] : []), ...cfg.maps.map((m) => ({ id: m.id, name: m.name }))].filter((m) => !rows.includes(m.id));
    const foot = root.createDiv({ cls: "booker-geo-actions" });
    if (free.length) {
      const sel = foot.createEl("select", { cls: "dropdown", attr: { "aria-label": "Add to a map" } });
      sel.createEl("option", { text: "Add to a map…" }).value = "";
      for (const m of free) sel.createEl("option", { text: m.name }).value = m.id;
      sel.onchange = () => {
        if (!sel.value) return;
        rows.push(sel.value);
        build();
        root.querySelector<HTMLInputElement>(`[data-map="${sel.value}"] input`)?.focus();
      };
    }
    const manage = foot.createEl("button", { cls: "booker-btn", text: "Maps…", attr: { title: "Add, change or remove maps" } });
    manage.onclick = () => proj && new MapsSettingsModal(plugin, proj).open();
  };

  const rowShell = (id: string, name: string, onRemove: () => void) => {
    const row = root.createDiv({ cls: "booker-geo-row", attr: { "data-map": id } });
    const head = row.createDiv({ cls: "booker-geo-rowhead" });
    setIcon(head.createSpan({ cls: "booker-geo-pin" }), "map-pin");
    head.createSpan({ cls: "booker-geo-mapname", text: name });
    const x = head.createEl("button", { cls: "booker-geo-remove clickable-icon", attr: { "aria-label": `Take off ${name}`, title: "Take off this map" } });
    setIcon(x, "x");
    x.onclick = onRemove;
    return row;
  };

  // ---------------------------------------------------------------- a drawn map

  const mapRow = (id: string) => {
    const m = mapById(cfg, id) as CustomMap;
    const row = rowShell(id, m.name, async () => {
      await setPosition(plugin.app, file, id, null);
      rows.splice(rows.indexOf(id), 1);
      spots.delete(id);
      build();
    });
    const state = row.createDiv({ cls: "booker-geo-status" });
    const input = row.createEl("input", { cls: "booker-geo-input", attr: { type: "text", placeholder: `x, y${m.coords.unit ? ` in ${m.coords.unit}` : ""}  ·  ${m.coords.xMin} to ${m.coords.xMax} across`, "aria-label": `Position on ${m.name}` } });
    const at = spots.get(id);
    if (at) input.value = formatXY(m.coords, at);
    const paint = () => {
      const p = spots.get(id);
      state.empty();
      if (!p) return void state.createSpan({ cls: "booker-muted", text: "Type a position, or pick it on the map." });
      state.createSpan({ text: describeXY(m.coords, p) });
      if (!inRange(m.coords, p)) state.createSpan({ cls: "booker-geo-bad", text: "  outside the map" });
    };
    paint();
    const commit = async () => {
      const typed = input.value.trim();
      if (!typed) {
        if (spots.has(id)) {
          spots.delete(id);
          await setPosition(plugin.app, file, id, null);
        }
        return paint();
      }
      const p = parseXY(typed);
      if (!p) return void (state.empty(), state.createSpan({ cls: "booker-geo-bad", text: "Not understood. Type two numbers, such as 412.5, 188." }));
      spots.set(id, p);
      await setPosition(plugin.app, file, id, p, { decimals: m.coords.decimals + 2 });
      paint();
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void commit();
      }
    });
    input.addEventListener("change", () => void commit());
    const acts = row.createDiv({ cls: "booker-geo-actions" });
    acts.createEl("button", { cls: "booker-btn", text: "Pick on map" }).onclick = () => open(id, true);
    if (spots.has(id)) acts.createEl("button", { cls: "booker-btn", text: "Show" }).onclick = () => open(id);
  };

  // ---------------------------------------------------------------- the real world

  const worldRow = (id: string) => {
    const row = rowShell(id, "Real world", async () => {
      await setPosition(plugin.app, file, WORLD_ID, null);
      world.at = null;
      world.address = "";
      rows.splice(rows.indexOf(id), 1);
      build();
    });
    const status = row.createDiv({ cls: "booker-geo-status" });
    const input = row.createEl("input", { cls: "booker-geo-input", attr: { type: "text", placeholder: "City, state, country or zip  ·  or 48.85, 2.35", "aria-label": "Where in the real world" } });
    input.value = world.address;
    const choices = row.createDiv({ cls: "booker-geo-choices" });

    const showStatus = () => {
      status.empty();
      if (!world.at) return void status.createSpan({ cls: "booker-muted", text: "Type a place." });
      status.createSpan({ text: world.shown });
      status.createSpan({ cls: "booker-muted", text: ` ${formatCoords(world.at)}` });
    };
    showStatus();

    const say = (text: string, bad = false) => {
      choices.empty();
      choices.createDiv({ cls: bad ? "booker-geo-bad" : "booker-muted", text });
    };

    const save = async (p: LatLng | null, typed: string, label: string) => {
      const g = geoFields(p, typed, label);
      await writeFm({ app: plugin.app, file }, (f) => {
        for (const [k, v] of Object.entries(g)) f[k] = v;
      });
      // the inspector does not redraw while this field has focus, so show the result here
      world.at = p ? { lat: g.geoLat as number, lng: g.geoLng as number } : null;
      world.shown = label || typed || "On the map";
      world.address = typed;
      choices.empty();
      showStatus();
    };

    const offerDownload = (what: "cities" | "postal") => {
      const r = PLACES_RESOURCES[what === "cities" ? 0 : 1];
      choices.empty();
      choices.createDiv({ cls: "booker-muted", text: what === "cities" ? "To find places by name, Booker needs a list of cities. It is a one-off download (about 3 MB) and then works offline." : "To find a zip or postal code, Booker needs the postal code list. It is a one-off download (about 30 MB) and then works offline." });
      const b = choices.createEl("button", { cls: "booker-btn mod-cta", text: `Download ${what === "cities" ? "cities" : "postal codes"}` });
      b.disabled = !plugin.resources.available;
      b.onclick = () => {
        b.disabled = true;
        void plugin.resources.installPlaces(r).then(() => say("Downloaded. Press Enter to find it."));
      };
      if (!plugin.resources.available) choices.createDiv({ cls: "booker-muted", text: "Downloads need the desktop app. You can still type coordinates." });
    };

    const choose = (h: PlaceHit, typed: string) => {
      const b = choices.createEl("button", { cls: "booker-geo-choice" });
      b.createSpan({ text: h.label });
      b.createSpan({ cls: "booker-muted", text: ` ${formatCoords(h, 2)}` });
      b.onclick = () => void save(h, typed, h.label);
    };

    const resolve = async () => {
      const typed = input.value.trim();
      choices.empty();
      if (!typed) {
        if (world.at || world.address) await save(null, "", "");
        return;
      }
      const pair = parseCoords(typed);
      if (pair) return void (await save(pair, typed, ""));
      const have = await plugin.places.status();
      if (!have.cities && !have.postal) return offerDownload("cities");
      say("Looking…");
      const hits = await plugin.places.lookup(typed);
      if (!hits.length) {
        if (/\d/.test(typed) && !have.postal) return offerDownload("postal");
        if (!have.cities) return offerDownload("cities");
        return say("No place matches that. Try a bigger city, add the state or country, or type coordinates such as 48.85, 2.35.", true);
      }
      const sure = pickConfident(hits);
      if (sure) return void (await save(sure, typed, sure.label));
      choices.empty();
      choices.createDiv({ cls: "booker-muted", text: "Which one?" });
      for (const h of hits.slice(0, 6)) choose(h, typed);
    };

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void resolve();
      }
    });
    input.addEventListener("change", () => void resolve());
    const acts = row.createDiv({ cls: "booker-geo-actions" });
    acts.createEl("button", { cls: "booker-btn", text: "Pick on map" }).onclick = () => open(WORLD_ID, true);
    if (world.at) acts.createEl("button", { cls: "booker-btn", text: "Show" }).onclick = () => open(WORLD_ID);
  };

  build();
  if (proj) void readMaps(plugin.app, proj).then((c) => ((cfg = c), build()));
}
