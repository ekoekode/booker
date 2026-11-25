/**
 * The on-disk project format. It is compatible with projects in the `StoryLine/` layout (checked against sample output in test/fixtures/project).
 * Pure functions only: no Obsidian objects, so the format can be tested against files on disk.
 *
 * Layout of a project called "Novel" under the projects root:
 *   Novel/Novel.md                      type: storyline
 *   Novel/Scenes/Act N/AA-SS Title.md   type: scene (act/chapter/sequence in frontmatter)
 *   Novel/Codex/{Characters,Locations}  type: character | location
 *   Novel/{Notes,SceneNotes,Archive,Research,System}
 */
import { parse, stringify } from "yaml";

export const PROJECT_TYPE = "storyline";
/** Projects made by Booker say `type: booker` and name their profile; older ones say `storyline` and are Fiction unless they name a profile. */
export const NATIVE_TYPE = "booker";
export const SYSTEM_FILES = ["timeline.json", "board.json", "plotlines.json", "stats.json", "characters.json", "custom-sections.json", "templates.json"] as const;

export interface ProjectLayout {
  base: string;
  projectFile: string;
  scenes: string;
  notes: string;
  /** front and back matter notes */
  matter: string;
  sceneNotes: string;
  archive: string;
  research: string;
  codex: string;
  characters: string;
  locations: string;
  system: string;
}

/** Folder and file locations of a project, from the projects root and project name. */
export function layoutFor(root: string, name: string): ProjectLayout {
  const base = join(root, name);
  return {
    base,
    projectFile: join(base, `${name}.md`),
    scenes: join(base, "Scenes"),
    notes: join(base, "Notes"),
    matter: join(base, "Matter"),
    sceneNotes: join(base, "SceneNotes"),
    archive: join(base, "Archive"),
    research: join(base, "Research"),
    codex: join(base, "Codex"),
    characters: join(base, "Codex", "Characters"),
    locations: join(base, "Codex", "Locations"),
    system: join(base, "System"),
  };
}

function join(...parts: string[]): string {
  return parts.filter(Boolean).join("/").replace(/\/+/g, "/");
}

// ---------------------------------------------------------------- frontmatter

export interface Parsed {
  fm: Record<string, any>;
  body: string;
  /** false when the file has no frontmatter block */
  hasFm: boolean;
}

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n?---[ \t]*(?:\r?\n|$)/;

export function parseNote(text: string): Parsed {
  const m = FM_RE.exec(text);
  if (!m) return { fm: {}, body: text, hasFm: false };
  let fm: any = {};
  try {
    fm = parse(m[1]) ?? {};
  } catch {
    fm = {};
  }
  if (typeof fm !== "object" || Array.isArray(fm)) fm = {};
  return { fm, body: text.slice(m[0].length), hasFm: true };
}

export function stringifyNote(fm: Record<string, any>, body: string): string {
  const y = Object.keys(fm).length ? stringify(fm, { lineWidth: 0 }) : "";
  return `---\n${y}---\n${body}`;
}

/** Update frontmatter keys and keep every other key, in order, untouched. `undefined` removes a key. */
export function patchNote(text: string, patch: Record<string, any>): string {
  const { fm, body } = parseNote(text);
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete fm[k];
    else fm[k] = v;
  }
  return stringifyNote(fm, body);
}

// ----------------------------------------------------------------- wikilinks

/** People and places are stored as wikilinks: pov: "[[Mara]]". */
export function wrapLink(name: string): string {
  const n = name.trim();
  return /^\[\[.*\]\]$/.test(n) ? n : `[[${n}]]`;
}

export function unwrapLink(value: string): string {
  const m = /^\[\[([^\]|#]*)(?:[|#][^\]]*)?\]\]$/.exec(String(value).trim());
  return (m ? m[1] : String(value)).trim();
}

export function linkList(values: unknown): string[] {
  if (values == null || values === "") return [];
  const arr = Array.isArray(values) ? values : String(values).split(",");
  return arr.map((v) => unwrapLink(String(v))).filter(Boolean);
}

// -------------------------------------------------------------------- scenes

export const SCENE_STATUSES = ["idea", "outlined", "draft", "written", "revised", "final"] as const;

export interface SceneRef {
  path: string;
  title: string;
  act: number | string;
  chapter?: number | string;
  sequence: number;
}

export interface SceneFm {
  type: "scene";
  title: string;
  act?: number | string;
  chapter?: number | string;
  sequence?: number;
  pov?: string;
  characters?: string[];
  location?: string;
  status?: string;
  tags?: string[];
  [key: string]: any;
}

const pad2 = (n: number | string) => String(n).padStart(2, "0");
const unsafe = /[\\/:*?"<>|]/g;

const folderWords = new Map<string, string>();

/** What a book calls its top level in folder names ("Part" gives "Part 2"); empty for a book with no top level, whose scenes sit straight in Scenes. Books never set keep "Act". */
export function setFolderWord(scenesFolder: string, word: string | undefined): void {
  if (word === undefined) folderWords.delete(scenesFolder);
  else folderWords.set(scenesFolder, word.trim() ? word.trim()[0].toUpperCase() + word.trim().slice(1) : "");
}

export const folderWordOf = (scenesFolder: string): string => folderWords.get(scenesFolder) ?? "Act";

/** "Act 2" for act 2; unsafe characters in free-text acts are replaced. */
export function actFolderName(act: number | string, word = "Act"): string {
  return `${word} ${String(act).replace(unsafe, "-")}`;
}

/** "02-01 Third.md": act-sequence prefix, then the title. */
export function sceneFileName(act: number | string | undefined, sequence: number | undefined, title: string): string {
  const a = act === undefined || act === "" ? "00" : /^\d+$/.test(String(act)) ? pad2(act) : String(act).replace(unsafe, "-");
  const s = sequence === undefined ? "00" : pad2(sequence);
  const t = (title || "Untitled").replace(unsafe, "-").substring(0, 60);
  return `${a}-${s} ${t}.md`;
}

export function scenePath(scenesFolder: string, act: number | string | undefined, sequence: number | undefined, title: string): string {
  const word = folderWordOf(scenesFolder);
  const folder = act === undefined || act === "" || !word ? scenesFolder : join(scenesFolder, actFolderName(act, word));
  return join(folder, sceneFileName(act, sequence, title));
}

export function isScene(fm: Record<string, any>): boolean {
  return fm.type === "scene";
}

/** Reading order: act, then chapter, then sequence (numeric where both are numbers), then title. */
export function compareScenes(a: SceneRef, b: SceneRef): number {
  const n = (x: number | string | undefined) => (x === undefined || x === "" ? Infinity : typeof x === "number" ? x : /^\d+$/.test(x) ? Number(x) : Infinity);
  return n(a.act) - n(b.act) || n(a.chapter) - n(b.chapter) || a.sequence - b.sequence || a.title.localeCompare(b.title);
}

// ------------------------------------------------------------------- routing

export interface MoveOp {
  /** current path */
  from: string;
  /** path to rename to (same as `from` when the file only needs a frontmatter change) */
  to: string;
  /** frontmatter changes to apply */
  patch: { act?: number | string; chapter?: number | string; sequence: number };
}

export interface MoveTarget {
  act: number | string;
  chapter?: number | string;
  /** 1-based slot in the destination; omitted = end */
  position?: number;
}

/**
 * Plan moving one scene to a place in the structure (what dragging a card does).
 * This renumbers the destination act 1..n and closes the gap in the source act, so every
 * sequence stays unique within its act. Returns only the files that change.
 */
export function planMove(scenes: SceneRef[], movePath: string, target: MoveTarget, scenesFolder: string): MoveOp[] {
  const moving = scenes.find((s) => s.path === movePath);
  if (!moving) return [];
  const same = (x: number | string, y: number | string) => String(x) === String(y);
  const ops = new Map<string, MoveOp>();

  const place = (list: SceneRef[], act: number | string, chapterFor: (s: SceneRef) => number | string | undefined) => {
    list.forEach((s, i) => {
      const seq = i + 1;
      const chapter = chapterFor(s);
      const to = scenePath(scenesFolder, act, seq, s.title);
      const changed = to !== s.path || !same(s.act, act) || s.sequence !== seq || String(s.chapter ?? "") !== String(chapter ?? "");
      if (!changed) return;
      const patch: MoveOp["patch"] = { sequence: seq };
      if (!same(s.act, act)) patch.act = act;
      if (String(s.chapter ?? "") !== String(chapter ?? "") && chapter !== undefined) patch.chapter = chapter;
      ops.set(s.path, { from: s.path, to, patch });
    });
  };

  const inAct = (act: number | string) => scenes.filter((s) => s.path !== movePath && same(s.act, act)).sort(compareScenes);

  const dest = inAct(target.act);
  const at = Math.min(Math.max((target.position ?? dest.length + 1) - 1, 0), dest.length);
  const next = [...dest.slice(0, at), moving, ...dest.slice(at)];
  place(next, target.act, (s) => (s.path === movePath ? target.chapter ?? s.chapter : s.chapter));

  if (!same(moving.act, target.act)) place(inAct(moving.act), moving.act, (s) => s.chapter);
  return [...ops.values()];
}

// ------------------------------------------------------------ project / codex

export interface ProjectFm {
  type: string;
  title: string;
  created: string;
  language: string;
  bookId: string;
  [key: string]: any;
}

export function newProjectFm(title: string, bookId: string, today: string, language = "en", series?: { id: string; uuid?: string }, timelineStart?: string, profile?: string, citationStyle?: string): ProjectFm {
  const fm: ProjectFm = { type: profile ? NATIVE_TYPE : PROJECT_TYPE, title, created: today, language, bookId };
  if (profile) fm.profile = profile;
  if (series) {
    fm.seriesId = series.id;
    if (series.uuid) fm.seriesUuid = series.uuid;
  }
  if (timelineStart) fm.timeline_start = timelineStart;
  if (citationStyle) fm.citationStyle = citationStyle;
  return fm;
}

export function codexFm(type: "character" | "location", name: string, today: string, extra: Record<string, any> = {}) {
  return { type, name, created: today, modified: today, ...extra };
}

export function isProject(fm: Record<string, any>): boolean {
  return fm.type === PROJECT_TYPE || fm.type === NATIVE_TYPE;
}

/** Empty System JSON files, as a new project has them. */
export function emptySystemFile(name: (typeof SYSTEM_FILES)[number]): unknown {
  switch (name) {
    case "characters.json":
      return { characterAliases: {}, ignoredCharacters: [] };
    case "plotlines.json":
      return { tagColors: {}, tagTypeOverrides: {}, plotlineDescriptions: {} };
    case "custom-sections.json":
      return { characterCustomSections: [], locationCustomSections: [], codexCategoryCustomSections: {}, codexVisualGroups: {}, customLocationTypes: [], codexCustomCategories: [], codexEnabledCategories: [] };
    case "templates.json":
      return { templates: [] };
    case "stats.json":
      return { writingTrackerData: { history: {}, revisionHistory: {}, changeHistory: {}, projectDeadlineIncludeWeekends: false, sprintLog: [] } };
    default:
      return {};
  }
}

// -------------------------------------------------------------- drop helpers

const chapterNum = (x: number | string | undefined) => (x === undefined || x === "" ? 0 : typeof x === "number" ? x : /^\d+$/.test(x) ? Number(x) : 0);

/**
 * Turn "dropped at slot `index` of a chapter column" into a 1-based position in the whole act,
 * which is what planMove wants. `index` counts the column without the card being dragged.
 */
export function positionInAct(scenes: SceneRef[], movePath: string, act: number | string, chapter: number | string, index: number): number {
  const inAct = scenes.filter((s) => s.path !== movePath && String(s.act) === String(act)).sort(compareScenes);
  const column = inAct.filter((s) => String(s.chapter ?? "") === String(chapter));
  if (column.length) {
    if (index < column.length) return inAct.indexOf(column[Math.max(index, 0)]) + 1;
    return inAct.indexOf(column[column.length - 1]) + 2;
  }
  const after = inAct.findIndex((s) => chapterNum(s.chapter) > chapterNum(chapter));
  return after === -1 ? inAct.length + 1 : after + 1;
}

export interface RenameStep {
  from: string;
  to: string;
}

/**
 * Order renames so none lands on a path that is still occupied. When a swap makes that impossible,
 * one file takes a temporary name first.
 */
export function scheduleRenames(ops: Array<{ from: string; to: string }>): RenameStep[] {
  const pending = ops.filter((o) => o.from !== o.to).map((o) => ({ ...o }));
  const out: RenameStep[] = [];
  let tmp = 0;
  while (pending.length) {
    const occupied = new Set(pending.map((o) => o.from));
    const i = pending.findIndex((o) => !occupied.has(o.to));
    if (i !== -1) {
      out.push({ from: pending[i].from, to: pending[i].to });
      pending.splice(i, 1);
      continue;
    }
    // every target is still in use: park one file under a temporary name
    const o = pending[0];
    const park = o.from.replace(/\.md$/, `.__moving${tmp++}.md`);
    out.push({ from: o.from, to: park });
    o.from = park;
  }
  return out;
}

// ------------------------------------------------------------ names (labels)

/**
 * Acts and chapters are numbers; their names live in the project note's properties as
 * `actLabels: {"0": Prologue}` and `chapterLabels: {"2": The Storm}`.
 * Act 0 sorts before Act 1, which is how a prologue goes first. Folders stay "Act N" so other tools can find them.
 */
export interface Labels {
  acts: Record<string, string>;
  chapters: Record<string, string>;
}

const strMap = (v: unknown): Record<string, string> => {
  const out: Record<string, string> = {};
  if (v && typeof v === "object") for (const [k, val] of Object.entries(v as Record<string, unknown>)) if (typeof val === "string" && val.trim()) out[String(k)] = val.trim();
  return out;
};

export function readLabels(projectFm: Record<string, any> | undefined): Labels {
  return { acts: strMap(projectFm?.actLabels), chapters: strMap(projectFm?.chapterLabels) };
}

/** Set (or clear, with an empty name) one label, returning a new Labels. */
export function setLabel(labels: Labels, kind: "act" | "chapter", key: number | string, name: string): Labels {
  const map = { ...(kind === "act" ? labels.acts : labels.chapters) };
  if (name.trim()) map[String(key)] = name.trim();
  else delete map[String(key)];
  return kind === "act" ? { acts: map, chapters: labels.chapters } : { acts: labels.acts, chapters: map };
}

/** Write Labels into project frontmatter, removing keys that became empty. */
export function applyLabels(projectFm: Record<string, any>, labels: Labels): void {
  if (Object.keys(labels.acts).length) projectFm.actLabels = labels.acts;
  else delete projectFm.actLabels;
  if (Object.keys(labels.chapters).length) projectFm.chapterLabels = labels.chapters;
  else delete projectFm.chapterLabels;
}

/** "Act 0 · Prologue", or just "Act 1" when it has no name. */
export function actTitle(act: number | string, labels?: Labels, word = "Act"): string {
  const base = /^-?\d+$/.test(String(act)) ? `${word} ${act}` : String(act);
  const name = labels?.acts[String(act)];
  return name ? `${base} · ${name}` : base;
}

export function chapterTitle(chapter: number | string | undefined, labels?: Labels, word = "Chapter"): string {
  if (chapter === undefined || chapter === "") return `No ${word.toLowerCase()}`;
  const base = /^-?\d+$/.test(String(chapter)) ? `${word} ${chapter}` : String(chapter);
  const name = labels?.chapters[String(chapter)];
  return name ? `${base} · ${name}` : base;
}

/** Swap two keys' names (they follow the thing they name when it is reordered). */
export function swapLabels(labels: Labels, kind: "act" | "chapter", a: number | string, b: number | string): Labels {
  const map = kind === "act" ? labels.acts : labels.chapters;
  const na = map[String(a)] ?? "";
  const nb = map[String(b)] ?? "";
  return setLabel(setLabel(labels, kind, a, nb), kind, b, na);
}

// ------------------------------------------------------------------- reorder

/** Give every scene in an act sequence 1..n in reading order, renaming files to match. Returns only what changes. */
function renumberAct(scenes: SceneRef[], act: number | string, folder: string): MoveOp[] {
  const ops: MoveOp[] = [];
  scenes
    .filter((s) => String(s.act) === String(act))
    .sort(compareScenes)
    .forEach((s, i) => {
      const to = scenePath(folder, act, i + 1, s.title);
      if (to !== s.path || s.sequence !== i + 1) ops.push({ from: s.path, to, patch: { sequence: i + 1 } });
    });
  return ops;
}

/**
 * Splitting a scene in two: the new scene goes right after the one being split, in the same act and chapter.
 * Later scenes of the act move down a place. Returns the moves and where the new scene lives.
 */
export function planSplit(scenes: SceneRef[], path: string, title: string, folder: string): { ops: MoveOp[]; newPath: string; newSequence: number; act: number | string; chapter: number | string | undefined } | null {
  const cur = scenes.find((s) => s.path === path);
  if (!cur) return null;
  const inAct = scenes.filter((s) => String(s.act) === String(cur.act)).sort(compareScenes);
  const at = inAct.findIndex((s) => s.path === path);
  const ops: MoveOp[] = [];
  inAct.forEach((s, i) => {
    const seq = i < at + 1 ? i + 1 : i + 2;
    const to = scenePath(folder, cur.act, seq, s.title);
    if (to !== s.path || s.sequence !== seq) ops.push({ from: s.path, to, patch: { sequence: seq } });
  });
  const newSequence = at + 2;
  return { ops, newPath: scenePath(folder, cur.act, newSequence, title), newSequence, act: cur.act, chapter: cur.chapter };
}

/** Swap two acts: every scene changes act number, so its folder and file prefix change with it. */
export function planSwapActs(scenes: SceneRef[], a: number | string, b: number | string, folder: string): MoveOp[] {
  const ops: MoveOp[] = [];
  for (const s of scenes) {
    const to = String(s.act) === String(a) ? b : String(s.act) === String(b) ? a : null;
    if (to === null) continue;
    ops.push({ from: s.path, to: scenePath(folder, to, s.sequence, s.title), patch: { act: to, sequence: s.sequence } });
  }
  return ops;
}

/** Swap two chapters inside one act: scenes take the other chapter's number, then the act is renumbered into the new reading order. */
export function planSwapChapters(scenes: SceneRef[], act: number | string, a: number | string, b: number | string, folder: string): MoveOp[] {
  const swapped = scenes.map((s) => {
    if (String(s.act) !== String(act)) return s;
    if (String(s.chapter) === String(a)) return { ...s, chapter: b };
    if (String(s.chapter) === String(b)) return { ...s, chapter: a };
    return s;
  });
  const renumber = new Map(renumberAct(swapped, act, folder).map((o) => [o.from, o]));
  const ops: MoveOp[] = [];
  for (const s of swapped) {
    const orig = scenes.find((x) => x.path === s.path)!;
    const chapterChanged = String(orig.chapter) !== String(s.chapter);
    const r = renumber.get(s.path);
    if (!chapterChanged && !r) continue;
    ops.push({ from: s.path, to: r?.to ?? s.path, patch: { sequence: r?.patch.sequence ?? s.sequence, ...(chapterChanged ? { chapter: s.chapter } : {}) } });
  }
  return ops;
}

// ------------------------------------------------- chapters as first-class things

/**
 * A chapter exists even with no scenes in it. The numbers are kept in the project note's `chapters` and `acts`
 * lists; Booker adds `chapterActs` ({"4": 2}) so an empty chapter knows which act it sits in.
 */
export interface ChapterRef {
  num: number;
  act: number;
}

export interface Structure {
  acts: number[];
  chapters: number[];
  chapterActs: Record<string, number>;
  /** chapters and acts the author made on purpose and that may stay without scenes; any other number with no scene is gone with its files */
  emptyChapters: number[];
  emptyActs: number[];
}

const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const toNum = (x: unknown): number | null => (isNum(x) ? x : typeof x === "string" && /^-?\d+$/.test(x.trim()) ? Number(x) : null);
const numList = (v: unknown): number[] => (Array.isArray(v) ? v.map(toNum).filter((n): n is number => n !== null) : []);

export function readStructure(fm: Record<string, any> | undefined): Structure {
  const chapterActs: Structure["chapterActs"] = {};
  if (fm?.chapterActs && typeof fm.chapterActs === "object") for (const [k, v] of Object.entries(fm.chapterActs)) if (toNum(v) !== null) chapterActs[String(k)] = toNum(v)!;
  const acts = numList(fm?.acts);
  // a book saved before empties were recorded keeps everything it listed, until the author prunes it
  const legacy = fm?.emptyChapters === undefined && fm?.emptyActs === undefined;
  return {
    acts,
    chapters: numList(fm?.chapters),
    chapterActs,
    emptyChapters: legacy ? numList(fm?.chapters) : numList(fm?.emptyChapters),
    emptyActs: legacy ? acts : numList(fm?.emptyActs),
  };
}

/** Write Structure into project frontmatter, removing keys that became empty. */
export function applyStructure(fm: Record<string, any>, st: Structure): void {
  if (st.acts.length) fm.acts = st.acts;
  else delete fm.acts;
  if (st.chapters.length) fm.chapters = st.chapters;
  else delete fm.chapters;
  if (Object.keys(st.chapterActs).length) fm.chapterActs = st.chapterActs;
  else delete fm.chapterActs;
  // always written (even empty) so a book is known to track its empties
  fm.emptyChapters = st.emptyChapters;
  fm.emptyActs = st.emptyActs;
}

export interface Model {
  acts: number[];
  chapters: ChapterRef[];
}

const asNumAct = (a: number | string) => toNum(a);

/** Every act and chapter that exists: those with scenes, plus the empty ones the author made. Numbers saved in the project note for files that are gone are left out. Sorted act, then number. */
export function buildModel(scenes: SceneRef[], st: Structure): Model {
  const acts = new Set<number>(st.emptyActs);
  for (const s of scenes) {
    const a = asNumAct(s.act);
    if (a !== null) acts.add(a);
  }
  const chapterAct = new Map<number, number>();
  for (const s of scenes) {
    const c = toNum(s.chapter);
    const a = asNumAct(s.act);
    if (c !== null && a !== null && !chapterAct.has(c)) chapterAct.set(c, a);
  }
  const sortedActs = [...acts].sort((x, y) => x - y);
  const known = [...new Set([...st.emptyChapters, ...chapterAct.keys()])].sort((x, y) => x - y);
  for (const n of known) {
    if (chapterAct.has(n)) continue;
    const saved = toNum(st.chapterActs[String(n)]);
    let act: number;
    if (saved !== null) act = saved;
    else {
      // no record: the act of the nearest earlier chapter, else the first act
      const before = [...chapterAct.entries()].filter(([k]) => k < n).sort((x, y) => y[0] - x[0])[0];
      act = before ? before[1] : sortedActs[0] ?? 1;
    }
    chapterAct.set(n, act);
    acts.add(act);
  }
  const chapters = [...chapterAct.entries()].map(([num, act]) => ({ num, act })).sort((x, y) => x.act - y.act || x.num - y.num);
  return { acts: [...acts].sort((x, y) => x - y), chapters };
}

/** What to save so empty acts and chapters survive: all numbers, plus the act of each chapter that has no scene. */
export function structureFor(scenes: SceneRef[], model: Model): Structure {
  const withScenes = new Set(scenes.map((s) => toNum(s.chapter)).filter((n): n is number => n !== null));
  const chapterActs: Structure["chapterActs"] = {};
  for (const c of model.chapters) if (!withScenes.has(c.num)) chapterActs[String(c.num)] = c.act;
  const withActScenes = new Set(scenes.map((s) => toNum(s.act)).filter((n): n is number => n !== null));
  return {
    acts: model.acts,
    chapters: model.chapters.map((c) => c.num).sort((a, b) => a - b),
    chapterActs,
    emptyChapters: model.chapters.filter((c) => !withScenes.has(c.num)).map((c) => c.num).sort((a, b) => a - b),
    emptyActs: model.acts.filter((a) => !withActScenes.has(a)),
  };
}

/** The same structure without its empty chapters and acts: for pruning ones whose files are gone. */
export const withoutEmpties = (st: Structure): Structure => ({ ...st, emptyChapters: [], emptyActs: [], chapterActs: {} });

export function sameStructure(a: Structure, b: Structure): boolean {
  const key = (x: Structure) => JSON.stringify([x.acts, x.chapters, Object.entries(x.chapterActs).sort(), x.emptyChapters, x.emptyActs]);
  return key(a) === key(b);
}

/** Turn "scenes after the change" into file operations: renumber each act 1..n in reading order and report what differs. */
export function finalizeOps(orig: SceneRef[], next: SceneRef[], folder: string): MoveOp[] {
  const origBy = new Map(orig.map((s) => [s.path, s]));
  const ops: MoveOp[] = [];
  const acts = [...new Set(next.map((s) => String(s.act)))];
  for (const a of acts) {
    next
      .filter((s) => String(s.act) === a)
      .sort(compareScenes)
      .forEach((s, i) => {
        const o = origBy.get(s.path)!;
        const seq = i + 1;
        const to = scenePath(folder, s.act, seq, s.title);
        const actChanged = String(o.act) !== String(s.act);
        const chapterChanged = String(o.chapter ?? "") !== String(s.chapter ?? "");
        if (to === o.path && o.sequence === seq && !actChanged && !chapterChanged) return;
        const patch: MoveOp["patch"] = { sequence: seq };
        if (actChanged) patch.act = s.act;
        if (chapterChanged && s.chapter !== undefined) patch.chapter = s.chapter;
        ops.push({ from: o.path, to, patch });
      });
  }
  return ops;
}

export interface ChapterPlan {
  ops: MoveOp[];
  model: Model;
  labels: Labels;
  /** old chapter number -> new chapter number */
  renumber: Map<number, number>;
}

/**
 * Move a chapter (with its scenes) before another chapter, or to the end of an act. Chapter numbers are the same set as
 * before, handed out again in the new order, so numbering stays ascending through the book. Names move with their chapter.
 */
export function planMoveChapter(scenes: SceneRef[], model: Model, labels: Labels, num: number, toAct: number, beforeNum: number | null, folder: string): ChapterPlan | null {
  const order = [...model.chapters].sort((x, y) => x.act - y.act || x.num - y.num);
  const moving = order.find((c) => c.num === num);
  if (!moving) return null;
  const set = order.map((c) => c.num).sort((x, y) => x - y);
  const rest = order.filter((c) => c.num !== num);
  let at = beforeNum === null ? -1 : rest.findIndex((c) => c.num === beforeNum);
  if (at < 0) {
    const lastInAct = rest.map((c) => c.act).lastIndexOf(toAct);
    if (lastInAct >= 0) at = lastInAct + 1;
    else {
      const firstLater = rest.findIndex((c) => c.act > toAct);
      at = firstLater === -1 ? rest.length : firstLater;
    }
  }
  const nextOrder = [...rest.slice(0, at), { num, act: toAct }, ...rest.slice(at)];
  const renumber = new Map<number, number>();
  nextOrder.forEach((c, i) => renumber.set(c.num, set[i]));
  const chapters = nextOrder.map((c, i) => ({ num: set[i], act: c.act }));

  const nextScenes: SceneRef[] = scenes.map((s) => {
    const c = toNum(s.chapter);
    if (c === null || !renumber.has(c)) return s;
    return { ...s, chapter: renumber.get(c)!, act: c === num ? toAct : s.act };
  });
  let newLabels: Labels = { acts: labels.acts, chapters: {} };
  for (const [k, v] of Object.entries(labels.chapters)) {
    const n = toNum(k);
    newLabels = setLabel(newLabels, "chapter", n !== null && renumber.has(n) ? renumber.get(n)! : k, v);
  }
  return { ops: finalizeOps(scenes, nextScenes, folder), model: { acts: [...new Set([...model.acts, toAct])].sort((x, y) => x - y), chapters: chapters.sort((x, y) => x.act - y.act || x.num - y.num) }, labels: newLabels, renumber };
}

/** Add an empty chapter at the end of an act, or right after chapter `after` when it is in that act. Returns the plan plus the number the new chapter ended up with. */
export function planInsertChapter(scenes: SceneRef[], model: Model, labels: Labels, act: number, name: string, folder: string, after?: number | string): (ChapterPlan & { num: number }) | null {
  const fresh = model.chapters.reduce((m, c) => Math.max(m, c.num), 0) + 1;
  const withNew: Model = { acts: [...new Set([...model.acts, act])].sort((x, y) => x - y), chapters: [...model.chapters, { num: fresh, act }] };
  const order = [...model.chapters].sort((x, y) => x.act - y.act || x.num - y.num);
  const at = typeof after === "number" ? order.findIndex((c) => c.num === after && c.act === act) : -1;
  const before = at >= 0 && order[at + 1]?.act === act ? order[at + 1].num : null;
  const plan = planMoveChapter(scenes, withNew, labels, fresh, act, before, folder);
  if (!plan) return null;
  const num = plan.renumber.get(fresh)!;
  return { ...plan, num, labels: name.trim() ? setLabel(plan.labels, "chapter", num, name) : plan.labels };
}
