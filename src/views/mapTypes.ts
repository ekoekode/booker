import type { MapPin } from "../project/mapData";
import type { XY } from "../project/mapCoords";
import type { GridSettings } from "../project/mapGrid";
import type { CustomMap, RealWorldSettings } from "../project/mapsConfig";

/** What every drawing engine (MapLibre, Leaflet) understands. The Map tab talks only to these types. */

export interface Basemap {
  land: GeoJSON.FeatureCollection;
  lakes: GeoJSON.FeatureCollection;
  rivers: GeoJSON.FeatureCollection;
  borders: GeoJSON.FeatureCollection;
  states: GeoJSON.FeatureCollection;
}

export interface Palette {
  ocean: string;
  land: string;
  coast: string;
  border: string;
  state: string;
  water: string;
}

/** The real world, or one picture map. A picture map's `imageUrl` is a blob URL of the image file, or null when there is none to show. */
export type MapSpec =
  | { kind: "world"; basemap: Basemap | null; world: RealWorldSettings }
  | { kind: "flat"; map: CustomMap; imageUrl: string | null };

export interface PinHandlers {
  click(pin: MapPin): void;
  /** the pin under the pointer, or null; x and y are pixels inside the map element */
  hover(pin: MapPin | null, x: number, y: number): void;
  /** the position under the pointer in the map's own units (real world: x = longitude, y = latitude), or null when it leaves */
  pointer?(p: XY | null): void;
  /** a click while in pick mode */
  pick?(p: XY): void;
  /** a click on empty map (not a pin) */
  blank?(): void;
  /** a click on pins that sit on top of each other (or a group that zooming cannot split); x and y are where to fan them out, in map pixels */
  stack?(pins: MapPin[], x: number, y: number): void;
  /** right click on empty map; p is the position, x and y the pointer's place on the screen */
  mapMenu?(p: XY, x: number, y: number): void;
  /** the map has stopped moving or zooming (pins that were close together may not be now, and the other way round) */
  settled?(): void;
  /** the map started to move or zoom (anything drawn over it at a fixed spot is out of place now) */
  moving?(): void;
  /** double click on a pin that is not being edited: open its note */
  open?(pin: MapPin): void;
  /** right click on any pin; x and y are the pointer's position on the screen */
  menu?(pin: MapPin, x: number, y: number): void;
  /** double click on the pin being edited: set it down */
  edit?(pin: MapPin): void;
  /** the pin being edited was dragged to this position (called as it moves and when it is let go) */
  moved?(pin: MapPin, p: XY): void;
}

export interface MapController {
  setPins(pins: MapPin[], colorOf: (p: MapPin) => string): void;
  fit(pins?: MapPin[], animate?: boolean): void;
  flyTo(pin: MapPin): void;
  setPalette(p: Palette): void;
  setGrid(g: GridSettings): void;
  /** in pick mode the next click reports a position instead of selecting a pin */
  setPick(on: boolean): void;
  /** lift a pin off the map so it can be dragged (its dot is hidden and a draggable one is shown) */
  beginEdit(pin: MapPin, color: string): void;
  /** set the edited pin down with a short animation, then take the draggable one away */
  endEdit(): Promise<void>;
  /** where a position is on screen, in pixels from the map's top left */
  toScreen(x: number, y: number): { x: number; y: number };
  /** space taken by floating controls on each side, in pixels, so fit and fly-to frame things inside the part that is visible */
  setInset(i: Inset): void;
  /** ring one pin as selected (null clears) */
  select(pinId: string | null): void;
  /** zoom in (positive) or out (negative) by that many levels */
  zoomBy(levels: number): void;
  resize(): void;
  destroy(): void;
}

export interface Inset {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** The real-world colours, light and dark. */
export const LIGHT: Palette = { ocean: "#cfe3ec", land: "#efece3", coast: "#a9b4b0", border: "#b9a9a0", state: "#d3cbc4", water: "#cfe3ec" };
export const DARK: Palette = { ocean: "#1c2a33", land: "#2b2f2b", coast: "#4b5650", border: "#6a5d56", state: "#3c3a37", water: "#1c2a33" };

/** Gunzip with the browser's own decompressor (works on desktop and mobile). */
export async function gunzipBytes(bytes: ArrayBuffer): Promise<Uint8Array> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function parseBasemap(gz: ArrayBuffer): Promise<Basemap> {
  return JSON.parse(new TextDecoder().decode(await gunzipBytes(gz))) as Basemap;
}
