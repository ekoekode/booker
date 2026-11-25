import type { App } from "obsidian";
import type { TimelineItem } from "../analysis";
import { parseStoryDate, timelineAnchor } from "../dates";
import { actTitle, chapterTitle, linkList } from "./format";
import { normTags } from "./plotlines";
import { deriveSpans } from "./timelineSources";
import { getLabels, isSequenceOff, Project, readLives, readScenes } from "./vaultOps";
import { actLabel, chapterLabel, type HubScene } from "./hubModel";

/**
 * Everything with a story date in a project, as map items: dated scenes, any dated note in the Codex (lives, events, items and so on),
 * and chapter and act spans worked out from the scenes. A scene that links a life also counts for that life's character.
 */
export function gatherMapItems(app: App, proj: Project, scenes?: HubScene[]): TimelineItem[] {
  const lives = readLives(app, proj);
  const owner = new Map(lives.map((l) => [l.name, l.character]));
  const items: TimelineItem[] = [];

  for (const sc of scenes ?? readScenes(app, proj)) {
    const anchor = timelineAnchor(sc.anchor);
    const w = parseStoryDate(sc.storyDate, anchor);
    if (!w) continue;
    const who = [...(sc.pov ? [sc.pov] : []), ...(sc.characters ?? [])];
    for (const l of sc.lives ?? []) {
      const c = owner.get(l);
      if (c) who.push(c);
    }
    items.push({
      anchor,
      id: sc.path,
      path: sc.path,
      kind: "scene",
      label: sc.title,
      start: w.start,
      end: w.end,
      approx: w.approx,
      fuzz: w.fuzz,
      open: false,
      characters: [...new Set(who)],
      plotlines: sc.tags ?? [],
      locations: sc.location ?? [],
      lives: sc.lives ?? [],
      // with a whole series the book's name comes first, so Act 1 of book two is not Act 1 of book one
      book: sc.book ? `${sc.book} · ${actLabel(sc.act)}` : actLabel(sc.act),
      act: sc.book ? `${sc.book} · ${actLabel(sc.act)}` : String(sc.act),
      chapter: sc.chapter === undefined ? undefined : sc.book ? `${sc.book} · ${chapterLabel(sc.chapter)}` : String(sc.chapter),
      color: sc.color ?? null,
      detail: w.display,
    });
  }

  for (const f of app.vault.getMarkdownFiles()) {
    if (!f.path.startsWith(proj.layout.codex + "/")) continue;
    const fm = app.metadataCache.getFileCache(f)?.frontmatter;
    if (!fm) continue;
    const raw = fm.storyDate ?? fm.story_date;
    const anchor = timelineAnchor(proj.timelineStart);
    const w = parseStoryDate(raw, anchor);
    if (!w) continue;
    const type = String(fm.type ?? "note");
    const isLife = type === "life";
    // a life, or a note made from a sequence template: numbered, open-ended when it has no end, dragged with its neighbours
    const isSeq = isLife || (!!fm.template && !isSequenceOff(proj, String(fm.template)));
    items.push({
      anchor,
      id: f.path,
      path: f.path,
      kind: type,
      label: isLife && fm.lifeName ? String(fm.lifeName) : String(fm.name ?? f.basename),
      start: w.start,
      end: w.end,
      approx: w.approx,
      fuzz: w.fuzz,
      // a life with only a start date goes on to the end of the timeline
      open: isSeq && !String(raw).includes(".."),
      characters: isSeq ? linkList(fm.character) : type === "character" ? [f.basename] : linkList(fm.characters),
      plotlines: normTags(fm.tags),
      locations: type === "location" ? [f.basename] : linkList(fm.location ?? fm.locations),
      lives: isLife ? [f.basename] : linkList(fm.lives),
      seq: isSeq ? Number(fm.number ?? 0) || 0 : undefined,
      seqGroup: isSeq ? String(fm.sequence ?? `${type}/${linkList(fm.character)[0] ?? ""}`) : undefined,
      book: "",
      color: fm.color ? String(fm.color) : null,
      detail: w.display,
    });
  }

  const labels = getLabels(app, proj);
  const names = { act: (a: string) => actTitle(/^\d+$/.test(a) ? Number(a) : a, labels), chapter: (c: string) => chapterTitle(/^\d+$/.test(c) ? Number(c) : c, labels) };
  return [...items, ...deriveSpans(items, names)];
}
