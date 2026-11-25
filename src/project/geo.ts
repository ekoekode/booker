/**
 * Real-world positions. Pure: no Obsidian imports. A note carries its position in frontmatter as
 * `geoLat` and `geoLng` (numbers), with `address` (what the author typed) and `geoPlace` (what it resolved to) beside them.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

export const validLatLng = (lat: number, lng: number): boolean =>
  Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

/** A frontmatter value as a finite number (numbers, and numeric text such as "48.85"), else null. */
export function toNum(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.trim().replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** The position stored in a note's frontmatter, or null when it has none or it is out of range. */
export function readLatLng(fm: Record<string, unknown> | undefined | null): LatLng | null {
  if (!fm) return null;
  const lat = toNum(fm.geoLat);
  const lng = toNum(fm.geoLng);
  if (lat === null || lng === null || !validLatLng(lat, lng)) return null;
  return { lat, lng };
}

/** One DMS part such as 48°51'24"N or 2 21 8 E to signed degrees. */
function dms(text: string): number | null {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*(?:°|d|\s)?\s*(?:(\d+(?:\.\d+)?)\s*(?:'|′|m|\s)?\s*)?(?:(\d+(?:\.\d+)?)\s*(?:"|″|s)?\s*)?([NSEWnsew])?\s*$/.exec(text.replace(/[’‘]/g, "'").replace(/[“”]/g, '"'));
  if (!m) return null;
  let v = Math.abs(parseFloat(m[1])) + (m[2] ? parseFloat(m[2]) / 60 : 0) + (m[3] ? parseFloat(m[3]) / 3600 : 0);
  if (m[1].startsWith("-")) v = -v;
  if (m[4] && /[SsWw]/.test(m[4])) v = -Math.abs(v);
  return v;
}

/**
 * "48.8566, 2.3522", "48.8566 2.3522", "48.8566N 2.3522E", "48°51'24\"N 2°21'8\"E". Latitude first.
 * Returns null for anything else, so the caller can fall back to looking the text up as a place.
 */
export function parseCoords(input: string): LatLng | null {
  const t = (input ?? "").trim();
  if (!t) return null;
  const pair = t.split(/\s*[,;]\s*/);
  let parts = pair.length === 2 ? pair : null;
  if (!parts) {
    // "48.85 2.35" or "48.85N 2.35E": split where a hemisphere letter ends the first half, else on the middle gap of two numbers
    const h = /^(.*?[NSns])\s+(.*)$/.exec(t);
    if (h) parts = [h[1], h[2]];
    else {
      const nums = /^(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)$/.exec(t);
      if (nums) parts = [nums[1], nums[2]];
    }
  }
  if (!parts || parts.length !== 2) return null;
  const lat = dms(parts[0]);
  const lng = dms(parts[1]);
  if (lat === null || lng === null || !validLatLng(lat, lng)) return null;
  return { lat, lng };
}

/** "48.8566, 2.3522" (4 decimals is about 10 m). */
export const formatCoords = (p: LatLng, decimals = 4): string => `${p.lat.toFixed(decimals)}, ${p.lng.toFixed(decimals)}`;

/** Frontmatter keys for a resolved place. `null` removes a key. */
export interface GeoFields {
  address: string | null;
  geoLat: number | null;
  geoLng: number | null;
  geoPlace: string | null;
}

export function geoFields(p: LatLng | null, address: string, label = ""): GeoFields {
  if (!p) return { address: address || null, geoLat: null, geoLng: null, geoPlace: null };
  return { address: address || null, geoLat: Math.round(p.lat * 1e5) / 1e5, geoLng: Math.round(p.lng * 1e5) / 1e5, geoPlace: label || null };
}

/** Centre of a set of positions (plain mean; fine for the spans a story covers). Longitudes straddling ±180 are unwrapped first. */
export function centroid(points: LatLng[]): LatLng | null {
  if (!points.length) return null;
  const wrap = points.some((p) => p.lng > 90) && points.some((p) => p.lng < -90);
  const lngs = points.map((p) => (wrap && p.lng < 0 ? p.lng + 360 : p.lng));
  const lat = points.reduce((s, p) => s + p.lat, 0) / points.length;
  let lng = lngs.reduce((s, x) => s + x, 0) / lngs.length;
  if (lng > 180) lng -= 360;
  return { lat, lng };
}

export interface Bounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export function boundsOf(points: LatLng[]): Bounds | null {
  if (!points.length) return null;
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const p of points) {
    west = Math.min(west, p.lng);
    east = Math.max(east, p.lng);
    south = Math.min(south, p.lat);
    north = Math.max(north, p.lat);
  }
  return { west, south, east, north };
}

/** Great-circle distance in kilometres. */
export function distanceKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
