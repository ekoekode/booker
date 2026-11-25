import { normalizePath, type App, type TFile } from "obsidian";
import { withPosition, type XY } from "./mapCoords";
import { geoFields, type LatLng } from "./geo";
import { parseMaps, WORLD_ID, type CustomMap, type MapsConfig } from "./mapsConfig";
import { positionsOf } from "./mapPins";
import { readSystemJson, writeSystemJson, type Project } from "./vaultOps";

/** Reading and writing the maps of a book, their pictures, and the position a note holds on a map. */

export const MAPS_FILE = "maps.json";

export async function readMaps(app: App, proj: Project): Promise<MapsConfig> {
  return parseMaps(await readSystemJson(app, proj, MAPS_FILE));
}

export async function writeMaps(app: App, proj: Project, cfg: MapsConfig): Promise<void> {
  await writeSystemJson(app, proj, MAPS_FILE, cfg);
}

export const mapsFolder = (proj: Project): string => `${proj.layout.system}/maps`;

const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", svg: "image/svg+xml", avif: "image/avif" };
export const IMAGE_EXTENSIONS = Object.keys(MIME);
export const isMapImage = (path: string): boolean => IMAGE_EXTENSIONS.includes(path.split(".").pop()?.toLowerCase() ?? "");

/** A blob URL for the map's picture, or null when it has none or the file is gone. The caller revokes it when done. */
export async function loadMapImage(app: App, map: CustomMap): Promise<string | null> {
  const path = map.image?.path;
  if (!path) return null;
  try {
    const f = app.vault.getFileByPath(normalizePath(path));
    if (!f) return null;
    const bytes = await app.vault.readBinary(f);
    return URL.createObjectURL(new Blob([bytes], { type: MIME[f.extension.toLowerCase()] ?? "application/octet-stream" }));
  } catch {
    return null;
  }
}

/** Natural size of a picture, so the settings can show it and a map without a stated size still has an aspect ratio. */
export function imageSize(blobUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth || 1000, height: img.naturalHeight || 1000 });
    img.onerror = () => resolve({ width: 0, height: 0 });
    img.src = blobUrl;
  });
}

/** Copy a picture into the book (System/maps/<id>.<ext>) so it moves with it, replacing an earlier one with the same name. */
export async function importMapImage(app: App, proj: Project, mapId: string, ext: string, data: ArrayBuffer): Promise<{ path: string; width: number; height: number }> {
  const dir = mapsFolder(proj);
  if (!app.vault.getFolderByPath(dir)) await app.vault.createFolder(dir);
  const clean = ext.toLowerCase().replace(/^\./, "");
  if (!IMAGE_EXTENSIONS.includes(clean)) throw new Error(`.${clean} is not a picture type Booker can show (png, jpg, webp, gif, svg).`);
  const path = normalizePath(`${dir}/${mapId}.${clean}`);
  const old = app.vault.getFileByPath(path);
  if (old) await app.vault.modifyBinary(old, data);
  else await app.vault.createBinary(path, data);
  const url = URL.createObjectURL(new Blob([data], { type: MIME[clean] }));
  const size = await imageSize(url);
  URL.revokeObjectURL(url);
  return { path, ...size };
}

/** Link to a picture already in the vault instead of copying it (the file stays where it is). */
export async function linkMapImage(app: App, file: TFile): Promise<{ path: string; width: number; height: number }> {
  const bytes = await app.vault.readBinary(file);
  const url = URL.createObjectURL(new Blob([bytes], { type: MIME[file.extension.toLowerCase()] ?? "image/png" }));
  const size = await imageSize(url);
  URL.revokeObjectURL(url);
  return { path: file.path, ...size };
}

// ---------------------------------------------------------------- positions on notes

/** Put a note on a map, or take it off (null). The real world writes geoLat/geoLng; a drawn map writes its entry in mapPos. */
export async function setPosition(app: App, file: TFile, mapId: string, p: XY | LatLng | null, extra: { address?: string; label?: string; decimals?: number } = {}): Promise<void> {
  await app.fileManager.processFrontMatter(file, (fm) => {
    if (mapId === WORLD_ID) {
      const ll = p ? ("lat" in p ? p : { lat: p.y, lng: p.x }) : null;
      const g = geoFields(ll, extra.address ?? "", extra.label ?? "");
      for (const [k, v] of Object.entries(g)) {
        if (v === null) delete fm[k];
        else fm[k] = v;
      }
    } else {
      const xy = p ? ("lat" in p ? { x: p.lng, y: p.lat } : p) : null;
      const next = withPosition(fm.mapPos, mapId, xy, extra.decimals ?? 4);
      if (next) fm.mapPos = next;
      else delete fm.mapPos;
    }
  });
}

/** Which maps a note is on, from the metadata cache. */
export const placedOn = (app: App, file: TFile): string[] => positionsOf(app.metadataCache.getFileCache(file)?.frontmatter).map((p) => p.mapId);

/** Every note in the book with a position on a map that no longer exists (and how many on each existing map), for the Maps settings. */
export function countPlaced(app: App, proj: Project, cfg: MapsConfig): { byMap: Map<string, number>; orphans: Array<{ file: TFile; mapIds: string[] }> } {
  const known = new Set([WORLD_ID, ...cfg.maps.map((m) => m.id)]);
  const byMap = new Map<string, number>();
  const orphans: Array<{ file: TFile; mapIds: string[] }> = [];
  const scenes = proj.layout.scenes + "/";
  const codex = proj.layout.codex + "/";
  for (const f of app.vault.getMarkdownFiles()) {
    if (!f.path.startsWith(scenes) && !f.path.startsWith(codex)) continue;
    const ps = positionsOf(app.metadataCache.getFileCache(f)?.frontmatter);
    for (const p of ps) byMap.set(p.mapId, (byMap.get(p.mapId) ?? 0) + 1);
    const bad = ps.filter((p) => !known.has(p.mapId)).map((p) => p.mapId);
    if (bad.length) orphans.push({ file: f, mapIds: bad });
  }
  return { byMap, orphans };
}
