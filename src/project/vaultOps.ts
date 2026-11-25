import { planArchive, planRestore } from "./archive";
import { sheetByName, type BeatSheet } from "./beats";
import type { LinkScene } from "./setupPayoff";
import { Marks, normTags, parsePlotlines, PlotlineFile, toggleTag, withMark, type Mark } from "./plotlines";
import { newSeries, orderBooks, parseSeries, seriesCodex, withBook, withoutBook, reconcileOrder, type SeriesInfo, type SeriesMeta } from "./series";
import { App, TAbstractFile, TFile, TFolder, normalizePath } from "obsidian";
import { applySummaryPatch, mergeSummaries, type SummarySource } from "./summaries";
import { setFolderWord, folderWordOf, compareScenes, planMove, positionInAct, unwrapLink, actFolderName, codexFm, emptySystemFile, isProject, isScene, layoutFor, applyLabels, applyStructure, buildModel, linkList, planInsertChapter, planMoveChapter, planSwapActs, swapLabels, readStructure, sameStructure, structureFor, withoutEmpties, type ChapterPlan, type Model, type SceneRef, type Structure, newProjectFm, readLabels, setLabel, parseNote, scenePath, scheduleRenames, planSplit, stringifyNote, SYSTEM_FILES, type Labels, type MoveOp, type ProjectLayout } from "./format";
import type { HubScene } from "./hubModel";
import { parseSnapshotName, noteName, projectNotePath, projectNoteText, snapshotFolder, snapshotPath } from "./notes";
import { builtinKinds, customKinds, entryFm, WorldKind } from "./world";
import { splitOnBreaks, type ImportPlan } from "./mdImport";
import { planRenumber, sceneName } from "./numbering";
import { nextLifeStart, sequenceOf, splitDate, type SeqLife } from "./lifeSequence";
import { timelineAnchor } from "../dates";
import { buildItem, isEnabled, LIFE_TEMPLATE, resolveStarts, type AnchorDate, type DateEdit, type NewItemOptions, type SeqItem, type SeqTemplate } from "./sequence";
import { checkSequences, type SeqFinding } from "./sequenceCheck";
import { applyDateEdits, itemFromFm, type ApplyResult } from "./sequenceApply";
import { matterFileName, matterPlan, nextMatterIndex, reorderMatterNames, sortMatter, swapMatterNames, type MatterNote, type MatterPosition } from "./matter";
import { allProfiles, DEFAULT_PROFILE, levelName, profileById, statusesFor, type Level, type Profile } from "../profiles/profile";
import { folderWordFor, hasMiddleLevel, hasTopLevel, inferLevels, levelsToFm, makeLevel, MAX_LEVELS, parseLevels, presetNames, withLevels } from "../profiles/structure";
import { wordsFor } from "../profiles/words";
import { checkVersion, PROJECT_FORMAT_VERSION, type VersionReport } from "./projectVersion";
import type { AliasEntry } from "../codex/aliases";
import { buildIndex, indexTerms } from "../export/bookIndex";
import { blankCodexProps, blankSceneProps } from "./inspectorModel";

/** Obsidian-facing half of the project layer. Reads use the metadata cache; writes go through the vault. */

export interface Project {
  name: string;
  file: TFile;
  layout: ProjectLayout;
  bookId?: string;
  /** set when the book belongs to a series; its Codex is then the series' shared one */
  series?: SeriesInfo;
  /** where this book's timeline starts: the date that Day 1, Week 1 and Year 1 mean */
  timelineStart?: string;
  /** scenes are numbered across the whole book: "Scene 3 - Title" */
  numberScenes?: boolean;
  /** the optional setup and payoff tracking (marks on plotlines, links between scenes, their checks) is switched on */
  setupPayoff?: boolean;
  /** Bible verse detection and insertion in this book; unset follows its kind of book */
  scripture?: boolean;
  /** characters and places found in a scene are added to its properties as you write; unset follows the plugin setting */
  detectNames?: boolean;
  /** the Codex categories (by id, such as characters) whose aliases are suggested while writing and checked for duplicates */
  aliasKinds?: string[];
  /** the id of the book's profile (its kind of book); Fiction when the project note does not say */
  profile: string;
  /** the book's own levels and their names, when it set them instead of using its kind's */
  levels?: Level[];
  /** the format the project note was saved in (see projectVersion.ts); undefined for a book saved before there was one */
  formatVersion?: number;
}

/** The book's profile with its own structure applied: use this, not profileById, wherever level names or tiers matter. */
export function profileFor(p: Pick<Project, "profile" | "levels">): Profile {
  return withLevels(profileById(allProfiles(), p.profile), p.levels);
}

const today = () => new Date().toISOString().split("T")[0];

export function findProjects(app: App): Project[] {
  const out: Project[] = [];
  for (const file of app.vault.getMarkdownFiles()) {
    const fm = app.metadataCache.getFileCache(file)?.frontmatter;
    if (!fm || !isProject(fm)) continue;
    const base = file.parent?.path ?? "";
    // the project note is named after its folder; anything else is not a project note
    if (file.basename !== base.split("/").pop()) continue;
    const root = base.includes("/") ? base.slice(0, base.lastIndexOf("/")) : "";
    const layout = layoutFor(root, file.basename);
    const inSeries = !!(fm.seriesId || fm.seriesUuid) || !!app.vault.getFileByPath(normalizePath(`${root}/series.json`));
    const series = inSeries && root ? { name: root.split("/").pop() ?? root, folder: root } : undefined;
    if (series) Object.assign(layout, seriesCodex(root));
    setFolderWord(layout.scenes, folderWordFor(parseLevels(fm.structure)));
    out.push({ name: file.basename, file, layout, bookId: fm.bookId, series, timelineStart: textOf(fm.timeline_start), setupPayoff: fm.setup_payoff === true, scripture: typeof fm.scripture === "boolean" ? fm.scripture : undefined, detectNames: typeof fm.detect_names === "boolean" ? fm.detect_names : undefined, aliasKinds: Array.isArray(fm.alias_suggest) ? fm.alias_suggest.map(String) : undefined, numberScenes: fm.numberScenes === true, profile: typeof fm.profile === "string" && fm.profile.trim() ? fm.profile.trim() : DEFAULT_PROFILE, levels: parseLevels(fm.structure) ?? undefined, formatVersion: typeof fm.formatVersion === "number" ? fm.formatVersion : undefined });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function under(path: string, folder: string): boolean {
  return path.startsWith(folder + "/");
}

const textOf = (v: unknown): string | undefined => (v === undefined || v === null || String(v).trim() === "" ? undefined : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).trim());
const numOf = (v: unknown): number | undefined => (v === undefined || v === null || v === "" || Number.isNaN(Number(v)) ? undefined : Number(v));

/** Word counts the stats tracker keeps up to date as notes change (the `wordcount` property is written only for imported scenes; a new scene has none, since 0 would just be wrong later). */
let liveCounts: Record<string, number> | null = null;
export function useWordCounts(counts: Record<string, number> | null) {
  liveCounts = counts;
}

export function readScenes(app: App, p: Project): HubScene[] {
  const out: HubScene[] = [];
  for (const f of app.vault.getMarkdownFiles()) {
    if (!under(f.path, p.layout.scenes)) continue;
    const fm = app.metadataCache.getFileCache(f)?.frontmatter;
    if (!fm || !isScene(fm)) continue;
    out.push({
      path: f.path,
      title: String(fm.title ?? f.basename),
      act: fm.act ?? 1,
      chapter: fm.chapter,
      sequence: Number(fm.sequence ?? 0),
      status: String(fm.status ?? "idea"),
      words: liveCounts?.[f.path] ?? Number(fm.wordcount ?? 0),
      pov: fm.pov ? linkList(fm.pov)[0] : undefined,
      characters: linkList(fm.characters),
      location: linkList(fm.location),
      tags: normTags(fm.tags),
      storyDate: textOf(fm.storyDate ?? fm.story_date),
      storyTime: textOf(fm.storyTime ?? fm.story_time),
      chronologicalOrder: numOf(fm.chronologicalOrder ?? fm.chronological_order),
      timelineMode: fm.timeline_mode ? String(fm.timeline_mode) : undefined,
      lives: linkList(fm.lives),
      color: fm.color ? String(fm.color) : undefined,
      setup: linkList(fm.setup_scenes),
      payoff: linkList(fm.payoff_scenes),
      beat: textOf(fm.beat),
      beatsheet: textOf(fm.beatsheet),
      synopsis: textOf(fm.synopsis),
      aiShort: textOf(fm.summary_ai_short),
      ownSummary: textOf(fm.summary) ?? textOf(fm.synopsis),
      description: textOf(fm.description),
      aiFull: textOf(fm.summary_ai),
      plotSetup: normTags(fm.plotline_setup),
      plotPayoff: normTags(fm.plotline_payoff),
      anchor: p.timelineStart,
    });
  }
  return out;
}

/** Move a whole project folder (links to its notes are updated by Obsidian). Returns the project at its new place. */
export async function moveProject(app: App, p: Project, to: string): Promise<Project> {
  const folder = app.vault.getFolderByPath(p.layout.base);
  if (!folder) throw new Error(`“${p.layout.base}” was not found.`);
  const parent = to.includes("/") ? to.slice(0, to.lastIndexOf("/")) : "";
  if (parent) await ensureFolder(app, parent);
  await app.fileManager.renameFile(folder, normalizePath(to));
  const moved = findProjects(app).find((q) => q.layout.base === normalizePath(to));
  if (!moved) throw new Error("The project moved, but could not be found afterwards.");
  return moved;
}

/**
 * Put a book into a series (`target` is the series folder), or take it out to stand alone (`target` null; it goes
 * next to the series folder). A book coming from a standalone place brings its own Codex entries into the shared one;
 * entries whose names are already taken stay behind and are counted.
 */
export async function changeSeries(app: App, p: Project, target: string | null): Promise<{ project: Project; codexMoved: number; codexLeft: number }> {
  const base = p.layout.base;
  const name = p.name;
  let dest: string;
  let meta: SeriesMeta | null = null;
  let codexMoved = 0;
  let codexLeft = 0;
  if (target) {
    meta = await readSeries(app, target);
    if (!meta) throw new Error(`“${target}” is not a series (it has no series.json).`);
    if (p.series?.folder === target) throw new Error("The book is already in that series.");
    dest = normalizePath(`${target}/${name}`);
  } else {
    if (!p.series) throw new Error("The book is not in a series.");
    const parent = p.series.folder.includes("/") ? p.series.folder.slice(0, p.series.folder.lastIndexOf("/")) : "";
    dest = normalizePath(parent ? `${parent}/${name}` : name);
  }
  if (app.vault.getAbstractFileByPath(dest)) throw new Error(`“${dest}” already exists.`);

  // a standalone book's own Codex joins the series' shared one before the folder moves
  if (target && !p.series) {
    const shared = seriesCodex(target).codex;
    const own = `${base}/Codex/`;
    for (const f of app.vault.getFiles().filter((x) => x.path.startsWith(own))) {
      const to = normalizePath(`${shared}/${f.path.slice(own.length)}`);
      if (app.vault.getAbstractFileByPath(to)) {
        codexLeft++;
        continue;
      }
      await ensureFolder(app, to.slice(0, to.lastIndexOf("/")));
      await app.fileManager.renameFile(f, to);
      codexMoved++;
    }
  }

  const old = p.series ? await readSeries(app, p.series.folder) : null;
  const moved = await moveProject(app, p, dest);
  await app.fileManager.processFrontMatter(moved.file, (fm) => {
    if (target && meta) {
      fm.seriesId = target.split("/").pop();
      if (meta.seriesUuid) fm.seriesUuid = meta.seriesUuid;
    } else {
      delete fm.seriesId;
      delete fm.seriesUuid;
    }
  });
  if (old && p.series) await writeSeries(app, p.series.folder, withoutBook(old, name, p.bookId));
  if (target && meta) await writeSeries(app, target, withBook(meta, name, p.bookId ?? moved.bookId ?? ""));
  if (!target) for (const f of ["Codex", "Codex/Characters", "Codex/Locations"]) await ensureFolder(app, `${dest}/${f}`);
  const project = findProjects(app).find((q) => q.layout.base === dest) ?? moved;
  return { project, codexMoved, codexLeft };
}

/** Set (or, empty, clear) where the book's timeline starts. */
export async function setTimelineStart(app: App, p: Project, text: string): Promise<void> {
  await app.fileManager.processFrontMatter(p.file, (fm) => {
    if (text.trim()) fm.timeline_start = text.trim();
    else delete fm.timeline_start;
  });
}

/** Switch the optional setup and payoff tracking on or off. Nothing already written is removed. */
export async function setSetupPayoff(app: App, p: Project, on: boolean): Promise<void> {
  await app.fileManager.processFrontMatter(p.file, (fm) => {
    if (on) fm.setup_payoff = true;
    else delete fm.setup_payoff;
  });
}

/** Whether verses are detected and written out in a book: its own choice, else whether its kind of book is a ministry one. */
export const scriptureOn = (p: Project | null | undefined): boolean => (p ? p.scripture ?? profileFor(p).features.scripture : true);

export async function setScripture(app: App, p: Project, on: boolean): Promise<void> {
  p.scripture = on;
  await app.fileManager.processFrontMatter(p.file, (fm) => {
    fm.scripture = on;
  });
}

export async function setDetectNames(app: App, p: Project, on: boolean): Promise<void> {
  p.detectNames = on;
  await app.fileManager.processFrontMatter(p.file, (fm) => {
    fm.detect_names = on;
  });
}

export const aliasSuggestOn = (p: Project, kindId: string): boolean => !!p.aliasKinds?.includes(kindId);

export async function setAliasSuggest(app: App, p: Project, kindId: string, on: boolean): Promise<void> {
  const set = new Set(p.aliasKinds ?? []);
  if (on) set.add(kindId);
  else set.delete(kindId);
  p.aliasKinds = [...set];
  await app.fileManager.processFrontMatter(p.file, (fm) => {
    if (set.size) fm.alias_suggest = [...set];
    else delete fm.alias_suggest;
  });
}

/** Every note of the categories that suggest aliases, with the names it goes by. */
export function aliasEntries(app: App, p: Project): AliasEntry[] {
  const out: AliasEntry[] = [];
  for (const k of worldKinds(app, p)) {
    if (!aliasSuggestOn(p, k.id)) continue;
    for (const f of worldEntries(app, p, k)) {
      const fm = app.metadataCache.getFileCache(f)?.frontmatter ?? {};
      const raw = Array.isArray(fm.aliases) ? fm.aliases : typeof fm.aliases === "string" ? [fm.aliases] : [];
      out.push({ path: f.path, name: String(fm.name ?? f.basename), aliases: raw.map(String).filter((a) => a.trim()), kind: k.id });
    }
  }
  return out;
}

/** Give a Codex note a new name: the file is renamed (links to it follow) and its name property, if it has one. */
export async function renameWorldEntry(app: App, f: TFile, name: string): Promise<void> {
  const clean = name.replace(/[\\/:*?"<>|]/g, "-").trim();
  if (!clean) throw new Error("That name is not allowed.");
  if (clean === f.basename) return;
  const folder = f.parent?.path ?? "";
  const path = normalizePath(`${folder}/${clean}.md`);
  if (app.vault.getAbstractFileByPath(path)) throw new Error(`“${clean}” already exists.`);
  const old = f.basename;
  await app.fileManager.renameFile(f, path);
  await app.fileManager.processFrontMatter(f, (fm) => {
    if (fm.name === undefined || String(fm.name) === old) fm.name = clean;
  });
}

/** The book a note belongs to, if any. */
export const projectOfPath = (app: App, path: string): Project | undefined => findProjects(app).find((p) => path.startsWith(`${p.file.parent?.path}/`));

// ------------------------------------------------------------ series

export async function readSeries(app: App, folder: string): Promise<SeriesMeta | null> {
  const f = app.vault.getFileByPath(normalizePath(`${folder}/series.json`));
  if (!f) return null;
  try {
    return parseSeries(JSON.parse((await app.vault.cachedRead(f)).replace(/^\uFEFF/, "") || "null"));
  } catch {
    return null;
  }
}

export async function writeSeries(app: App, folder: string, meta: SeriesMeta): Promise<void> {
  const path = normalizePath(`${folder}/series.json`);
  const text = JSON.stringify(meta, null, 2);
  const f = app.vault.getFileByPath(path);
  if (f) await app.vault.modify(f, text);
  else await app.vault.create(path, text);
}

/** Series folders found among the projects, in name order. */
export function listSeries(projects: Project[]): SeriesInfo[] {
  const by = new Map<string, SeriesInfo>();
  for (const p of projects) if (p.series) by.set(p.series.folder, p.series);
  return [...by.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Every book of the project's series in the series' reading order; just the project itself when it stands alone. */
export async function seriesBooks(app: App, p: Project): Promise<Project[]> {
  if (!p.series) return [p];
  const meta = await readSeries(app, p.series.folder);
  const books = findProjects(app).filter((b) => b.series?.folder === p.series!.folder);
  return orderBooks(books, meta?.bookOrder ?? []);
}

/** Scenes of the book, or of the whole series with each scene tagged by its book (books in series order, scenes in reading order within each). */
export async function readScopeScenes(app: App, p: Project, scope: "book" | "series"): Promise<HubScene[]> {
  if (scope === "book" || !p.series) return readScenes(app, p).sort(compareScenes);
  const out: HubScene[] = [];
  for (const b of await seriesBooks(app, p)) out.push(...readScenes(app, b).sort(compareScenes).map((s) => ({ ...s, book: b.name })));
  return out;
}

/** The plotline colours and notes of the book, or of every book in the series (the open book wins when two disagree). */
export async function readScopePlotlines(app: App, p: Project, scope: "book" | "series"): Promise<PlotlineFile> {
  const own = await readPlotlines(app, p);
  if (scope === "book" || !p.series) return own;
  const merged = parsePlotlines(own);
  for (const b of await seriesBooks(app, p)) {
    if (b === p || b.file.path === p.file.path) continue;
    const d = await readPlotlines(app, b);
    for (const [k, v] of Object.entries(d.tagColors)) if (!(k in merged.tagColors)) merged.tagColors[k] = v;
    for (const [k, v] of Object.entries(d.plotlineDescriptions)) if (!(k in merged.plotlineDescriptions)) merged.plotlineDescriptions[k] = v;
  }
  return merged;
}

export function codexFiles(app: App, p: Project, kind: "characters" | "locations"): TFile[] {
  const folder = p.layout[kind];
  return app.vault.getMarkdownFiles().filter((f) => under(f.path, folder)).sort((a, b) => a.basename.localeCompare(b.basename));
}

async function ensureFolder(app: App, path: string) {
  const p = normalizePath(path);
  if (!app.vault.getFolderByPath(p)) await app.vault.createFolder(p);
}

const cleanName = (name: string) => name.replace(/[\\/:*?"<>|]/g, "-").trim();

/**
 * A new book. With `series`, it goes inside that series: an existing one (`{ folder }`) or a new one (`{ newName }`), and
 * uses the series' shared Codex.
 */
export async function createProject(app: App, root: string, name: string, series?: { folder?: string; newName?: string }, timelineStart?: string, profileId: string = DEFAULT_PROFILE, extras: { citationStyle?: string; starterChapters?: number; levels?: Level[]; firstActName?: string } = {}): Promise<Project> {
  const kind = profileById(allProfiles(), profileId);
  const own = extras.levels && extras.levels.length ? extras.levels : kind.levels;
  const profile = withLevels(kind, own);
  // scenes are numbered across a book only in fiction, where the last level is the scene
  const numbered = profile.levels[profile.levels.length - 1].id === "scene";
  const clean = cleanName(name);
  if (!clean) throw new Error("That name is not allowed.");
  let seriesFolder = series?.folder;
  let meta: SeriesMeta | null = null;
  if (series?.newName !== undefined && !seriesFolder) {
    const sName = cleanName(series.newName);
    if (!sName) throw new Error("That series name is not allowed.");
    if (sName.toLowerCase() === clean.toLowerCase()) throw new Error(`The series and its book cannot share the name “${sName}”. Add “Series” to the series name, for example.`);
    seriesFolder = normalizePath(root ? `${root}/${sName}` : sName);
    if (app.vault.getAbstractFileByPath(seriesFolder)) throw new Error(`“${seriesFolder}” already exists.`);
    if (root) await ensureFolder(app, root);
    await ensureFolder(app, seriesFolder);
    meta = newSeries(series.newName.trim(), crypto.randomUUID(), today());
  } else if (seriesFolder) {
    meta = await readSeries(app, seriesFolder);
    if (!meta) meta = newSeries(seriesFolder.split("/").pop() ?? "Series", crypto.randomUUID(), today());
  }
  const l = layoutFor(seriesFolder ?? root, clean);
  if (app.vault.getAbstractFileByPath(l.base)) throw new Error(`“${l.base}” already exists.`);
  if (seriesFolder) Object.assign(l, seriesCodex(seriesFolder));
  else if (root) await ensureFolder(app, root);
  for (const f of [l.base, l.scenes, l.notes, l.archive, l.research, l.codex, l.characters, l.locations, l.system]) await ensureFolder(app, f);
  const bookId = crypto.randomUUID();
  const fm: Record<string, any> = { ...newProjectFm(clean, bookId, today(), "en", seriesFolder && meta ? { id: seriesFolder.split("/").pop() ?? "", uuid: meta.seriesUuid } : undefined, timelineStart?.trim() || undefined, profile.id, extras.citationStyle && extras.citationStyle !== profile.citationStyle ? extras.citationStyle : undefined), numberScenes: numbered, formatVersion: PROJECT_FORMAT_VERSION, ...(own ? { structure: levelsToFm(own) } : {}) };
  const file = await app.vault.create(l.projectFile, stringifyNote(fm, "\n"));
  for (const s of SYSTEM_FILES) await app.vault.create(`${l.system}/${s}`, JSON.stringify(emptySystemFile(s), null, 2));
  if (seriesFolder && meta) await writeSeries(app, seriesFolder, withBook(meta, clean, bookId));
  const made: Project = { name: clean, file, layout: l, bookId, formatVersion: PROJECT_FORMAT_VERSION, numberScenes: numbered, profile: profile.id, levels: own, series: seriesFolder ? { name: seriesFolder.split("/").pop() ?? "", folder: seriesFolder } : undefined, timelineStart: timelineStart?.trim() || undefined };
  setFolderWord(l.scenes, folderWordFor(profile.levels));
  for (const m of matterPlan(profile.frontMatter, profile.backMatter)) await createMatter(app, made, m.position, m.title);
  const word = levelName(profile, profile.levels.length - 1);
  let existing: HubScene[] = [];
  for (let i = 0; i < Math.min(Math.max(Math.floor(extras.starterChapters ?? 0), 0), 60); i++) {
    // in a two-level book the entries share the first part; in a three-level one each chapter gets a first section
    const first = i === 0 || profile.levels.length > 2;
    await createSceneNamed(app, made, { title: `${word} ${profile.levels.length > 2 ? 1 : i + 1}`, act: 1, chapter: first ? 0 : existing[0]?.chapter ?? 1, newChapter: first }, existing);
    existing = readScenes(app, made);
  }
  if (extras.firstActName?.trim() && profile.levels.length >= 2) await updateLabels(app, made, (lb) => setLabel(lb, "act", 1, extras.firstActName!.trim()));
  return made;
}

// ---------------------------------------------------------------- front and back matter

/** The front and back matter notes of a book, front first. */
export function readMatter(app: App, p: Project): MatterNote[] {
  const out: MatterNote[] = [];
  for (const f of app.vault.getMarkdownFiles()) {
    if (!under(f.path, p.layout.matter)) continue;
    const fm = app.metadataCache.getFileCache(f)?.frontmatter;
    if (fm?.type !== "matter") continue;
    out.push({ position: fm.position === "back" ? "back" : "front", title: String(fm.title ?? f.basename), path: f.path, enabled: fm.enabled !== false });
  }
  return sortMatter(out);
}

export async function createMatter(app: App, p: Project, position: MatterPosition, title: string): Promise<TFile> {
  const clean = title.trim();
  if (!clean) throw new Error("That name is not allowed.");
  const folder = `${p.layout.matter}/${position === "front" ? "Front" : "Back"}`;
  await ensureFolder(app, p.layout.matter);
  await ensureFolder(app, folder);
  const names = app.vault.getMarkdownFiles().filter((f) => under(f.path, folder)).map((f) => f.name);
  const path = normalizePath(`${folder}/${matterFileName(nextMatterIndex(names), clean)}`);
  if (app.vault.getAbstractFileByPath(path)) throw new Error(`“${clean}” already exists.`);
  return app.vault.create(path, stringifyNote({ type: "matter", position, title: clean, created: today() }, "\n"));
}

/** Move a front or back matter page one place earlier or later among the pages beside it. */
export async function moveMatter(app: App, p: Project, path: string, dir: -1 | 1): Promise<void> {
  const list = readMatter(app, p);
  const i = list.findIndex((n) => n.path === path);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length || list[j].position !== list[i].position) return;
  const dirOf = (x: string) => x.slice(0, x.lastIndexOf("/"));
  const nameOf = (x: string) => x.slice(x.lastIndexOf("/") + 1);
  const swapped = swapMatterNames(nameOf(list[i].path), nameOf(list[j].path));
  if (!swapped) throw new Error("These pages have no numbers in their file names, so they cannot be reordered.");
  const fa = app.vault.getFileByPath(list[i].path);
  const fb = app.vault.getFileByPath(list[j].path);
  if (!fa || !fb) return;
  await app.fileManager.renameFile(fa, normalizePath(`${dirOf(list[i].path)}/${swapped[0]}`));
  await app.fileManager.renameFile(fb, normalizePath(`${dirOf(list[j].path)}/${swapped[1]}`));
}

/** Move a front or back matter page to a place among the pages of its section (`to` is its final index there). One pass of renames. */
export async function moveMatterTo(app: App, p: Project, path: string, to: number): Promise<void> {
  const all = readMatter(app, p);
  const me = all.find((n) => n.path === path);
  if (!me) return;
  const list = all.filter((n) => n.position === me.position);
  const nameOf = (x: string) => x.slice(x.lastIndexOf("/") + 1);
  const dirOf = (x: string) => x.slice(0, x.lastIndexOf("/"));
  const plan = reorderMatterNames(list.map((n) => nameOf(n.path)), list.findIndex((n) => n.path === path), to);
  if (plan === null) throw new Error("These pages have no numbers in their file names, so they cannot be reordered.");
  const dir = dirOf(list[0].path);
  // files are looked up by their file name before any rename, so each step still finds its page
  const files = plan.map((r) => ({ f: app.vault.getFileByPath(normalizePath(`${dir}/${r.from}`)), to: r.to }));
  for (const x of files) if (x.f) await app.fileManager.renameFile(x.f, normalizePath(`${dir}/${x.to}`));
}

/** Switch a front or back matter page on or off. Off keeps the page but leaves it out of the export and the checks. */
export async function setMatterEnabled(app: App, path: string, on: boolean): Promise<void> {
  const f = app.vault.getFileByPath(path);
  if (!f) return;
  await app.fileManager.processFrontMatter(f, (fm) => {
    if (on) delete fm.enabled;
    else fm.enabled = false;
  });
}

/** Rename a matter page: its title, and its file name (keeping the number that orders it). */
export async function renameMatter(app: App, path: string, title: string): Promise<void> {
  const name = title.trim().replace(/[\\/:*?"<>|#^\[\]]/g, "");
  const f = app.vault.getFileByPath(path);
  if (!f || !name) throw new Error("That name is not allowed.");
  await app.fileManager.processFrontMatter(f, (fm) => void (fm.title = name));
  const prefix = /^(\d+)\s/.exec(f.name)?.[1];
  const to = normalizePath(`${f.parent?.path ?? ""}/${prefix ? `${prefix} ` : ""}${name}.md`);
  if (to !== f.path && !app.vault.getAbstractFileByPath(to)) await app.fileManager.renameFile(f, to);
}

/** Delete a matter page (to Obsidian's trash). */
export async function deleteMatter(app: App, path: string): Promise<void> {
  const f = app.vault.getFileByPath(path);
  if (f) await app.fileManager.trashFile(f);
}

/** "Scene 12": the next number in the book, for a scene that has not been named. */
export function defaultSectionTitle(scenes: HubScene[], _act?: number | string, _chapter?: number | string, word = "Scene"): string {
  return `${word} ${scenes.length + 1}`;
}

export async function createScene(app: App, p: Project, input: { title: string; act: number | string; chapter: number | string }, existing: HubScene[]): Promise<TFile> {
  const inAct = existing.filter((s) => String(s.act) === String(input.act));
  const sequence = inAct.reduce((m, s) => Math.max(m, s.sequence), 0) + 1;
  const title = input.title.trim() || defaultSectionTitle(existing, input.act, input.chapter, levelName(profileFor(p), 99));
  let path = scenePath(p.layout.scenes, input.act, sequence, title);
  for (let n = 1; app.vault.getAbstractFileByPath(path); n++) path = path.replace(/( \(\d+\))?\.md$/, ` (${n}).md`);
  await ensureFolder(app, path.slice(0, path.lastIndexOf("/")));
  const d = today();
  const fm = { type: "scene", title, act: input.act, chapter: input.chapter, sequence, status: statusesFor(p.profile)[0], ...blankSceneProps(), created: d, modified: d };
  return app.vault.create(path, stringifyNote(fm, ""));
}

export async function createCodex(app: App, p: Project, kind: "character" | "location", name: string): Promise<TFile> {
  const clean = name.replace(/[\\/:*?"<>|]/g, "-").trim();
  if (!clean) throw new Error("That name is not allowed.");
  const folder = kind === "character" ? p.layout.characters : p.layout.locations;
  await ensureFolder(app, folder);
  const path = `${folder}/${clean}.md`;
  if (app.vault.getAbstractFileByPath(path)) throw new Error(`“${clean}” already exists.`);
  return app.vault.create(path, stringifyNote(codexFm(kind, clean, today(), blankCodexProps(kind === "character" ? "character" : "location")), ""));
}

/** Words in a note's body, for notes that have not been counted yet. */
export async function countWords(app: App, f: TFile): Promise<number> {
  const { body } = parseNote(await app.vault.cachedRead(f));
  const t = body.trim();
  return t ? t.split(/\s+/).length : 0;
}

/**
 * Carry out the moves planMove produced: rename files into their new act folder and sequence prefix,
 * then write act, chapter and sequence into each scene's frontmatter. Renames go in an order that never
 * lands on a live file.
 */
export async function applyMoves(app: App, ops: MoveOp[]): Promise<void> {
  const byFrom = new Map(ops.map((o) => [o.from, o]));
  const finalOf = new Map<string, string>();
  for (const step of scheduleRenames(ops)) {
    const file = app.vault.getFileByPath(step.from);
    if (!file) throw new Error(`Scene not found: ${step.from}`);
    await ensureFolder(app, step.to.slice(0, step.to.lastIndexOf("/")));
    await app.fileManager.renameFile(file, step.to);
  }
  for (const o of ops) finalOf.set(o.from, o.to);
  for (const [from, o] of byFrom) {
    const file = app.vault.getFileByPath(finalOf.get(from) ?? o.to);
    if (!file) continue;
    await app.fileManager.processFrontMatter(file, (fm) => {
      Object.assign(fm, o.patch);
      fm.modified = today();
    });
  }
}

/** Make the scenes folder match the acts: every act has its "Act N" folder, and empty folders of acts that no longer exist go away. */
export async function syncActFolders(app: App, p: Project, acts: number[]): Promise<void> {
  const root = p.layout.scenes;
  if (!app.vault.getFolderByPath(root)) return;
  const word = folderWordOf(root);
  const keep = new Set(word ? acts.map((a) => actFolderName(a, word)) : []);
  for (const name of keep) {
    const path = normalizePath(`${root}/${name}`);
    if (!app.vault.getAbstractFileByPath(path)) await app.vault.createFolder(path);
  }
  const folder = app.vault.getFolderByPath(root);
  for (const c of [...(folder?.children ?? [])]) if ("children" in c && (c as any).children.length === 0 && !keep.has(c.name)) await app.fileManager.trashFile(c);
}

export function getLabels(app: App, p: Project): Labels {
  return readLabels(app.metadataCache.getFileCache(p.file)?.frontmatter);
}

/** Change act/chapter names in the project note's properties (where they are kept). */
export async function updateLabels(app: App, p: Project, change: (l: Labels) => Labels): Promise<void> {
  await app.fileManager.processFrontMatter(p.file, (fm) => applyLabels(fm, change(readLabels(fm))));
}

export function toRefs(scenes: HubScene[]): SceneRef[] {
  return scenes.map((s) => ({ path: s.path, title: s.title, act: s.act, chapter: s.chapter, sequence: s.sequence }));
}

export function getStructure(app: App, p: Project): Structure {
  return readStructure(app.metadataCache.getFileCache(p.file)?.frontmatter);
}

export function getModel(app: App, p: Project, scenes: HubScene[]): Model {
  return buildModel(toRefs(scenes), getStructure(app, p));
}

export async function saveStructure(app: App, p: Project, st: Structure): Promise<void> {
  await app.fileManager.processFrontMatter(p.file, (fm) => applyStructure(fm, st));
}

/** Make sure every act and chapter that exists (even an empty one) is remembered in the project note. */
export async function syncStructure(app: App, p: Project, scenes: HubScene[]): Promise<boolean> {
  const model = getModel(app, p, scenes);
  const want = structureFor(toRefs(scenes), model);
  if (sameStructure(getStructure(app, p), want)) return false;
  await saveStructure(app, p, want);
  return true;
}

/** Notes inside the book's Scenes folder that Booker does not list because they are not marked as scenes (no front matter, or another type). */
export function findStrayNotes(app: App, p: Project): TFile[] {
  return app.vault.getMarkdownFiles().filter((f) => {
    if (!under(f.path, p.layout.scenes)) return false;
    const fm = app.metadataCache.getFileCache(f)?.frontmatter;
    return !fm || !isScene(fm);
  });
}

/** Work out where a stray note sat from its folder ("Act 2") and file name ("02-05 Title"). Pure. */
export function strayPlace(scenesRoot: string, path: string): { act: number; sequence?: number; title: string } {
  const rel = path.startsWith(`${scenesRoot}/`) ? path.slice(scenesRoot.length + 1) : path;
  const parts = rel.split("/");
  const file = parts.pop() ?? "";
  const act = parts.length ? parseInt(/(\d+)\s*$/.exec(parts[0])?.[1] ?? "", 10) : NaN;
  const named = /^(\d+)-(\d+)\s+(.*)\.md$/.exec(file);
  const title = (named ? named[3] : file.replace(/\.md$/i, "")).trim() || "Untitled";
  return { act: Number.isFinite(act) ? act : named ? Number(named[1]) || 1 : 1, sequence: named ? Number(named[2]) || undefined : undefined, title };
}

/** Mark stray notes as scenes so they show in the book, in the act their folder says, after the scenes already there. */
export async function adoptStrayNotes(app: App, p: Project, files: TFile[]): Promise<number> {
  const scenes = readScenes(app, p);
  const next = new Map<number, number>();
  for (const s of scenes) next.set(Number(s.act), Math.max(next.get(Number(s.act)) ?? 0, s.sequence));
  const d = today();
  let n = 0;
  for (const f of files) {
    const at = strayPlace(p.layout.scenes, f.path);
    const sequence = (next.get(at.act) ?? 0) + 1;
    next.set(at.act, sequence);
    await app.fileManager.processFrontMatter(f, (fm) => {
      fm.type = "scene";
      fm.title ??= at.title;
      fm.act = at.act;
      fm.sequence = sequence;
      fm.status ??= statusesFor(p.profile)[0];
      fm.created ??= d;
      fm.modified = d;
    });
    n++;
  }
  await new Promise((r) => window.setTimeout(r, 400));
  await syncStructureAfter(app, p);
  return n;
}

/** Chapters and acts that have no scene (the ones the board shows as empty columns). */
export function emptyStructure(app: App, p: Project, scenes: HubScene[]): { chapters: number[]; acts: number[] } {
  const refs = toRefs(scenes);
  const have = structureFor(refs, getModel(app, p, scenes));
  return { chapters: have.emptyChapters, acts: have.emptyActs };
}

/** Forget every empty chapter and act, keeping only what has scenes. Returns how many were dropped. */
export async function pruneEmptyStructure(app: App, p: Project, scenes: HubScene[]): Promise<number> {
  const gone = emptyStructure(app, p, scenes);
  const refs = toRefs(scenes);
  const next = structureFor(refs, buildModel(refs, withoutEmpties(getStructure(app, p))));
  await saveStructure(app, p, next);
  await syncActFolders(app, p, next.acts).catch(() => undefined);
  return gone.chapters.length + gone.acts.length;
}

/** The scenes as they will be once these moves are done. */
export function afterMoves(scenes: SceneRef[], ops: MoveOp[]): SceneRef[] {
  const by = new Map(ops.map((o) => [o.from, o]));
  return scenes.map((s) => {
    const o = by.get(s.path);
    return o ? { ...s, path: o.to, act: o.patch.act ?? s.act, chapter: o.patch.chapter ?? s.chapter, sequence: o.patch.sequence } : s;
  });
}

/** Rename a scene: its title property, and its file name so the two agree. */
export async function renameScene(app: App, p: Project, path: string, title: string): Promise<void> {
  const name = title.trim();
  const file = app.vault.getFileByPath(path);
  const scene = readScenes(app, p).find((s) => s.path === path);
  if (!file || !scene || !name) return;
  await app.fileManager.processFrontMatter(file, (fm) => {
    fm.title = name;
    fm.modified = today();
  });
  let to = scenePath(p.layout.scenes, scene.act, scene.sequence, name);
  for (let n = 1; to !== path && app.vault.getAbstractFileByPath(to); n++) to = to.replace(/( \(\d+\))?\.md$/, ` (${n}).md`);
  if (to !== path) await app.fileManager.renameFile(file, to);
}

/** Move act `a` into the place of act `b` by swapping it with its neighbours one step at a time. */
export async function moveActTo(app: App, p: Project, a: number, b: number): Promise<void> {
  let cur = a;
  for (let guard = 0; cur !== b && guard < 200; guard++) {
    const scenes = readScenes(app, p);
    const acts = getModel(app, p, scenes).acts;
    const i = acts.indexOf(cur);
    const next = acts[i + (b > cur ? 1 : -1)];
    if (i < 0 || next === undefined) return;
    await swapActs(app, p, scenes, cur, next);
    cur = next;
  }
}

/** Swap two acts: scenes, names and the act of any empty chapters all go with them. */
export async function swapActs(app: App, p: Project, scenes: HubScene[], a: number, b: number): Promise<void> {
  const refs = toRefs(scenes);
  const model = getModel(app, p, scenes);
  const labelsBefore = getLabels(app, p);
  await applyMoves(app, planSwapActs(refs, a, b, p.layout.scenes));
  const ops = planSwapActs(refs, a, b, p.layout.scenes);
  const swapAct = (x: number) => (x === a ? b : x === b ? a : x);
  const next: Model = { acts: model.acts, chapters: model.chapters.map((c) => ({ num: c.num, act: swapAct(c.act) })) };
  await app.fileManager.processFrontMatter(p.file, (fm) => {
    applyLabels(fm, swapLabels(readLabels(fm), "act", a, b));
    applyStructure(fm, structureFor(afterMoves(refs, ops), next));
  });
  await syncActFolders(app, p, model.acts);
  // chapter numbers run through the whole book, so number them again in the new order
  const after = afterMoves(refs, ops);
  const order = [...next.chapters].sort((x, y) => x.act - y.act || x.num - y.num);
  const last = order[order.length - 1];
  if (last) {
    const plan = planMoveChapter(after, next, swapLabels(labelsBefore, "act", a, b), last.num, last.act, null, p.layout.scenes);
    if (plan && plan.ops.length) await applyChapterPlan(app, p, after as unknown as HubScene[], plan);
  }
}

/** Carry out a chapter plan: files, then names, then the remembered structure. */
export async function applyChapterPlan(app: App, p: Project, scenes: HubScene[], plan: ChapterPlan): Promise<void> {
  await applyMoves(app, plan.ops);
  await app.fileManager.processFrontMatter(p.file, (fm) => {
    applyLabels(fm, plan.labels);
    // the scenes have moved: only chapters without scenes need an act on record
    applyStructure(fm, structureFor(afterMoves(toRefs(scenes), plan.ops), plan.model));
  });
  await syncActFolders(app, p, plan.model.acts);
}

/** Split a scene: a new scene holding `body` goes right after it (same act and chapter). Returns the new scene's file. */
export async function splitScene(app: App, p: Project, path: string, title: string, body: string): Promise<TFile> {
  const scenes = readScenes(app, p);
  const here = scenes.find((s) => s.path === path);
  const name = title.trim() || (here ? defaultSectionTitle(scenes, here.act, here.chapter, levelName(profileFor(p), 99)) : levelName(profileFor(p), 99));
  const plan = planSplit(toRefs(scenes), path, name, p.layout.scenes);
  if (!plan) throw new Error("This note is not a scene of the project.");
  await applyMoves(app, plan.ops);
  let newPath = plan.newPath;
  for (let n = 1; app.vault.getAbstractFileByPath(newPath); n++) newPath = plan.newPath.replace(/\.md$/, ` (${n}).md`);
  const d = today();
  const fm = { type: "scene", title: name, act: plan.act, chapter: plan.chapter, sequence: plan.newSequence, status: statusesFor(p.profile)[0], ...blankSceneProps(), created: d, modified: d };
  await ensureFolder(app, newPath.slice(0, newPath.lastIndexOf("/")));
  return app.vault.create(newPath, stringifyNote(fm, body.replace(/^\s+/, "")));
}

/** Add an empty chapter to an act (renumbering later chapters so numbers still ascend). Returns its number. */
export async function addChapter(app: App, p: Project, scenes: HubScene[], act: number, name: string, after?: number | string): Promise<number> {
  const plan = planInsertChapter(toRefs(scenes), getModel(app, p, scenes), getLabels(app, p), act, name, p.layout.scenes, after);
  if (!plan) throw new Error("Could not add the chapter.");
  await applyChapterPlan(app, p, scenes, plan);
  return plan.num;
}

/** Add an empty act (Prologue is act 0). */
export async function addAct(app: App, p: Project, scenes: HubScene[], act: number, name: string): Promise<void> {
  const model = getModel(app, p, scenes);
  if (model.acts.includes(act)) throw new Error(`Act ${act} already exists.`);
  await app.fileManager.processFrontMatter(p.file, (fm) => {
    const st = structureFor(toRefs(scenes), { ...model, acts: [...model.acts, act].sort((a, b) => a - b) });
    applyStructure(fm, st);
    if (name.trim()) applyLabels(fm, setLabel(readLabels(fm), "act", act, name));
  });
  await syncActFolders(app, p, [...model.acts, act]);
}

/** Forget an empty act or chapter. */
export async function removeEmpty(app: App, p: Project, scenes: HubScene[], kind: "act" | "chapter", key: number): Promise<void> {
  const model = getModel(app, p, scenes);
  const next: Model =
    kind === "act"
      ? { acts: model.acts.filter((a) => a !== key), chapters: model.chapters }
      : { acts: model.acts, chapters: model.chapters.filter((c) => c.num !== key) };
  await app.fileManager.processFrontMatter(p.file, (fm) => {
    applyStructure(fm, structureFor(toRefs(scenes), next));
    applyLabels(fm, setLabel(readLabels(fm), kind, key, ""));
  });
  await syncActFolders(app, p, next.acts);
}

/** Create a scene; a "new chapter" is added through the same numbering logic as the board, and typed names are saved. */
export async function createSceneNamed(
  app: App,
  p: Project,
  c: { title: string; act: number | string; chapter: number | string; newChapter?: boolean; actName?: string; chapterName?: string },
  existing: HubScene[],
  /** put the new chapter after this chapter, or the new scene after this scene, when it lands beside it */
  near?: { chapter?: number | string; scene?: string }
): Promise<TFile> {
  let chapter = c.chapter;
  let scenes = existing;
  if (c.actName) await updateLabels(app, p, (l) => setLabel(l, "act", c.act, c.actName!));
  if (c.newChapter && typeof c.act === "number") {
    chapter = await addChapter(app, p, existing, c.act, c.chapterName ?? "", near?.chapter);
    // the files have moved: read them again so the new scene numbers against the real state
    scenes = readScenes(app, p);
  } else if (c.chapterName) {
    await updateLabels(app, p, (l) => setLabel(l, "chapter", chapter, c.chapterName!));
  }
  const file = await createScene(app, p, { title: c.title, act: c.act, chapter }, scenes);
  const anchor = near?.scene && !c.newChapter ? scenes.find((s) => s.path === near.scene) : undefined;
  const beside = anchor && String(anchor.act) === String(c.act) && String(anchor.chapter ?? "") === String(chapter);
  if (beside || (c.newChapter && near?.chapter !== undefined)) {
    // the scene was added at the end of its act: move it into its chapter, just after the scene you were last working in
    // a new note is not in the metadata cache for a moment
    for (let i = 0; i < 40 && !readScenes(app, p).some((s) => s.path === file.path); i++) await new Promise((r) => window.setTimeout(r, 50));
    const refs = toRefs(readScenes(app, p));
    const column = refs.filter((s) => s.path !== file.path && String(s.act) === String(c.act) && String(s.chapter ?? "") === String(chapter)).sort(compareScenes);
    const index = beside ? column.findIndex((s) => s.path === anchor!.path) + 1 : 0;
    const ops = planMove(refs, file.path, { act: c.act, chapter, position: positionInAct(refs, file.path, c.act, chapter, index) }, p.layout.scenes);
    if (ops.length) await applyMoves(app, ops);
  }
  return file;
}

// ---------------------------------------------------------------- world kinds

/** Built-in kinds plus any folder you added inside Codex. */
export function worldKinds(app: App, p: Project): WorldKind[] {
  const codex = app.vault.getFolderByPath(p.layout.codex);
  const names = (codex?.children ?? []).filter((c) => "children" in c).map((c) => c.name);
  const kinds = builtinKinds(p.layout, profileById(allProfiles(), p.profile).worldKinds);
  const known = new Set(kinds.map((k) => k.folder.split("/").pop()!.toLowerCase()));
  return [...kinds, ...customKinds(p.layout, names).filter((k) => !known.has(k.folder.split("/").pop()!.toLowerCase()))];
}

export function worldEntries(app: App, p: Project, kind: WorldKind): TFile[] {
  return app.vault
    .getMarkdownFiles()
    .filter((f) => under(f.path, kind.folder))
    .sort((a, b) => a.basename.localeCompare(b.basename));
}

export async function createWorldEntry(app: App, p: Project, kind: WorldKind, name: string): Promise<TFile> {
  const clean = name.replace(/[\\/:*?"<>|]/g, "-").trim();
  if (!clean) throw new Error("That name is not allowed.");
  await ensureFolder(app, kind.folder);
  const path = normalizePath(`${kind.folder}/${clean}.md`);
  if (app.vault.getAbstractFileByPath(path)) throw new Error(`“${clean}” already exists.`);
  return app.vault.create(path, stringifyNote(entryFm(kind, clean, today()), ""));
}

/** A new category of your own: a folder in Codex, which every kind of note is stored in. */
export async function createWorldCategory(app: App, p: Project, label: string): Promise<WorldKind> {
  const clean = label.replace(/[\\/:*?"<>|]/g, "-").trim();
  if (!clean) throw new Error("That name is not allowed.");
  if (worldKinds(app, p).some((k) => k.label.toLowerCase() === clean.toLowerCase())) throw new Error(`“${clean}” already exists.`);
  await ensureFolder(app, `${p.layout.codex}/${clean}`);
  return worldKinds(app, p).find((k) => k.label === clean)!;
}

/** A dated event in the book's Codex (`Codex/Events/<name>.md`, type event), so it appears on the timeline map. Returns the note. */
export async function createEventNote(app: App, p: Project, name: string, date: string, body: string, source?: string): Promise<TFile> {
  const clean = name.replace(/[\\/:*?"<>|]/g, "-").trim();
  if (!clean) throw new Error("That name is not allowed.");
  const dir = `${p.layout.codex}/Events`;
  await ensureFolder(app, dir);
  let path = normalizePath(`${dir}/${clean}.md`);
  for (let n = 2; app.vault.getAbstractFileByPath(path); n++) path = normalizePath(`${dir}/${clean} (${n}).md`);
  const d = today();
  const fm: Record<string, unknown> = { type: "event", name: clean, storyDate: date, created: d, modified: d, ...(source ? { source } : {}) };
  return app.vault.create(path, stringifyNote(fm, `\n${body}`));
}

// ------------------------------------------------------------------ plotlines

const plotlinesPath = (p: Project) => normalizePath(`${p.layout.system}/plotlines.json`);

export async function readPlotlines(app: App, p: Project): Promise<PlotlineFile> {
  const f = app.vault.getFileByPath(plotlinesPath(p));
  if (!f) return parsePlotlines(null);
  try {
    return parsePlotlines(JSON.parse((await app.vault.cachedRead(f)).replace(/^\uFEFF/, "") || "{}"));
  } catch {
    return parsePlotlines(null);
  }
}

export async function writePlotlines(app: App, p: Project, data: PlotlineFile): Promise<void> {
  const text = JSON.stringify(data, null, 2);
  const f = app.vault.getFileByPath(plotlinesPath(p));
  if (f) await app.vault.modify(f, text);
  else {
    if (!app.vault.getFolderByPath(p.layout.system)) await app.vault.createFolder(p.layout.system);
    await app.vault.create(plotlinesPath(p), text);
  }
}

/** Add or remove one tag on a scene note. */
export async function toggleSceneTag(app: App, path: string, tag: string): Promise<void> {
  const f = app.vault.getFileByPath(path);
  if (!f) return;
  await app.fileManager.processFrontMatter(f, (fm) => {
    fm.tags = toggleTag(normTags(fm.tags), tag);
  });
}

/** Set what a scene is to one plotline: off, a plain station, a setup or a payoff. Saved on the scene, so the map and the note always agree. */
export async function setPlotMark(app: App, path: string, tag: string, mark: Mark): Promise<void> {
  const f = app.vault.getFileByPath(path);
  if (!f) return;
  await app.fileManager.processFrontMatter(f, (fm) => {
    const cur: Marks = { tags: normTags(fm.tags), setup: normTags(fm.plotline_setup), payoff: normTags(fm.plotline_payoff) };
    const next = withMark(cur, tag, mark);
    fm.tags = next.tags;
    if (next.setup.length) fm.plotline_setup = next.setup;
    else delete fm.plotline_setup;
    if (next.payoff.length) fm.plotline_payoff = next.payoff;
    else delete fm.plotline_payoff;
  });
}

/** Set (or, with null, remove) properties on scene notes in one pass each. */
export async function setSceneFields(app: App, path: string, fields: Record<string, string | number | null>): Promise<void> {
  const f = app.vault.getFileByPath(path);
  if (!f) return;
  await app.fileManager.processFrontMatter(f, (fm) => {
    for (const [k, v] of Object.entries(fields)) {
      if (v === null || v === "") delete fm[k];
      else fm[k] = v;
    }
  });
}

// ------------------------------------------------------------ Booker's own system files

/** A JSON file in the project's System folder that only Booker uses (other tools ignore it). */
export async function readSystemJson(app: App, p: Project, name: string): Promise<unknown> {
  const f = app.vault.getFileByPath(normalizePath(`${p.layout.system}/${name}`));
  if (!f) return null;
  try {
    return JSON.parse((await app.vault.cachedRead(f)).replace(/^\uFEFF/, "") || "null");
  } catch {
    return null;
  }
}

export async function writeSystemJson(app: App, p: Project, name: string, data: unknown): Promise<void> {
  const path = normalizePath(`${p.layout.system}/${name}`);
  const text = JSON.stringify(data, null, 2);
  const f = app.vault.getFileByPath(path);
  if (f) await app.vault.modify(f, text);
  else {
    if (!app.vault.getFolderByPath(p.layout.system)) await app.vault.createFolder(p.layout.system);
    await app.vault.create(path, text);
  }
}

// ------------------------------------------------------------------- lives

function toSeq(l: Life): SeqLife {
  const [when, whenEnd] = splitDate(l.dates);
  return { path: l.file.path, character: l.character, seq: l.number, when: when ?? "", whenEnd: whenEnd ?? "" };
}
export { toSeq as lifeToSeq };

export interface Life {
  file: TFile;
  name: string;
  character: string;
  /** sequence number; 0 when the life floats free of any sequence */
  number: number;
  lifeName?: string;
  /** the dates as written, such as 1342-05-01..1342-05-10 */
  dates: string;
}

/** Life notes: a codex note with `type: life` and a `character` link. */
export function readLives(app: App, p: Project): Life[] {
  const out: Life[] = [];
  for (const f of app.vault.getMarkdownFiles()) {
    if (!under(f.path, p.layout.codex)) continue;
    const fm = app.metadataCache.getFileCache(f)?.frontmatter;
    if (fm?.type !== "life") continue;
    out.push({ file: f, name: f.basename, character: linkList(fm.character)[0] ?? "", number: Number(fm.number ?? 0) || 0, lifeName: fm.lifeName ? String(fm.lifeName) : undefined, dates: String(fm.storyDate ?? fm.story_date ?? "") });
  }
  return out.sort((a, b) => a.character.localeCompare(b.character) || (a.number || 1e9) - (b.number || 1e9) || a.name.localeCompare(b.name));
}

/**
 * Add a life to a character: `Codex/Lives/<Character> <n>.md`. In a sequence (the default) it is numbered after the lives the
 * character already has and starts three days after the last one ends; a free life has no number and no dates until you give them.
 */
export async function createLife(app: App, p: Project, character: string, lifeName = "", inSequence = true): Promise<TFile> {
  const lives = readLives(app, p).filter((l) => l.character === character);
  const count = lives.reduce((m, l) => Math.max(m, l.number), 0) + 1;
  const number = inSequence ? count : 0;
  const clean = (lifeName.trim() || (inSequence ? `${character} ${count}` : `${character} (free)`)).replace(/[\\/:*?"<>|]/g, "-");
  const folder = `${p.layout.codex}/Lives`;
  await ensureFolder(app, folder);
  let path = normalizePath(`${folder}/${clean}.md`);
  for (let n = 2; app.vault.getAbstractFileByPath(path); n++) path = normalizePath(`${folder}/${clean} (${n}).md`);
  const d = today();
  const fm: Record<string, any> = { type: "life", name: clean, ...blankCodexProps("life"), character: `[[${character}]]`, number: inSequence ? number : "", created: d, modified: d };
  if (lifeName.trim()) fm.lifeName = lifeName.trim();
  if (inSequence) {
    const prev = sequenceOf(lives.map(toSeq), character).pop();
    if (prev) {
      const start = nextLifeStart(prev.when, prev.whenEnd, timelineAnchor(p.timelineStart));
      if (start) fm.storyDate = start;
    }
  }
  return app.vault.create(path, stringifyNote(fm, ""));
}

// ------------------------------------------------------------ sequences (generalised lives)

/** Ids of switched-off templates per project (by its System folder), kept so synchronous code like the timeline can ask. */
const switchedOff = new Map<string, Set<string>>();
export const isSequenceOff = (p: Project, id: string): boolean => switchedOff.get(p.layout.system)?.has(id) ?? false;

/** Sequence templates: the built-in Life plus any saved in System/templates.json (a saved one with the same id wins). */
export async function readTemplates(app: App, p: Project): Promise<SeqTemplate[]> {
  const data = (await readSystemJson(app, p, "templates.json")) as { templates?: SeqTemplate[] } | null;
  const saved = Array.isArray(data?.templates) ? data!.templates.filter((t) => t && typeof t.id === "string" && typeof t.type === "string") : [];
  const all = [...[LIFE_TEMPLATE].filter((b) => !saved.some((t) => t.id === b.id)), ...saved];
  switchedOff.set(p.layout.system, new Set(all.filter((t) => t.enabled === false).map((t) => t.id)));
  return all;
}

export async function writeTemplates(app: App, p: Project, templates: SeqTemplate[]): Promise<void> {
  await writeSystemJson(app, p, "templates.json", { templates: templates.filter((t) => t.id !== LIFE_TEMPLATE.id || JSON.stringify(t) !== JSON.stringify(LIFE_TEMPLATE)) });
  switchedOff.set(p.layout.system, new Set(templates.filter((t) => t.enabled === false).map((t) => t.id)));
}

/** The dates of a note that is not itself a sequence item (a scene, an event, a character): a single day counts as both its start and end. */
function plainDate(fm: Record<string, any>): AnchorDate {
  const [when, whenEnd] = splitDate(fm.storyDate ?? fm.story_date);
  return { when: when ?? "", whenEnd: whenEnd || when || "" };
}

/** Add an item from a template to a group (for example a character): `Codex/<folder>/<name>.md`. */
export async function createFromTemplate(app: App, p: Project, tpl: SeqTemplate, group: string, label = "", inSequence = true, opts: NewItemOptions = {}): Promise<TFile> {
  const { items } = await sequenceItems(app, p);
  const mine = items.filter((i) => i.group === `${tpl.id}/${group}`);
  const count = mine.reduce((m, i) => Math.max(m, i.seq), 0) + 1;
  // other templates carry their name ("Ann Era 1") so they never share a note name with a life ("Ann 1")
  const who = tpl.id === "life" ? group || tpl.label : `${group ? group + " " : ""}${tpl.label}`;
  const base = (label.trim() || (inSequence && tpl.sequential ? `${who} ${count}` : `${who} (free)`)).replace(/[\\/:*?"<>|]/g, "-");
  const folder = `${p.layout.codex}/${tpl.folder}`;
  await ensureFolder(app, folder);
  let path = normalizePath(`${folder}/${base}.md`);
  for (let n = 2; app.vault.getAbstractFileByPath(path); n++) path = normalizePath(`${folder}/${base} (${n}).md`);
  let anchorDate: AnchorDate | undefined;
  if (opts.anchor) {
    const af = app.metadataCache.getFirstLinkpathDest(opts.anchor, "");
    const raw = af && app.metadataCache.getFileCache(af)?.frontmatter;
    if (raw) {
      const [when, whenEnd] = splitDate(raw.storyDate ?? raw.story_date);
      // a sequence item with no end is open-ended; anything else with one day is a point
      anchorDate = raw.template || raw.type === "life" ? { when: when ?? "", whenEnd: whenEnd ?? "" } : plainDate(raw);
    }
  }
  const { fm } = buildItem(tpl, group, items, base, inSequence, today(), { ...opts, anchorDate });
  return app.vault.create(path, stringifyNote({ ...fm, ...(label.trim() && tpl.id === "life" ? { lifeName: label.trim() } : {}), aliases: [], description: "", color: "" }, ""));
}

/** Templated notes of the project as sequence items, with the template each belongs to. */
async function sequenceItems(app: App, p: Project) {
  const templates = (await readTemplates(app, p)).filter(isEnabled);
  const byType = new Map(templates.map((t) => [t.type, t]));
  const byId = new Map(templates.map((t) => [t.id, t]));
  const resolve = (name: string) => app.metadataCache.getFirstLinkpathDest(name, "")?.path;
  const items: SeqItem[] = [];
  for (const f of app.vault.getMarkdownFiles()) {
    if (!under(f.path, p.layout.codex)) continue;
    const fm = app.metadataCache.getFileCache(f)?.frontmatter;
    // a note belongs to a template by the mark conversion writes, or by its type
    if (fm && (byId.has(String(fm.template)) || byType.has(String(fm.type)))) items.push(itemFromFm(f.path, fm, resolve));
  }
  return { items, templates };
}

export interface KindSequence {
  sequential: boolean;
  defaultGap: string;
  anchorKinds: SeqTemplate["anchorKinds"];
  /** false keeps everything but switches the sequence off */
  enabled?: boolean;
}

/** The sequence template a Codex category has been made into, if any (switched on or off). */
export const templateOfKind = (templates: SeqTemplate[], kind: WorldKind): SeqTemplate | undefined => templates.find((t) => t.type === kind.type);

/**
 * Make a Codex category a sequence (its notes can be numbered, dated and linked in time) or change its settings, including
 * switching it off (`enabled: false`), which keeps the settings, the marks on its notes and their dates but stops it following,
 * repairing or being checked. The template is saved in System/templates.json and the category's notes are marked with it, so the
 * timeline and the checks see them. Returns how many notes were newly marked.
 */
export async function setKindSequence(app: App, p: Project, kind: WorldKind, s: KindSequence): Promise<number> {
  const all = await readTemplates(app, p);
  const id = kind.type;
  const rest = all.filter((t) => t.type !== kind.type && t.id !== LIFE_TEMPLATE.id);
  const cur = all.find((t) => t.type === kind.type);
  if (id === LIFE_TEMPLATE.id) {
    // Lives are always on
    await writeTemplates(app, p, [...rest, { ...(cur ?? LIFE_TEMPLATE), sequential: s.sequential, defaultGap: s.defaultGap, anchorKinds: s.anchorKinds }]);
    return 0;
  }
  const folder = kind.folder.startsWith(`${p.layout.codex}/`) ? kind.folder.slice(p.layout.codex.length + 1) : kind.folder;
  await writeTemplates(app, p, [...rest, { id, label: kind.label, folder, type: kind.type, sequential: s.sequential, defaultGap: s.defaultGap, anchorKinds: s.anchorKinds, ...(s.enabled === false ? { enabled: false } : {}) }]);
  let n = 0;
  if (s.enabled !== false)
    for (const f of worldEntries(app, p, kind))
      await app.fileManager.processFrontMatter(f, (fm) => {
        if (!fm.template) {
          fm.template = id;
          n++;
        }
      });
  return n;
}

/** Take a category out of being a sequence altogether: its template is deleted and the mark is taken off its notes (their dates and links stay). Lives cannot be removed. */
export async function removeKindSequence(app: App, p: Project, kind: WorldKind): Promise<number> {
  if (kind.type === LIFE_TEMPLATE.id) return 0;
  const all = await readTemplates(app, p);
  await writeTemplates(app, p, all.filter((t) => t.type !== kind.type && t.id !== LIFE_TEMPLATE.id));
  let n = 0;
  for (const f of worldEntries(app, p, kind))
    await app.fileManager.processFrontMatter(f, (fm) => {
      if (fm.template === kind.type) {
        delete fm.template;
        n++;
      }
    });
  return n;
}

/** Names offered in the new-item dialog: every note in the book (for anchors) and the characters (for whose sequence). */
export function sequenceChoices(app: App, p: Project): { notes: string[]; characters: string[] } {
  const notes: string[] = [];
  const characters: string[] = [];
  for (const f of app.vault.getMarkdownFiles()) {
    if (!under(f.path, p.layout.base) || f.path === p.file.path) continue;
    notes.push(f.basename);
    if (under(f.path, p.layout.characters)) characters.push(f.basename);
  }
  return { notes: notes.sort(), characters: characters.sort() };
}

export interface SequenceReport {
  findings: SeqFinding[];
  edits: DateEdit[];
  /** the items as read, for the write guard */
  base: Map<string, SeqItem>;
}

/** Read every templated note in the project and work out what is wrong and what would fix it. Writes nothing. */
export async function sequenceReport(app: App, p: Project): Promise<SequenceReport> {
  const templates = (await readTemplates(app, p)).filter(isEnabled);
  const byType = new Map(templates.map((t) => [t.type, t]));
  const byId = new Map(templates.map((t) => [t.id, t]));
  const resolve = (name: string) => app.metadataCache.getFirstLinkpathDest(name, "")?.path;
  const items: SeqItem[] = [];
  const tplOf = new Map<string, SeqTemplate>();
  const external = new Map<string, AnchorDate>();
  for (const f of app.vault.getMarkdownFiles()) {
    if (!under(f.path, p.layout.base)) continue;
    const fm = app.metadataCache.getFileCache(f)?.frontmatter;
    if (!fm) continue;
    const t = byId.get(String(fm.template)) ?? byType.get(String(fm.type));
    if (t && under(f.path, p.layout.codex)) {
      items.push(itemFromFm(f.path, fm, resolve));
      tplOf.set(f.path, t);
    } else if (fm.storyDate ?? fm.story_date) {
      external.set(f.path, plainDate(fm));
    }
  }
  // A character's anchor is their birth/death dates when the note has them; a bare character note resolves to nothing.
  const templateOf = (i: SeqItem) => tplOf.get(i.path);
  const findings = checkSequences(items, external, templateOf, (path) => !!app.vault.getFileByPath(path));
  const { edits } = resolveStarts(items, external, templateOf);
  return { findings, edits, base: new Map(items.map((i) => [i.path, i])) };
}

/** Apply the computed dates. All-or-nothing; notes edited in the meantime are skipped. Refuses to run while anchors form a loop. */
export async function repairSequences(app: App, p: Project): Promise<ApplyResult & { blocked?: string }> {
  const r = await sequenceReport(app, p);
  if (r.findings.some((f) => f.code === "cycle")) return { written: [], stale: [], blocked: "Anchors form a loop; fix those first." };
  return applyDateEdits(
    {
      read: async (path) => {
        const f = app.vault.getFileByPath(path);
        return f ? app.vault.read(f) : null;
      },
      write: async (path, text) => {
        const f = app.vault.getFileByPath(path);
        if (!f) throw new Error(`${path} is gone`);
        await app.vault.modify(f, text);
      },
    },
    r.edits,
    r.base,
  );
}

// ------------------------------------------------------- scene notes, notes, snapshots

async function ensureFolders(app: App, path: string) {
  let acc = "";
  for (const part of normalizePath(path).split("/")) {
    acc = acc ? `${acc}/${part}` : part;
    if (!app.vault.getFolderByPath(acc)) await app.vault.createFolder(acc);
  }
}

export function listProjectNotes(app: App, p: Project): TFile[] {
  const prefix = p.layout.notes + "/";
  return app.vault
    .getMarkdownFiles()
    .filter((f) => f.path.startsWith(prefix))
    .sort((a, b) => a.basename.localeCompare(b.basename));
}

export async function createProjectNote(app: App, p: Project, title: string): Promise<TFile> {
  if (!noteName(title)) throw new Error("That name is not allowed.");
  const path = projectNotePath(p.layout, title);
  if (app.vault.getAbstractFileByPath(path)) throw new Error(`“${noteName(title)}” already exists.`);
  await ensureFolders(app, p.layout.notes);
  return app.vault.create(path, projectNoteText(noteName(title), today()));
}

export interface Snapshot {
  file: TFile;
  when: Date;
  label: string;
}

/** Saved versions of a scene, newest first. */
export function listSnapshots(app: App, p: Project, sceneTitle: string): Snapshot[] {
  const prefix = snapshotFolder(p.layout, sceneTitle) + "/";
  const out: Snapshot[] = [];
  for (const file of app.vault.getMarkdownFiles()) {
    if (!file.path.startsWith(prefix)) continue;
    const parsed = parseSnapshotName(file.basename);
    if (parsed) out.push({ file, ...parsed });
  }
  return out.sort((a, b) => b.when.getTime() - a.when.getTime());
}

export async function takeSnapshot(app: App, p: Project, scene: TFile, sceneTitle: string, label = ""): Promise<TFile> {
  const text = await app.vault.read(scene);
  await ensureFolders(app, snapshotFolder(p.layout, sceneTitle));
  let when = new Date();
  let path = snapshotPath(p.layout, sceneTitle, when, label);
  // two snapshots in the same second: move the later one on
  while (app.vault.getAbstractFileByPath(path)) {
    when = new Date(when.getTime() + 1000);
    path = snapshotPath(p.layout, sceneTitle, when, label);
  }
  return app.vault.create(path, text);
}

/** Put a snapshot back as the scene. The current text is saved first, so a restore can itself be undone. */
export async function restoreSnapshot(app: App, p: Project, scene: TFile, sceneTitle: string, snap: TFile): Promise<void> {
  const text = await app.vault.read(snap);
  await takeSnapshot(app, p, scene, sceneTitle, "before restore");
  await app.vault.modify(scene, text);
}

// -------------------------------------------------------------- archive and restore

export interface Archived {
  file: TFile;
  title: string;
  act: number | string;
  chapter?: number | string;
  words: number;
}

/** Scenes taken out of the book, kept in the project's Archive folder. */
export function listArchived(app: App, p: Project): Archived[] {
  const out: Archived[] = [];
  for (const f of app.vault.getMarkdownFiles()) {
    if (!under(f.path, p.layout.archive)) continue;
    const fm = app.metadataCache.getFileCache(f)?.frontmatter;
    if (!fm || !isScene(fm)) continue;
    out.push({ file: f, title: String(fm.title ?? f.basename), act: fm.act ?? 1, chapter: fm.chapter, words: liveCounts?.[f.path] ?? Number(fm.wordcount ?? 0) });
  }
  return out.sort((a, b) => a.title.localeCompare(b.title));
}

/** Move a scene to Archive and close the gap it leaves. The scene keeps its act, chapter and text. */
export async function archiveScene(app: App, p: Project, scenes: HubScene[], path: string): Promise<string> {
  const plan = planArchive(toRefs(scenes), path, p.layout.scenes, p.layout.archive, (x) => !!app.vault.getAbstractFileByPath(x));
  const file = app.vault.getFileByPath(path);
  if (!plan || !file) throw new Error("Scene not found.");
  await ensureFolder(app, p.layout.archive);
  await app.fileManager.renameFile(file, plan.to);
  await applyMoves(app, plan.ops);
  await syncStructureAfter(app, p);
  return plan.to;
}

/** Delete a scene for good (to Obsidian's trash) and close the gap in the numbering. */
export async function deleteScene(app: App, p: Project, scenes: HubScene[], path: string): Promise<void> {
  const to = await archiveScene(app, p, scenes, path);
  const f = app.vault.getFileByPath(to);
  if (f) await app.fileManager.trashFile(f);
}

/** The scenes of a chapter in reading order. */
export function chapterScenes(scenes: HubScene[], act: number | string | undefined, chapter: number | string | undefined): HubScene[] {
  return scenes.filter((s) => String(s.act) === String(act) && String(s.chapter) === String(chapter)).sort((a, b) => compareScenes(a as any, b as any));
}

/** Add this scene's text to the end of the scene above it (in the same chapter), then remove it. Returns the scene it joined. */
export async function mergeWithAbove(app: App, p: Project, scenes: HubScene[], path: string): Promise<TFile> {
  const me = scenes.find((s) => s.path === path);
  if (!me) throw new Error("Scene not found.");
  const list = chapterScenes(scenes, me.act, me.chapter);
  const i = list.findIndex((s) => s.path === path);
  if (i < 1) throw new Error("There is no section above this one in the chapter.");
  const above = app.vault.getFileByPath(list[i - 1].path);
  const mine = app.vault.getFileByPath(path);
  if (!above || !mine) throw new Error("Scene not found.");
  const body = parseNote(await app.vault.read(mine)).body.trim();
  if (body) {
    const a = parseNote(await app.vault.read(above));
    await app.vault.modify(above, stringifyNote(a.fm, `${a.body.trimEnd()}\n\n${body}\n`));
  }
  await deleteScene(app, p, scenes, path);
  return above;
}

/** Make the item's title the chapter's name, and call the item "Scene N" (or the book's word) instead. */
export async function moveTitleToChapter(app: App, p: Project, scenes: HubScene[], path: string): Promise<void> {
  const me = scenes.find((s) => s.path === path);
  if (!me) throw new Error("Scene not found.");
  const word = levelName(profileFor(p), 99);
  await updateLabels(app, p, (l) => setLabel(l, "chapter", me.chapter ?? "", sceneName(me.title, word) || me.title));
  const n = chapterScenes(scenes, me.act, me.chapter).findIndex((s) => s.path === path) + 1;
  await setSceneFields(app, path, { title: `${word} ${n}` });
}

/** Put an archived scene back at the end of its chapter. */
export async function restoreScene(app: App, p: Project, scenes: HubScene[], a: Archived): Promise<void> {
  const fm = app.metadataCache.getFileCache(a.file)?.frontmatter ?? {};
  const ref = { path: a.file.path, title: a.title, act: a.act, chapter: a.chapter, sequence: Number(fm.sequence ?? 0) };
  const ops = planRestore(toRefs(scenes), ref, p.layout.scenes);
  await applyMoves(app, ops);
  await syncStructureAfter(app, p);
}

async function syncStructureAfter(app: App, p: Project) {
  const scenes = readScenes(app, p);
  await syncStructure(app, p, scenes).catch(() => undefined);
  await syncActFolders(app, p, getModel(app, p, scenes).acts).catch(() => undefined);
}

// --------------------------------------------------------- beat sheets, setup and payoff

/** The beat sheet a project follows (its name is kept in the project note as `activeBeatSheet`). */
export function activeSheet(app: App, p: Project): BeatSheet | undefined {
  return sheetByName(app.metadataCache.getFileCache(p.file)?.frontmatter?.activeBeatSheet);
}

/** Follow a beat sheet: name the acts after it and remember it. With `makeScenes`, add a chapter and a scene for every beat. */
export async function applyBeatSheet(app: App, p: Project, sheet: BeatSheet, makeScenes: boolean): Promise<number> {
  const acts = [...new Set(sheet.beats.map((b) => b.act))].sort((a, b) => a - b);
  for (const act of acts) {
    const scenes = readScenes(app, p);
    if (getModel(app, p, scenes).acts.includes(act)) await updateLabels(app, p, (l) => setLabel(l, "act", act, sheet.actLabels[act] ?? ""));
    else await addAct(app, p, scenes, act, sheet.actLabels[act] ?? "");
  }
  await app.fileManager.processFrontMatter(p.file, (fm) => {
    fm.activeBeatSheet = sheet.name;
  });
  if (!makeScenes) return 0;
  let made = 0;
  const have = new Set(readScenes(app, p).filter((s) => s.beatsheet === sheet.name && s.beat).map((s) => s.beat));
  for (const beat of sheet.beats) {
    if (have.has(beat.label)) continue;
    const f = await createSceneNamed(app, p, { title: beat.label, act: beat.act, chapter: 0, newChapter: true, chapterName: beat.label }, readScenes(app, p));
    await setSceneFields(app, f.path, { beatsheet: sheet.name, beat: beat.label, synopsis: beat.description });
    made++;
  }
  return made;
}

/** Scene titles for the setup and payoff lists, with their reading order. */
export function linkScenes(scenes: HubScene[]): LinkScene[] {
  const order = [...scenes].sort((a, b) => compareScenes(a as any, b as any));
  return order.map((s, i) => ({ path: s.path, title: s.title, order: i, payoff: s.payoff ?? [], setup: s.setup ?? [] }));
}

function editList(raw: unknown, title: string, on: boolean): string[] {
  const arr = (Array.isArray(raw) ? raw : raw == null || raw === "" ? [] : String(raw).split(",")).map(String);
  const wiki = arr.some((v) => v.trim().startsWith("[["));
  const rest = arr.filter((v) => unwrapLink(v) !== title);
  return on ? [...rest, wiki ? `[[${title}]]` : title] : rest;
}

/** Record a setup → payoff link on both scenes (or take it off both). */
export async function setLink(app: App, setupPath: string, payoffPath: string, on: boolean): Promise<void> {
  const a = app.vault.getFileByPath(setupPath);
  const c = app.vault.getFileByPath(payoffPath);
  if (!a || !c) throw new Error("Scene not found.");
  const title = (f: TFile) => String(app.metadataCache.getFileCache(f)?.frontmatter?.title ?? f.basename);
  const [ta, tc] = [title(a), title(c)];
  await app.fileManager.processFrontMatter(a, (fm) => {
    const list = editList(fm.payoff_scenes, tc, on);
    if (list.length) fm.payoff_scenes = list;
    else delete fm.payoff_scenes;
  });
  await app.fileManager.processFrontMatter(c, (fm) => {
    const list = editList(fm.setup_scenes, ta, on);
    if (list.length) fm.setup_scenes = list;
    else delete fm.setup_scenes;
  });
}


// ---------------------------------------------------------------- importing a manuscript

/**
 * Add a planned Markdown manuscript after what the project already has. Part/Act headings become new acts,
 * other headings become chapters named after them, and the text between breaks becomes "Scene N".
 * Chapters that come before any Part heading join the project's last act.
 */
export async function importMarkdownPlan(app: App, p: Project, plan: ImportPlan): Promise<{ chapters: number; sections: number }> {
  const scenes = readScenes(app, p);
  const model = getModel(app, p, scenes);
  let lastAct = Math.max(0, ...model.acts, ...scenes.map((s) => Number(s.act) || 0));
  let chapter = Math.max(0, ...model.chapters.map((c) => c.num), ...scenes.map((s) => Number(s.chapter) || 0));
  const seq = new Map<number, number>();
  for (const s of scenes) seq.set(Number(s.act), Math.max(seq.get(Number(s.act)) ?? 0, s.sequence));
  const fallbackAct = Math.max(1, lastAct);
  let labels = getLabels(app, p);
  const d = today();
  let chapters = 0;
  let sections = 0;
  const prof = profileFor(p);
  const hasTop = hasTopLevel(prof);
  const flat = !hasMiddleLevel(prof);
  const itemWord = levelName(prof, 99);
  // without a middle level, each imported chapter becomes one item and the items of an act share one hidden chapter
  const hidden = new Map<number, number>();
  for (const s of scenes) if (!hidden.has(Number(s.act)) && typeof s.chapter === "number") hidden.set(Number(s.act), s.chapter);
  const add = async (actNum: number, chapterNum: number, title: string, text: string) => {
    const sequence = (seq.get(actNum) ?? 0) + 1;
    seq.set(actNum, sequence);
    let path = scenePath(p.layout.scenes, actNum, sequence, title);
    for (let n = 1; app.vault.getAbstractFileByPath(path); n++) path = path.replace(/( \(\d+\))?\.md$/, ` (${n}).md`);
    await ensureFolder(app, path.slice(0, path.lastIndexOf("/")));
    const fm = { type: "scene", title, act: actNum, chapter: chapterNum, sequence, status: "draft", wordcount: text.split(/\s+/).length, charcount: text.length, created: d, modified: d };
    await app.vault.create(path, stringifyNote(fm, `${text}\n`));
    sections++;
  };
  for (const a of plan.acts) {
    let actNum = fallbackAct;
    if (a.title !== undefined && hasTop) {
      actNum = ++lastAct;
      labels = setLabel(labels, "act", actNum, a.title);
    }
    for (const c of a.chapters) {
      if (flat) {
        let ch = hidden.get(actNum);
        if (ch === undefined) {
          ch = ++chapter;
          hidden.set(actNum, ch);
        }
        chapters++;
        await add(actNum, ch, c.title || `${itemWord} ${chapters}`, c.sections.join("\n\n***\n\n"));
        continue;
      }
      chapter++;
      chapters++;
      labels = setLabel(labels, "chapter", chapter, c.title);
      for (let i = 0; i < c.sections.length; i++) await add(actNum, chapter, `${itemWord} ${i + 1}`, c.sections[i]);
    }
  }
  await updateLabels(app, p, () => labels);
  await new Promise((r) => setTimeout(r, 400));
  if (!scenes.length && app.metadataCache.getFileCache(p.file)?.frontmatter?.numberScenes === undefined) await setNumbering(app, p, true);
  else if (p.numberScenes) await renumberScenes(app, p);
  await syncStructure(app, p, readScenes(app, p));
  return { chapters, sections };
}

// ---------------------------------------------------------------- adopting an existing project folder

/** Folders in the vault that hold scene notes (a Scenes folder) but have no project note, so Booker does not list them yet. */
export function detectLooseProjects(app: App): string[] {
  const known = new Set(findProjects(app).map((p) => p.layout.base));
  const found = new Set<string>();
  for (const f of app.vault.getMarkdownFiles()) {
    const i = f.path.indexOf("/Scenes/");
    if (i < 1) continue;
    const fm = app.metadataCache.getFileCache(f)?.frontmatter;
    if (!fm || !isScene(fm)) continue;
    const base = f.path.slice(0, i);
    if (!known.has(base)) found.add(base);
  }
  return [...found].sort();
}

/**
 * Make an existing folder with a Scenes folder into a project: add the project note named after the folder and any
 * missing standard folders and System files. Nothing that is already there is changed.
 */
export async function adoptFolder(app: App, folder: string): Promise<Project> {
  const base = normalizePath(folder);
  const name = base.split("/").pop() ?? base;
  const root = base.includes("/") ? base.slice(0, base.lastIndexOf("/")) : "";
  const existing = findProjects(app).find((p) => p.layout.base === base);
  if (existing) return existing;
  const l = layoutFor(root, name);
  for (const f of [l.base, l.scenes, l.notes, l.archive, l.research, l.codex, l.characters, l.locations, l.system]) await ensureFolder(app, f);
  let file = app.vault.getFileByPath(l.projectFile);
  const bookId = crypto.randomUUID();
  if (!file) file = await app.vault.create(l.projectFile, stringifyNote(newProjectFm(name, bookId, today()), "\n"));
  else await app.fileManager.processFrontMatter(file, (fm) => Object.assign(fm, newProjectFm(name, bookId, today()), fm.title ? { title: fm.title } : {}));
  for (const s of SYSTEM_FILES) if (!app.vault.getAbstractFileByPath(`${l.system}/${s}`)) await app.vault.create(`${l.system}/${s}`, JSON.stringify(emptySystemFile(s), null, 2));
  await new Promise((r) => setTimeout(r, 400));
  const found = findProjects(app).find((p) => p.layout.base === base);
  if (!found) throw new Error("The folder was prepared, but could not be opened as a project.");
  await app.fileManager.processFrontMatter(found.file, (fm) => void (fm.formatVersion ??= PROJECT_FORMAT_VERSION));
  found.formatVersion ??= PROJECT_FORMAT_VERSION;
  if (!found.levels) {
    const levels = inferLevels(readScenes(app, found));
    if (levels) {
      await app.fileManager.processFrontMatter(found.file, (fm) => void (fm.structure = levelsToFm(levels)));
      found.levels = levels;
    }
  }
  return found;
}

/** What a copy-and-open import brought across, for the report shown afterwards. */
export interface CopyReport {
  from: string;
  to: string;
  files: number;
  scenes: number;
  codex: number;
  other: number;
  skipped: string[];
}

/** First folder name next to `base` that is free: "Name (copy)", "Name (copy 2)"… */
export function freeCopyName(exists: (path: string) => boolean, base: string): string {
  let out = `${base} (copy)`;
  for (let n = 2; exists(out); n++) out = `${base} (copy ${n})`;
  return out;
}

/**
 * Import a StoryLine folder as a new Booker project without touching the original: every file is copied into
 * a sibling folder, then the copy is made into a project. Returns the project and a report of what came across.
 */
export async function copyFolderAsProject(app: App, folder: string): Promise<{ project: Project; report: CopyReport }> {
  const base = normalizePath(folder);
  const src = app.vault.getFolderByPath(base);
  if (!src) throw new Error("That folder is not in the vault.");
  const root = base.includes("/") ? base.slice(0, base.lastIndexOf("/") + 1) : "";
  const name = base.split("/").pop() ?? base;
  const dest = root + freeCopyName((p) => !!app.vault.getAbstractFileByPath(p), name);
  const report: CopyReport = { from: base, to: dest, files: 0, scenes: 0, codex: 0, other: 0, skipped: [] };
  const walk = async (f: TAbstractFile) => {
    if (f instanceof TFolder) {
      await ensureFolder(app, dest + f.path.slice(base.length));
      for (const c of [...f.children]) await walk(c);
      return;
    }
    if (!(f instanceof TFile)) return;
    const to = dest + f.path.slice(base.length);
    try {
      await ensureFolder(app, to.slice(0, to.lastIndexOf("/")));
      await app.vault.createBinary(to, await app.vault.readBinary(f));
      report.files++;
      const rel = f.path.slice(base.length + 1);
      if (rel.startsWith("Scenes/")) report.scenes++;
      else if (rel.startsWith("Codex/")) report.codex++;
      else report.other++;
    } catch {
      report.skipped.push(f.path);
    }
  };
  await ensureFolder(app, dest);
  await walk(src);
  await new Promise((r) => setTimeout(r, 400));
  const copied = findProjects(app).find((p) => p.layout.base === dest);
  // a copied project note carries the original's book id; give the copy its own so the two stay separate
  if (copied) await app.fileManager.processFrontMatter(copied.file, (fm) => void (fm.bookId = crypto.randomUUID()));
  return { project: copied ?? (await adoptFolder(app, dest)), report };
}

// ---------------------------------------------------------------- scenes inside chapters, or merged into them

const pause = (ms: number) => new Promise((r) => window.setTimeout(r, ms));

/** Wait (briefly) until the metadata cache no longer lists a note at this path, so the next move plans from what is really there. */
async function settle(app: App, p: Project, gone: string) {
  for (let i = 0; i < 40 && readScenes(app, p).some((s) => s.path === gone); i++) await pause(50);
  await pause(60);
}

/** The level names a book can step to: fewer or more levels, with the new one named by its kind's usual names. */
export function levelsAfterResize(p: Project, count: number): Level[] {
  const cur = profileFor(p).levels;
  const n = Math.min(Math.max(count, 1), MAX_LEVELS);
  if (n === cur.length) return cur;
  if (n < cur.length) return n === 2 ? [cur[0], cur[1]] : n === 1 ? [cur[cur.length - 1]] : cur;
  const names = presetNames(p.profile, profileById(allProfiles(), p.profile).levels, n);
  if (n === 2) return [makeLevel(names[0]), cur[0]];
  return cur.length === 1 ? [makeLevel(names[0]), cur[0], makeLevel(names[2])] : [...cur, makeLevel(names[2])];
}

/** What changing the levels would do to the notes, for the confirmation: scenes merged away, or notes that would split at scene breaks. */
export async function previewLevels(app: App, p: Project, next: Level[], breakPattern?: string): Promise<{ merges: number; chapters: number; splits: number; scenes: number }> {
  const cur = profileFor(p).levels;
  const all = readScenes(app, p);
  let merges = 0;
  let chapters = 0;
  if (cur.length === 3 && next.length < 3) {
    const groups = new Set(all.map((s) => `${s.act}|${s.chapter ?? ""}`));
    chapters = groups.size;
    merges = all.length - groups.size;
  }
  let splits = 0;
  let scenes = 0;
  if (next.length === 3 && cur.length < 3) {
    for (const s of all) {
      const f = app.vault.getFileByPath(s.path);
      if (!f) continue;
      const n = splitOnBreaks(parseNote(await app.vault.read(f)).body, breakPattern).length;
      scenes += n;
      if (n > 1) splits++;
    }
  }
  return { merges, chapters, splits, scenes };
}

/** Write the book's levels and make the folders and numbering follow. */
async function writeLevels(app: App, p: Project, levels: Level[]) {
  await app.fileManager.processFrontMatter(p.file, (fm) => {
    fm.structure = levelsToFm(levels);
  });
  p.levels = levels;
  setFolderWord(p.layout.scenes, folderWordFor(levels));
  await relocateScenes(app, p);
  await pause(300);
  await finishStructureChange(app, p);
}

/** Move each scene file into the folder its act now has ("Part 1" after the top level is renamed, or straight into Scenes when there is no top level). */
async function relocateScenes(app: App, p: Project): Promise<void> {
  const root = p.layout.scenes;
  const word = folderWordOf(root);
  for (const s of readScenes(app, p)) {
    const dir = s.act === undefined || (s.act as unknown) === "" || !word ? root : normalizePath(`${root}/${actFolderName(s.act, word)}`);
    if (s.path.slice(0, s.path.lastIndexOf("/")) === dir) continue;
    const f = app.vault.getFileByPath(s.path);
    if (!f) continue;
    await ensureFolder(app, dir);
    await app.fileManager.renameFile(f, normalizePath(`${dir}/${f.name}`));
  }
}

/** Merge every chapter's scenes, in order, into the chapter's one note, with `sceneBreak` between them. The other scene notes go to Archive. */
async function mergeBottomLevel(app: App, p: Project, sceneBreak: string): Promise<{ merged: number; chapters: number }> {
  const now = profileFor(p).levels;
  let merged = 0;
  let chapters = 0;
  const midWord = now[1].singular;
  const labels = getLabels(app, p);
  const groups = new Map<string, HubScene[]>();
  for (const s of readScenes(app, p).sort((a, b) => compareScenes(a as any, b as any))) {
    const k = `${s.act}|${s.chapter ?? ""}`;
    groups.set(k, [...(groups.get(k) ?? []), s]);
  }
  // every note of an act ends up in the act's first chapter, which is hidden
  const hidden = new Map<string, number | string>();
  for (const g of groups.values()) {
    const key = String(g[0].act);
    const ch = g[0].chapter;
    if (!hidden.has(key) && ch !== undefined) hidden.set(key, ch);
  }
  // last chapter first: removing a note renumbers the notes after it, never the ones before
  const list = [...groups.values()];
  for (let gi = list.length - 1; gi >= 0; gi--) {
    const g = list[gi];
    const first = g[0];
    const file = app.vault.getFileByPath(first.path);
    if (!file) continue;
    chapters++;
    if (g.length > 1) {
      const parts: string[] = [];
      const sources: SummarySource[] = [];
      for (const s of g) {
        const f = app.vault.getFileByPath(s.path);
        if (!f) continue;
        const n = parseNote(await app.vault.read(f));
        parts.push(n.body.trim());
        // the summaries of every scene go with the merged note, not just the first one's
        sources.push({ title: String(n.fm.title ?? s.title), synopsis: textOf(n.fm.synopsis), summary: textOf(n.fm.summary), summaryAi: textOf(n.fm.summary_ai) });
      }
      const note = parseNote(await app.vault.read(file));
      const fm = applySummaryPatch(note.fm as Record<string, unknown>, mergeSummaries(sources)) as typeof note.fm;
      await app.vault.modify(file, stringifyNote(fm, `${parts.filter(Boolean).join(`\n\n${sceneBreak}\n\n`)}\n`));
      merged += g.length - 1;
      for (let i = g.length - 1; i >= 1; i--) {
        await deleteScene(app, p, readScenes(app, p), g[i].path);
        await settle(app, p, g[i].path);
      }
    }
    const named = first.chapter !== undefined ? labels.chapters[String(first.chapter)] : undefined;
    const title = named || (g.length > 1 || /^(scene|section)\b/i.test(first.title) ? `${midWord[0].toUpperCase()}${midWord.slice(1)} ${gi + 1}` : first.title);
    const hide = hidden.get(String(first.act));
    await setSceneFields(app, first.path, { title, ...(hide !== undefined ? { chapter: hide } : {}) });
    await pause(80);
    await renameScene(app, p, first.path, title);
    if (!app.vault.getFileByPath(first.path)) await settle(app, p, first.path);
  }
  await writeLevels(app, p, [now[0], now[1]]);
  return { merged, chapters };
}

/**
 * Give the book a scene level: every note becomes a chapter named after it, then each chapter is split into scenes at its scene-break lines
 * (`***`, `---`, `* * *`). A note with no break stays one scene.
 */
async function splitBottomLevel(app: App, p: Project, itemLevel: Level, breakPattern?: string): Promise<{ merged: number; chapters: number; scenes: number }> {
  const now = profileFor(p).levels;
  const scenes = readScenes(app, p).sort((a, b) => compareScenes(a as any, b as any));
  let num = 0;
  let labels = getLabels(app, p);
  const done: Array<{ path: string; chapter: number }> = [];
  for (const s of scenes) {
    num++;
    labels = setLabel(labels, "chapter", num, s.title);
    done.push({ path: s.path, chapter: num });
  }
  for (const d of done) await setSceneFields(app, d.path, { chapter: d.chapter });
  await app.fileManager.processFrontMatter(p.file, (fm) => {
    applyLabels(fm, labels);
  });
  await writeLevels(app, p, [now[0], now[1], itemLevel]);

  // split each chapter's note at its breaks; last note first so earlier paths stay put
  const present = async (path: string) => {
    for (let t = 0; t < 60 && !readScenes(app, p).some((s) => s.path === path); t++) await pause(50);
    await pause(60);
  };
  let made = 0;
  for (let i = done.length - 1; i >= 0; i--) {
    const cur = readScenes(app, p).find((s) => s.chapter === done[i].chapter && String(s.act) === String(scenes[i].act));
    // hold the file itself: its path changes as the notes after it are renumbered
    const file = cur && app.vault.getFileByPath(cur.path);
    if (!cur || !file) continue;
    const note = parseNote(await app.vault.read(file));
    const parts = splitOnBreaks(note.body, breakPattern);
    if (parts.length < 2) continue;
    // the new scenes first, last section first so each lands right after the original; the original is cut down only when all of them exist
    for (let k = parts.length - 1; k >= 1; k--) {
      await present(file.path);
      const created = await splitScene(app, p, file.path, "", parts[k]);
      made++;
      await present(created.path);
    }
    await app.vault.modify(file, stringifyNote(note.fm, `${parts[0]}\n`));
  }
  if (made) await finishStructureChange(app, p);
  return { merged: 0, chapters: done.length, scenes: done.length + made };
}

/**
 * Change a book's levels: their names, and how many there are (1 to 3).
 * Fewer levels merge a chapter's scenes into one note (3 to 2) or hide the top level (2 to 1; the acts stay on the notes).
 * More levels split each note into scenes at its scene breaks (2 to 3) or add a top level holding everything (1 to 2).
 */
export async function setLevels(app: App, p: Project, next: Level[], opts: { sceneBreak?: string; breakPattern?: string } = {}): Promise<{ merged: number; chapters: number; scenes: number }> {
  const target = next.slice(0, MAX_LEVELS);
  const out = { merged: 0, chapters: 0, scenes: 0 };
  if (!target.length) return out;
  while (profileFor(p).levels.length > target.length) {
    const cur = profileFor(p).levels;
    if (cur.length === 3) {
      const r = await mergeBottomLevel(app, p, opts.sceneBreak || "* * *");
      out.merged += r.merged;
      out.chapters = r.chapters;
    } else {
      await writeLevels(app, p, [cur[cur.length - 1]]);
    }
  }
  while (profileFor(p).levels.length < target.length) {
    const cur = profileFor(p).levels;
    if (cur.length === 1) await writeLevels(app, p, [target[0], cur[0]]);
    else {
      const r = await splitBottomLevel(app, p, target[2], opts.breakPattern);
      out.chapters = r.chapters;
      out.scenes = r.scenes;
    }
  }
  const now = profileFor(p).levels;
  if (now.some((l, i) => l.singular !== target[i].singular || l.plural !== target[i].plural)) await writeLevels(app, p, target);
  return out;
}

async function finishStructureChange(app: App, p: Project) {
  await syncStructureAfter(app, p);
  if (p.numberScenes) await renumberScenes(app, p);
}

// ---------------------------------------------------------------- the book's saved format

/** How this book's folder and project note compare with what this Booker saves. */
export function checkProjectFormat(app: App, p: Project): VersionReport {
  const scenes = readScenes(app, p);
  const fm = app.metadataCache.getFileCache(p.file)?.frontmatter ?? {};
  const missingSystem = SYSTEM_FILES.filter((s) => !app.vault.getAbstractFileByPath(`${p.layout.system}/${s}`)) as string[];
  const empties = emptyStructure(app, p, scenes);
  return checkVersion({
    formatVersion: p.formatVersion,
    missingSystem,
    structureMissing: !p.levels && !!inferLevels(scenes),
    hasBookId: typeof fm.bookId === "string" && !!fm.bookId,
    legacyEmpties: empties.chapters.length + empties.acts.length,
  });
}

/** Bring an older book up to this format: add what is missing, drop empties with no files behind them, and stamp it. The caller backs the book up first. Returns what was done. */
export async function fixProjectFormat(app: App, p: Project): Promise<string[]> {
  const report = checkProjectFormat(app, p);
  if (report.state === "newer") throw new Error("This book was saved by a newer Booker. Update Booker instead of changing the book.");
  const done: string[] = [];
  await ensureFolder(app, p.layout.system);
  for (const s of SYSTEM_FILES) {
    const path = `${p.layout.system}/${s}`;
    if (app.vault.getAbstractFileByPath(path)) continue;
    await app.vault.create(path, JSON.stringify(emptySystemFile(s), null, 2));
    done.push(`created ${s}`);
  }
  if (!p.levels) {
    const levels = inferLevels(readScenes(app, p));
    if (levels) {
      await app.fileManager.processFrontMatter(p.file, (fm) => void (fm.structure = levelsToFm(levels)));
      p.levels = levels;
      done.push("worked out the structure");
    }
  }
  const fm0 = app.metadataCache.getFileCache(p.file)?.frontmatter ?? {};
  if (!fm0.bookId) {
    await app.fileManager.processFrontMatter(p.file, (fm) => void (fm.bookId = crypto.randomUUID()));
    done.push("gave the book an id");
  }
  if (report.stored < 2) {
    const dropped = await pruneEmptyStructure(app, p, readScenes(app, p));
    if (dropped) done.push(`dropped ${dropped} empty chapter or act entr${dropped === 1 ? "y" : "ies"}`);
  }
  await syncStructureAfter(app, p);
  if (p.numberScenes) await renumberScenes(app, p);
  await app.fileManager.processFrontMatter(p.file, (fm) => void (fm.formatVersion = PROJECT_FORMAT_VERSION));
  p.formatVersion = PROJECT_FORMAT_VERSION;
  done.push(`saved as format ${PROJECT_FORMAT_VERSION}`);
  return done;
}

// ---------------------------------------------------------------- numbering scenes across the book

/** Give every scene its place in the book as "Scene N", keeping any title after it. Returns how many titles changed. */
export async function renumberScenes(app: App, p: Project): Promise<number> {
  const scenes = readScenes(app, p).sort((a, b) => compareScenes(a as any, b as any));
  const changes = planRenumber(scenes, levelName(profileFor(p), 99));
  for (const c of changes) {
    const f = app.vault.getFileByPath(c.path);
    if (f) await app.fileManager.processFrontMatter(f, (fm) => void (fm.title = c.title));
  }
  return changes.length;
}

/** Switch "Scene N - Title" numbering on or off for a book. Turning it on numbers the scenes straight away. */
export async function setNumbering(app: App, p: Project, on: boolean): Promise<void> {
  await app.fileManager.processFrontMatter(p.file, (fm) => {
    if (on) fm.numberScenes = true;
    else delete fm.numberScenes;
  });
  p.numberScenes = on;
  if (on) {
    await new Promise((r) => setTimeout(r, 300));
    await renumberScenes(app, p);
  }
}


// ---------------------------------------------------------------- the index page

/** What each indexed word is looked for in: every scene, with the chapter it belongs to as its place. */
export async function indexSources(app: App, p: Project): Promise<{ where: string; text: string }[]> {
  const w = wordsFor(profileFor(p));
  const out: { where: string; text: string }[] = [];
  for (const s of readScenes(app, p)) {
    const f = app.vault.getFileByPath(s.path);
    if (f) out.push({ where: w.hasMid && s.chapter ? `${w.mid} ${s.chapter}` : s.title, text: await app.vault.cachedRead(f) });
  }
  return out;
}

/**
 * Keep an Index page in the back matter, listing each index term with where it appears. Made when the book has index
 * terms; rewritten each time they change. Export prints its own copy, so this page is for reading and checking.
 */
export async function updateIndexPage(app: App, p: Project): Promise<TFile | null> {
  const terms = indexTerms(app.metadataCache.getFileCache(p.file)?.frontmatter?.indexTerms);
  const existing = readMatter(app, p).find((m) => m.position === "back" && m.title.trim().toLowerCase() === "index");
  if (!terms.length && !existing) return null;
  const file = existing ? app.vault.getFileByPath(existing.path) : await createMatter(app, p, "back", "Index");
  if (!file) return null;
  const entries = buildIndex(terms, await indexSources(app, p));
  const body = entries.length ? `${entries.map((e) => `**${e.term}**  ${e.where.join(", ")}`).join("\n\n")}\n` : "No index term appears in the text yet.\n";
  const { fm } = parseNote(await app.vault.read(file));
  await app.vault.modify(file, stringifyNote({ ...fm, generated: "index" }, `\n${body}`));
  return file;
}
