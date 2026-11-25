import { scaleLinear } from "d3-scale";
import type { CoordSystem } from "./mapCoords";

/**
 * Grid lines for a map. Pure: a renderer asks for the lines that fall in the part of the map on screen and draws them.
 * Custom maps use their own units; the real world uses degrees of latitude and longitude (a graticule).
 */

export interface GridSettings {
  show: boolean;
  /** distance between major lines, or "auto" to pick a round step that suits the zoom */
  major: number | "auto";
  /** how many minor lines between two major ones (0 = none) */
  minor: number;
  color: string;
  opacity: number;
  labels: boolean;
}

export const DEFAULT_GRID: GridSettings = { show: false, major: "auto", minor: 0, color: "#6b6b6b", opacity: 0.5, labels: true };

export function normaliseGrid(raw: unknown, base: GridSettings = DEFAULT_GRID): GridSettings {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const major = typeof o.major === "number" && Number.isFinite(o.major) && o.major > 0 ? o.major : o.major === "auto" ? "auto" : base.major;
  const minor = typeof o.minor === "number" && Number.isFinite(o.minor) ? Math.max(0, Math.min(20, Math.round(o.minor))) : base.minor;
  const opacity = typeof o.opacity === "number" && Number.isFinite(o.opacity) ? Math.max(0.05, Math.min(1, o.opacity)) : base.opacity;
  const color = typeof o.color === "string" && /^#[0-9a-f]{3,8}$/i.test(o.color.trim()) ? o.color.trim() : base.color;
  return { show: typeof o.show === "boolean" ? o.show : base.show, major, minor, color, opacity, labels: typeof o.labels === "boolean" ? o.labels : base.labels };
}

export interface GridLine {
  /** "v": a vertical line at x = value; "h": a horizontal line at y = value */
  axis: "v" | "h";
  value: number;
  major: boolean;
  label?: string;
}

/** The visible part of the map in its own units. */
export interface View {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

/** A round step (1, 2, 5 times a power of ten) that gives roughly `count` lines across `span`. */
export function niceStep(span: number, count: number): number {
  if (!(span > 0) || count < 1) return 1;
  const raw = span / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const f = raw / pow;
  return (f >= 7.5 ? 10 : f >= 3.5 ? 5 : f >= 1.5 ? 2 : 1) * pow;
}

const fmt = (v: number, step: number): string => {
  const d = step >= 1 ? 0 : Math.min(6, Math.ceil(-Math.log10(step)));
  return v.toFixed(d);
};

function axisLines(axis: "v" | "h", lo: number, hi: number, limLo: number, limHi: number, g: GridSettings, targetCount: number, cap: number): GridLine[] {
  const a = Math.max(lo, limLo);
  const b = Math.min(hi, limHi);
  if (!(b > a)) return [];
  let step = g.major === "auto" ? niceStep(b - a, targetCount) : g.major;
  // never draw an unreadable swarm: widen the step until the count is sane
  while ((b - a) / step > cap) step *= 2;
  const minorStep = g.minor > 0 ? step / (g.minor + 1) : 0;
  const first = Math.ceil((a - 1e-9) / (minorStep || step)) * (minorStep || step);
  const out: GridLine[] = [];
  const total = Math.floor((b - first) / (minorStep || step) + 1e-9) + 1;
  for (let i = 0; i < total && i < cap * (g.minor + 1) + 1; i++) {
    const value = first + i * (minorStep || step);
    const rounded = Math.round(value / step);
    const isMajor = Math.abs(value - rounded * step) < step * 1e-6;
    out.push({ axis, value: isMajor ? rounded * step : value, major: isMajor, label: isMajor && g.labels ? fmt(rounded * step, step) : undefined });
  }
  return out;
}

/**
 * Lines inside `view`, kept within the map's own range `c`. `targetCount` is how many major lines to aim for across the view
 * when the step is automatic (more when the map is larger on screen).
 */
export function gridLines(c: CoordSystem, view: View, g: GridSettings, targetCount = 8): GridLine[] {
  if (!g.show) return [];
  return [
    ...axisLines("v", view.xMin, view.xMax, c.xMin, c.xMax, g, targetCount, 200),
    ...axisLines("h", view.yMin, view.yMax, c.yMin, c.yMax, g, targetCount, 200),
  ];
}

/** Lines of latitude and longitude for the real world (degrees; steps follow the zoom unless fixed). */
export function graticule(view: View, g: GridSettings, targetCount = 8): GridLine[] {
  if (!g.show) return [];
  const clamp = (s: GridSettings): GridSettings => (s.major === "auto" ? s : { ...s, major: Math.min(90, s.major) });
  const gg = clamp(g);
  const lat = axisLines("h", view.yMin, view.yMax, -85, 85, gg, targetCount, 120);
  const lng = axisLines("v", view.xMin, view.xMax, -180, 180, gg, targetCount, 120);
  return [...lng, ...lat].map((l) => (l.label ? { ...l, label: `${l.label}°` } : l));
}

/** Ticks for an axis scale bar (used by the cursor readout when it needs a round number). */
export function ticksOf(lo: number, hi: number, count = 6): number[] {
  return scaleLinear().domain([lo, hi]).ticks(count);
}
