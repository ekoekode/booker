import { centroid } from "./geo";
import { centroidXY, type MapPosition, type XY } from "./mapCoords";
import { WORLD_ID } from "./mapsConfig";

/**
 * What the Map tab shows. Pure: `PinRecord`s (one per note that might be on a map, read from the vault by mapPins.ts) go in,
 * pins with a position on the chosen map come out, and filters pick which of them are on screen.
 * A position is x and y in the map's own units. On the real world (id "world") x is longitude and y is latitude.
 */

export interface PinRecord {
  id: string;
  path: string;
  /** scene, or the `type` of a codex note (location, character, event, life, item ...) */
  kind: string;
  label: string;
  /** the positions the note carries itself, at most one per map */
  positions: MapPosition[];
  /** the place notes it links (a scene's `location`), best first */
  places: string[];
  /** story date as day numbers (astronomical years), null when undated */
  start: number | null;
  end: number | null;
  display?: string;
  characters: string[];
  plotlines: string[];
  book: string;
  /** a scene's chapter (key) and its readable name */
  chapter?: string;
  chapterTitle?: string;
  color?: string | null;
}

/** where a pin's position came from: the note, the place it links, the centre of a chapter's scenes, or a position set by hand for a chapter */
export type PinSource = "own" | "place" | "chapter" | "chapterSet";

export interface MapPin {
  id: string;
  path: string;
  kind: string;
  label: string;
  /** position on the map being shown */
  x: number;
  y: number;
  /** where the position came from: the note itself, a place it links, or the scenes of a chapter */
  source: PinSource;
  /** for source "place": which place note */
  placeName?: string;
  /** for a chapter pin: its key, to store a position set by hand */
  chapterKey?: string;
  /** for a badge that stands for several pins close together on screen: those pins */
  members?: MapPin[];
  start: number | null;
  end: number | null;
  display?: string;
  characters: string[];
  plotlines: string[];
  book: string;
  color?: string | null;
}

const key = (name: string) => name.trim().toLowerCase();

/** A chapter's identity across a series: its book and its number. */
export const chapterKey = (book: string, chapter: string): string => `${book}|${chapter}`;
const at = (r: PinRecord, mapId: string): XY | null => {
  const p = r.positions.find((q) => q.mapId === mapId);
  return p ? { x: p.x, y: p.y } : null;
};

/**
 * Pins for one map: every record with a position on it, directly or through a place note it links that has a position on the same map,
 * plus a pin per chapter at the centre of its scenes. A record's own position wins over a linked place's. Records with no position
 * on this map are left out (they may be on another).
 */
export function buildPins(records: PinRecord[], mapId: string = WORLD_ID, chapterSet: Map<string, XY> = new Map()): MapPin[] {
  // place notes are found by their file name, which is what a wikilink holds; the label is the name too
  const placeAt = new Map<string, XY>();
  for (const r of records) {
    if (r.kind !== "location") continue;
    const p = at(r, mapId);
    if (!p) continue;
    placeAt.set(key(r.label), p);
    const base = r.path.split("/").pop()?.replace(/\.md$/i, "");
    if (base) placeAt.set(key(base), p);
  }

  const pins: MapPin[] = [];
  for (const r of records) {
    let pos = at(r, mapId);
    let source: PinSource = "own";
    let placeName: string | undefined;
    if (!pos) {
      for (const p of r.places) {
        const hit = placeAt.get(key(p));
        if (hit) {
          pos = hit;
          source = "place";
          placeName = p;
          break;
        }
      }
    }
    if (!pos) continue;
    pins.push({ id: r.id, path: r.path, kind: r.kind, label: r.label, x: pos.x, y: pos.y, source, placeName, start: r.start, end: r.end, display: r.display, characters: r.characters, plotlines: r.plotlines, book: r.book, color: r.color });
  }

  // chapters have no note of their own: one pin per chapter, at the centre of the scenes that have a position, unless a position was set by hand
  const byChapter = new Map<string, { rec: PinRecord; pts: MapPin[]; all: PinRecord[] }>();
  const pinById = new Map(pins.map((p) => [p.id, p]));
  for (const r of records) {
    if (r.kind !== "scene" || r.chapter === undefined) continue;
    const k = chapterKey(r.book, r.chapter);
    const g = byChapter.get(k) ?? { rec: r, pts: [], all: [] };
    g.all.push(r);
    const pin = pinById.get(r.id);
    if (pin) g.pts.push(pin);
    byChapter.set(k, g);
  }
  for (const [k, { rec, pts, all }] of byChapter) {
    const set = chapterSet.get(k);
    // the globe wraps at +-180, a drawn map does not
    const c = set ?? (!pts.length ? null : mapId === WORLD_ID ? ((m) => (m ? { x: m.lng, y: m.lat } : null))(centroid(pts.map((p) => ({ lat: p.y, lng: p.x })))) : centroidXY(pts));
    if (!c) continue;
    // dates come from every scene of a chapter that was placed by hand, else from the ones on the map
    const dated = set ? all.map((r) => ({ start: r.start, end: r.end })) : pts;
    const starts = dated.map((p) => p.start).filter((n): n is number => n !== null);
    const ends = dated.map((p) => p.end).filter((n): n is number => n !== null);
    pins.push({
      id: `chapter:${k}`,
      path: (pts[0] ?? all[0]).path,
      kind: "chapter",
      label: rec.chapterTitle ?? `Chapter ${rec.chapter}`,
      x: c.x,
      y: c.y,
      source: set ? "chapterSet" : "chapter",
      chapterKey: k,
      start: starts.length ? Math.min(...starts) : null,
      end: ends.length ? Math.max(...ends) : null,
      characters: [...new Set((set ? all : pts).flatMap((p) => p.characters))],
      plotlines: [...new Set((set ? all : pts).flatMap((p) => p.plotlines))],
      book: rec.book,
      color: null,
    });
  }
  return pins;
}

export interface MapFilter {
  /** story-time window (day numbers); null = all of time */
  range: [number, number] | null;
  /** show pins that have no date even when a window is set */
  undated: boolean;
  /** kinds that are switched off */
  hidden: Set<string>;
  characters: string[];
  plotlines: string[];
  books: string[];
  text: string;
}

export const emptyFilter = (): MapFilter => ({ range: null, undated: true, hidden: new Set(), characters: [], plotlines: [], books: [], text: "" });

/** The extent of dated pins, or null when none has a date. */
export function dateExtent(pins: MapPin[]): [number, number] | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of pins) {
    if (p.start === null) continue;
    lo = Math.min(lo, p.start);
    hi = Math.max(hi, p.end ?? p.start);
  }
  return Number.isFinite(lo) && Number.isFinite(hi) ? [lo, hi] : null;
}

const overlapsRange = (p: MapPin, [a, b]: [number, number]): boolean => {
  const s = p.start as number;
  const e = p.end ?? s;
  return s <= b && e >= a;
};

export function filterPins(pins: MapPin[], f: MapFilter): MapPin[] {
  const q = f.text.trim().toLowerCase();
  return pins.filter((p) => {
    if (f.hidden.has(p.kind)) return false;
    if (f.range) {
      if (p.start === null) {
        if (!f.undated) return false;
      } else if (!overlapsRange(p, f.range)) return false;
    }
    if (f.characters.length && !f.characters.some((c) => p.characters.includes(c))) return false;
    if (f.plotlines.length && !f.plotlines.some((c) => p.plotlines.includes(c))) return false;
    if (f.books.length && !f.books.includes(p.book)) return false;
    if (q && !`${p.label} ${p.kind} ${p.placeName ?? ""}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

/** Distinct values for the filter menus, most used first. */
export function facets(pins: MapPin[]): { kinds: Array<[string, number]>; characters: string[]; plotlines: string[]; books: string[] } {
  const count = (xs: string[]) => {
    const m = new Map<string, number>();
    for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  };
  return {
    kinds: count(pins.map((p) => p.kind)),
    characters: count(pins.flatMap((p) => p.characters)).map(([n]) => n),
    plotlines: count(pins.flatMap((p) => p.plotlines)).map(([n]) => n),
    books: count(pins.map((p) => p.book).filter(Boolean)).map(([n]) => n),
  };
}
