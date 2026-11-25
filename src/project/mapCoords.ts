/**
 * Coordinate systems for custom maps. Pure: no Obsidian imports.
 * A custom map stretches its picture over any range the author chooses (0 to 1000, -50 to 50, ...), so a position is written in the
 * author's own units and does not depend on the image's resolution.
 */

export interface CoordSystem {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  /** true: larger y is further up (like a graph); false: larger y is further down (like pixels) */
  yUp: boolean;
  /** what the units are called, such as "leagues" or "km"; shown in the readout */
  unit: string;
  /** digits after the point when a position is shown */
  decimals: number;
}

export interface XY {
  x: number;
  y: number;
}

export const DEFAULT_COORDS: CoordSystem = { xMin: 0, xMax: 1000, yMin: 0, yMax: 1000, yUp: true, unit: "", decimals: 1 };

export const COORD_PRESETS: Array<{ id: string; label: string; coords: Partial<CoordSystem> }> = [
  { id: "thousand", label: "0 to 1000", coords: { xMin: 0, xMax: 1000, yMin: 0, yMax: 1000, yUp: true } },
  { id: "hundred", label: "0 to 100", coords: { xMin: 0, xMax: 100, yMin: 0, yMax: 100, yUp: true } },
  { id: "unit", label: "0 to 1", coords: { xMin: 0, xMax: 1, yMin: 0, yMax: 1, yUp: true, decimals: 3 } },
  { id: "centred", label: "-1000 to 1000", coords: { xMin: -1000, xMax: 1000, yMin: -1000, yMax: 1000, yUp: true } },
  { id: "pixels", label: "Image pixels", coords: { yUp: false, decimals: 0 } },
];

const num = (v: unknown, fallback: number): number => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v.trim().replace(",", ".")) : NaN;
  return Number.isFinite(n) ? n : fallback;
};

/** Any input to a valid system: numbers are coerced, a min that is not below its max is repaired, junk falls back to the default. */
export function normaliseCoords(raw: unknown): CoordSystem {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  let xMin = num(o.xMin, DEFAULT_COORDS.xMin);
  let xMax = num(o.xMax, DEFAULT_COORDS.xMax);
  let yMin = num(o.yMin, DEFAULT_COORDS.yMin);
  let yMax = num(o.yMax, DEFAULT_COORDS.yMax);
  if (xMin > xMax) [xMin, xMax] = [xMax, xMin];
  if (yMin > yMax) [yMin, yMax] = [yMax, yMin];
  if (xMin === xMax) xMax = xMin + 1;
  if (yMin === yMax) yMax = yMin + 1;
  const decimals = Math.max(0, Math.min(6, Math.round(num(o.decimals, DEFAULT_COORDS.decimals))));
  return { xMin, xMax, yMin, yMax, yUp: o.yUp !== false, unit: typeof o.unit === "string" ? o.unit.trim().slice(0, 24) : "", decimals };
}

export const widthOf = (c: CoordSystem): number => c.xMax - c.xMin;
export const heightOf = (c: CoordSystem): number => c.yMax - c.yMin;

/** Is the position inside the map? (Positions outside are kept, but flagged.) */
export function inRange(c: CoordSystem, p: XY): boolean {
  return p.x >= c.xMin && p.x <= c.xMax && p.y >= c.yMin && p.y <= c.yMax;
}

/** A position as fractions of the picture: u from the left edge and v from the top edge, both 0 to 1. */
export function toFraction(c: CoordSystem, p: XY): { u: number; v: number } {
  const u = (p.x - c.xMin) / widthOf(c);
  const t = (p.y - c.yMin) / heightOf(c);
  return { u, v: c.yUp ? 1 - t : t };
}

export function fromFraction(c: CoordSystem, f: { u: number; v: number }): XY {
  const t = c.yUp ? 1 - f.v : f.v;
  return { x: c.xMin + f.u * widthOf(c), y: c.yMin + t * heightOf(c) };
}

/** "412.5, 188" or "412.5 188" or "x 412 y 188" to a position, or null. */
export function parseXY(input: string): XY | null {
  const t = (input ?? "").trim();
  if (!t) return null;
  const m = /^\(?\s*(?:x\s*[:=]?\s*)?(-?\d+(?:[.,]\d+)?)\s*(?:[,;]|\s)\s*(?:y\s*[:=]?\s*)?(-?\d+(?:[.,]\d+)?)\s*\)?$/i.exec(t);
  if (!m) return null;
  const x = Number(m[1].replace(",", "."));
  const y = Number(m[2].replace(",", "."));
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

const round = (n: number, d: number): number => {
  const k = 10 ** d;
  return Math.round(n * k) / k;
};

export const formatXY = (c: CoordSystem, p: XY): string => `${round(p.x, c.decimals).toFixed(c.decimals)}, ${round(p.y, c.decimals).toFixed(c.decimals)}`;

/** "412.5, 188 leagues" */
export const describeXY = (c: CoordSystem, p: XY): string => (c.unit ? `${formatXY(c, p)} ${c.unit}` : formatXY(c, p));

/** Plain mean (a custom map is flat, so there is no wrap-around to worry about). */
export function centroidXY(points: XY[]): XY | null {
  if (!points.length) return null;
  return { x: points.reduce((s, p) => s + p.x, 0) / points.length, y: points.reduce((s, p) => s + p.y, 0) / points.length };
}

export function boundsXY(points: XY[]): { xMin: number; xMax: number; yMin: number; yMax: number } | null {
  if (!points.length) return null;
  return {
    xMin: Math.min(...points.map((p) => p.x)),
    xMax: Math.max(...points.map((p) => p.x)),
    yMin: Math.min(...points.map((p) => p.y)),
    yMax: Math.max(...points.map((p) => p.y)),
  };
}

// ---------------------------------------------------------------- positions stored on a note

export interface MapPosition extends XY {
  mapId: string;
}

/** `mapPos` in a note's frontmatter: a list of "<mapId>: x, y". One entry per map; unreadable entries are skipped. */
export function readPositions(value: unknown): MapPosition[] {
  const list = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  const out: MapPosition[] = [];
  for (const raw of list) {
    if (typeof raw !== "string") continue;
    const at = raw.indexOf(":");
    if (at < 1) continue;
    const mapId = raw.slice(0, at).trim();
    const p = parseXY(raw.slice(at + 1));
    if (!mapId || !p) continue;
    const i = out.findIndex((q) => q.mapId === mapId);
    if (i >= 0) out[i] = { mapId, ...p };
    else out.push({ mapId, ...p });
  }
  return out;
}

/** The list to store: this map's position set, replaced or removed (null). Returns null when nothing is left so the property can go. */
export function withPosition(list: unknown, mapId: string, p: XY | null, decimals = 4): string[] | null {
  const keep = readPositions(list).filter((q) => q.mapId !== mapId);
  if (p) keep.push({ mapId, x: p.x, y: p.y });
  const out = keep.map((q) => `${q.mapId}: ${round(q.x, decimals)}, ${round(q.y, decimals)}`);
  return out.length ? out : null;
}
