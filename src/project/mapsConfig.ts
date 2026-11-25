import { DEFAULT_COORDS, normaliseCoords, type CoordSystem } from "./mapCoords";
import { DEFAULT_GRID, normaliseGrid, type GridSettings } from "./mapGrid";

/**
 * The maps of a book, kept in System/maps.json. Pure: `parseMaps` never throws and repairs whatever it is given, so a hand-edited or
 * half-written file cannot break the Map tab.
 */

/** The built-in real-world map has this id. It is never stored in `maps`. */
export const WORLD_ID = "world";
export const MAPS_VERSION = 1;

export interface MapImage {
  /** vault path of the picture */
  path: string;
  /** natural size in pixels (for the aspect ratio) */
  width: number;
  height: number;
  /** 0.05 to 1 */
  opacity: number;
}

export interface CustomMap {
  id: string;
  name: string;
  image: MapImage | null;
  /** colour behind (and around) the picture */
  background: string;
  coords: CoordSystem;
  grid: GridSettings;
}

export interface RealWorldSettings {
  enabled: boolean;
  borders: boolean;
  states: boolean;
  rivers: boolean;
  grid: GridSettings;
  /** scale bar units */
  units: "metric" | "imperial";
}

export interface MapsConfig {
  version: number;
  realWorld: RealWorldSettings;
  maps: CustomMap[];
  /** the map open last, so the tab comes back to it */
  last: string;
}

export const DEFAULT_REAL_WORLD: RealWorldSettings = { enabled: true, borders: true, states: true, rivers: true, grid: { ...DEFAULT_GRID }, units: "metric" };

export function slugify(name: string): string {
  const s = (name ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return s || "map";
}

/** A slug not used by any map and not the world's id. */
export function uniqueId(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  used.add(WORLD_ID);
  const root = slugify(base);
  if (!used.has(root)) return root;
  for (let i = 2; i < 10000; i++) if (!used.has(`${root}-${i}`)) return `${root}-${i}`;
  return `${root}-${Date.now()}`;
}

const text = (v: unknown, fallback: string, max = 120): string => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : fallback);
const colour = (v: unknown, fallback: string): string => (typeof v === "string" && /^#[0-9a-f]{3,8}$/i.test(v.trim()) ? v.trim() : fallback);
const flag = (v: unknown, fallback: boolean): boolean => (typeof v === "boolean" ? v : fallback);

function parseImage(raw: unknown): MapImage | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.path !== "string" || !o.path.trim()) return null;
  const size = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : 0);
  const opacity = typeof o.opacity === "number" && Number.isFinite(o.opacity) ? Math.max(0.05, Math.min(1, o.opacity)) : 1;
  return { path: o.path.trim(), width: size(o.width), height: size(o.height), opacity };
}

export function newMap(name: string, taken: Iterable<string> = []): CustomMap {
  return { id: uniqueId(name, taken), name: text(name, "New map", 60), image: null, background: "#e9dfc7", coords: { ...DEFAULT_COORDS }, grid: { ...DEFAULT_GRID, show: true } };
}

export function parseMaps(raw: unknown): MapsConfig {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, any>) : {};
  const rw = o.realWorld && typeof o.realWorld === "object" ? (o.realWorld as Record<string, unknown>) : {};
  const realWorld: RealWorldSettings = {
    enabled: flag(rw.enabled, true),
    borders: flag(rw.borders, true),
    states: flag(rw.states, true),
    rivers: flag(rw.rivers, true),
    grid: normaliseGrid(rw.grid, DEFAULT_REAL_WORLD.grid),
    units: rw.units === "imperial" ? "imperial" : "metric",
  };
  const maps: CustomMap[] = [];
  for (const m of Array.isArray(o.maps) ? o.maps : []) {
    if (!m || typeof m !== "object" || Array.isArray(m)) continue;
    const name = text(m.name, "", 60);
    const id = typeof m.id === "string" && m.id.trim() ? slugify(m.id) : slugify(name);
    if (!id || id === WORLD_ID || maps.some((x) => x.id === id)) continue;
    maps.push({
      id,
      name: name || id,
      image: parseImage(m.image),
      background: colour(m.background, "#e9dfc7"),
      coords: normaliseCoords(m.coords),
      grid: normaliseGrid(m.grid, { ...DEFAULT_GRID, show: true }),
    });
  }
  const ids = new Set(maps.map((m) => m.id));
  const last = typeof o.last === "string" && (ids.has(o.last) || o.last === WORLD_ID) ? o.last : WORLD_ID;
  return { version: MAPS_VERSION, realWorld, maps, last };
}

/** The maps the author can use right now: the world (unless switched off) then the custom ones. */
export interface MapChoice {
  id: string;
  name: string;
  world: boolean;
}

export function mapChoices(cfg: MapsConfig): MapChoice[] {
  return [...(cfg.realWorld.enabled ? [{ id: WORLD_ID, name: "Real world", world: true }] : []), ...cfg.maps.map((m) => ({ id: m.id, name: m.name, world: false }))];
}

/** Which map to show: the one asked for if it exists, else the last one, else the first available, else null (nothing to show). */
export function resolveMap(cfg: MapsConfig, wanted?: string | null): string | null {
  const ids = mapChoices(cfg).map((c) => c.id);
  if (wanted && ids.includes(wanted)) return wanted;
  if (ids.includes(cfg.last)) return cfg.last;
  return ids[0] ?? null;
}

export const mapById = (cfg: MapsConfig, id: string): CustomMap | undefined => cfg.maps.find((m) => m.id === id);
