import type { App } from "obsidian";
import { parseStoryDate, timelineAnchor } from "../dates";
import { actLabel, type HubScene } from "./hubModel";
import { chapterTitle, linkList } from "./format";
import { readLatLng } from "./geo";
import { readPositions, type MapPosition } from "./mapCoords";
import { buildPins, type MapPin, type PinRecord } from "./mapData";
import { WORLD_ID } from "./mapsConfig";
import { normTags } from "./plotlines";
import { getLabels, type Project } from "./vaultOps";

/** Where a note says it is: the real-world position (`geoLat`, `geoLng`) as the "world" map, and `mapPos` for every drawn map. */
export function positionsOf(fm: Record<string, unknown> | undefined | null): MapPosition[] {
  if (!fm) return [];
  const out = readPositions(fm.mapPos).filter((p) => p.mapId !== WORLD_ID);
  const w = readLatLng(fm);
  if (w) out.unshift({ mapId: WORLD_ID, x: w.lng, y: w.lat });
  return out;
}

/** Every scene and Codex note that might be on a map, with the positions it carries. Dates are optional: an undated note can still be on a map. */
export function gatherPinRecords(app: App, proj: Project, scenes: HubScene[]): PinRecord[] {
  const records: PinRecord[] = [];
  const labels = getLabels(app, proj);

  for (const sc of scenes) {
    const fm = app.metadataCache.getCache(sc.path)?.frontmatter;
    const anchor = timelineAnchor(sc.anchor);
    const w = sc.storyDate ? parseStoryDate(sc.storyDate, anchor) : null;
    records.push({
      id: sc.path,
      path: sc.path,
      kind: "scene",
      label: sc.title,
      positions: positionsOf(fm),
      places: sc.location ?? [],
      start: w?.start ?? null,
      end: w?.end ?? null,
      display: w?.display,
      characters: [...new Set([...(sc.pov ? [sc.pov] : []), ...(sc.characters ?? [])])],
      plotlines: sc.tags ?? [],
      book: sc.book ? `${sc.book} · ${actLabel(sc.act)}` : "",
      chapter: sc.chapter === undefined ? undefined : String(sc.chapter),
      chapterTitle: sc.chapter === undefined ? undefined : chapterTitle(sc.chapter, labels),
      color: sc.color ?? null,
    });
  }
  // a series shows the book on every scene; keep just the book name for filtering
  for (const r of records) if (r.book.includes(" · ")) r.book = r.book.split(" · ")[0];

  const anchor = timelineAnchor(proj.timelineStart);
  for (const f of app.vault.getMarkdownFiles()) {
    if (!f.path.startsWith(proj.layout.codex + "/")) continue;
    const fm = app.metadataCache.getCache(f.path)?.frontmatter;
    if (!fm) continue;
    const type = String(fm.type ?? "note");
    const positions = positionsOf(fm);
    const places = linkList(fm.location ?? fm.locations);
    if (!positions.length && !places.length) continue;
    const raw = fm.storyDate ?? fm.story_date;
    const w = raw ? parseStoryDate(raw, anchor) : null;
    records.push({
      id: f.path,
      path: f.path,
      kind: type,
      label: type === "life" && fm.lifeName ? String(fm.lifeName) : String(fm.name ?? f.basename),
      positions,
      places,
      start: w?.start ?? null,
      end: w?.end ?? null,
      display: w?.display,
      characters: type === "character" ? [f.basename] : linkList(fm.character ?? fm.characters),
      plotlines: normTags(fm.tags),
      book: "",
      color: fm.color ? String(fm.color) : null,
    });
  }
  return records;
}

/** Pins for one map ("world" or a custom map's id). */
export function gatherMapPins(app: App, proj: Project, scenes: HubScene[], mapId: string = WORLD_ID): MapPin[] {
  return buildPins(gatherPinRecords(app, proj, scenes), mapId);
}
