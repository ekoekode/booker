import type { Words } from "../profiles/words";
import { compareScenes, SCENE_STATUSES } from "./format";

export interface HubScene {
  path: string;
  title: string;
  act: number | string;
  chapter?: number | string;
  sequence: number;
  status: string;
  words: number;
  pov?: string;
  characters?: string[];
  location?: string[];
  tags?: string[];
  storyDate?: string;
  storyTime?: string;
  chronologicalOrder?: number;
  timelineMode?: string;
  lives?: string[];
  color?: string;
  setup?: string[];
  payoff?: string[];
  beat?: string;
  beatsheet?: string;
  synopsis?: string;
  /** the short summary written in the background */
  aiShort?: string;
  /** a summary you wrote yourself (the `summary` or `synopsis` property); shown instead of the AI one */
  ownSummary?: string;
  /** a `description` on the note, shown when there is no summary */
  description?: string;
  /** the AI summary in full (the short one is `aiShort`) */
  aiFull?: string;
  /** plotlines this scene sets up / pays off (Booker's own marks) */
  plotSetup?: string[];
  plotPayoff?: string[];
  /** the book it belongs to, when scenes from a whole series are read together */
  book?: string;
  /** the book's timeline start (a date), which "Day 3", "Week 2" and "Year 2" count from */
  anchor?: string;
}

export interface ChapterGroup {
  chapter: number | string | undefined;
  scenes: HubScene[];
  words: number;
}

export interface ActGroup {
  act: number | string;
  chapters: ChapterGroup[];
  words: number;
}

/** Scenes grouped act -> chapter, in reading order. */
export function groupScenes(scenes: HubScene[]): ActGroup[] {
  const sorted = [...scenes].sort(compareScenes);
  const acts: ActGroup[] = [];
  for (const s of sorted) {
    let a = acts.find((x) => String(x.act) === String(s.act));
    if (!a) acts.push((a = { act: s.act, chapters: [], words: 0 }));
    let c = a.chapters.find((x) => String(x.chapter ?? "") === String(s.chapter ?? ""));
    if (!c) a.chapters.push((c = { chapter: s.chapter, scenes: [], words: 0 }));
    c.scenes.push(s);
    c.words += s.words;
    a.words += s.words;
  }
  return acts;
}

export function statusCounts(scenes: HubScene[], statuses: readonly string[] = SCENE_STATUSES): Record<string, number> {
  const out: Record<string, number> = Object.fromEntries(statuses.map((s) => [s, 0]));
  for (const s of scenes) out[s.status] = (out[s.status] ?? 0) + 1;
  return out;
}

/** The act and chapter a new scene should go in: the last scene's, so writing continues where it left off. */
export function nextSceneSlot(scenes: HubScene[]): { act: number | string; chapter: number | string } {
  const last = [...scenes].sort(compareScenes).pop();
  return last ? { act: last.act, chapter: last.chapter ?? 1 } : { act: 1, chapter: 1 };
}

/** The scene to resume: the least-finished scene that has words, else the first scene without. */
export function continueScene(scenes: HubScene[]): HubScene | null {
  const sorted = [...scenes].sort(compareScenes);
  return sorted.find((s) => s.words === 0 && s.status !== "final") ?? sorted[sorted.length - 1] ?? null;
}

export interface Step {
  id: string;
  title: string;
  hint: string;
  done: boolean;
}

export interface ChecklistInput {
  hasProject: boolean;
  scenes: HubScene[];
  characters: number;
  locations: number;
  research?: { bibles: number; sources: number };
  /** which kind of book it is; each has its own first steps */
  profileId?: string;
  /** a beat sheet has been chosen */
  beatSheet?: boolean;
  /** notes in the project's world folders (people, terms, illustrations…) */
  world?: number;
  /** the book's own level words, when known: the steps use them in place of the kind's wording */
  words?: Words;
}

const step = (id: string, title: string, hint: string, done: boolean): Step => ({ id, title, hint, done });

/** The first steps for each kind of book, derived from what exists (nothing is stored, so it can never go stale). */
export function checklist(input: ChecklistInput): Step[] {
  const steps = checklistBase(input);
  const w = input.words;
  if (!w) return steps;
  const item = w.item.toLowerCase();
  const group = w.hasTop ? ` Group them into ${[w.topMany, w.hasMid ? w.midMany : ""].filter(Boolean).join(" and ").toLowerCase()}.` : "";
  return steps.map((st) => {
    if (st.id === "scene") return { ...st, title: `Add your first ${item}`, hint: `A${/^[aeiou]/.test(item) ? "n" : ""} ${item} is the unit you write in.${group}` };
    if (st.id === "write") return { ...st, hint: `Open a${/^[aeiou]/.test(item) ? "n" : ""} ${item} and start. Word counts update as you type.` };
    return st;
  });
}

function checklistBase(input: ChecklistInput): Step[] {
  const written = input.scenes.reduce((n, s) => n + s.words, 0);
  const has = input.scenes.length > 0;
  const r = input.research ?? { bibles: 0, sources: 0 };
  const world = input.world ?? 0;
  const project = step("project", "Create your project", "A project holds one book: its chapters, notes and sources.", input.hasProject);
  const write = step("write", "Write 100 words", "Open a section and start. Word counts update as you type.", written >= 100);
  const beats = (title: string, hint: string) => step("beats", title, hint, !!input.beatSheet);
  const bible = step("bible", "Add a Bible", "Use Add Bible module (Settings, or the Reference tab) so verses can be looked up and written out as you type.", r.bibles > 0);
  const source = (hint: string) => step("source", "Add a source", hint, r.sources > 0);
  const note = (title: string, hint: string) => step("note", title, hint, world > 0);
  switch (input.profileId) {
    case "fiction":
      return [
        step("project", "Create your project", "A project holds one book: scenes, characters and places.", input.hasProject),
        step("scene", "Add your first scene", "A scene is the unit you write in. Group them into acts and chapters.", has),
        beats("Choose a story structure", "Open Story checks and pick a beat sheet such as the three-act structure to see which beats you still need."),
        step("write", "Write 100 words", "Open a scene and start. Word counts update as you type.", written >= 100),
        step("character", "Add a character", "Characters you tag on a scene show up on the board and the timeline.", input.characters > 0),
        step("location", "Add a place", "Places work the same way as characters.", input.locations > 0),
      ];
    case "sermon":
      return [
        step("project", "Create your sermon or series", "A project holds one series, or a single sermon, as an outline.", input.hasProject),
        beats("Choose a sermon shape", "Open Story checks and pick expository, topical, narrative or gospel to lay out the outline."),
        step("scene", "Add your first point", "Each point is a note under its sermon. Start with the big idea.", has),
        bible,
        note("Add an illustration", "Keep stories and pictures as notes so you can reuse them."),
        write,
      ];
    case "nonfiction-christian":
      return [project, step("scene", "Add your first section", "A section is the unit you write in. Group them into parts and chapters.", has), beats("Choose a book shape", "Pick a doctrinal treatise or teaching book outline in Story checks."), write, bible, source("Add a book or PDF you will cite. Then type [@ in your text to cite it.")];
    case "nonfiction-history":
      return [project, step("scene", "Add your first section", "A section is the unit you write in. Group them into parts and chapters.", has), beats("Choose a book shape", "Pick a narrative or thematic outline in Story checks."), write, source("Add an archive, book or article you will cite. Then type [@ in your text to cite it."), note("Add a person, place or term", "Keep a note for each so the book stays consistent.")];
    case "nonfiction-educational":
      return [project, step("scene", "Add your first section", "A section is the unit you write in. Group them into units and chapters.", has), beats("Choose a lesson shape", "Pick the lesson cycle in Story checks."), write, note("Add a key term", "Terms you define feed the glossary at the back."), source("Add a book or article you will cite.")];
    case "self-help":
      return [project, step("scene", "Add your first section", "A section is the unit you write in. Group them into parts and chapters.", has), beats("Choose a book arc", "Pick the transformation arc in Story checks."), write, note("Add an exercise", "Exercises and stories are kept as notes you can place in chapters.")];
    case "bible-study":
      return [project, step("scene", "Add your first entry", "An entry is one day's reading. Group them into weeks.", has), beats("Choose a weekly rhythm", "Pick the study rhythm in Story checks."), bible, note("Add a prompt", "Prompts are the questions you ask the reader."), write];
    case "reference":
      return [project, step("scene", "Add your first entry", "An entry is the unit you write in. Group them into volumes.", has), beats("Choose an entry template", "Pick the entry template in Story checks so every entry has the same parts."), write, note("Add a topic", "Topics group entries for cross-references."), source("Add a source for entries to cite.")];
    case "dictionary":
      return [project, step("scene", "Add your first entry", "An entry is one word. Group them by letter.", has), beats("Choose an entry layout", "Pick the entry anatomy in Story checks."), write, source("Add a source for etymologies and examples.")];
  }
  if (input.research) return [project, step("scene", "Add your first section", "A section is the unit you write in. Group them into parts and chapters.", has), write, bible, source("Add a book or PDF you will cite. Then type [@ in your text to cite it.")];
  return [
    step("project", "Create your project", "A project holds one book: scenes, characters and places.", input.hasProject),
    step("scene", "Add your first scene", "A scene is the unit you write in. Group them into acts and chapters.", has),
    step("write", "Write 100 words", "Open a scene and start. Word counts update as you type.", written >= 100),
    step("character", "Add a character", "Characters you tag on a scene show up on the board and the timeline.", input.characters > 0),
    step("location", "Add a place", "Places work the same way as characters.", input.locations > 0),
  ];
}

export function progress(steps: Step[]): { done: number; total: number; next: Step | null } {
  const done = steps.filter((s) => s.done).length;
  return { done, total: steps.length, next: steps.find((s) => !s.done) ?? null };
}

export function actLabel(act: number | string): string {
  return /^\d+$/.test(String(act)) ? `Act ${act}` : String(act);
}

export function chapterLabel(chapter: number | string | undefined): string {
  if (chapter === undefined || chapter === "") return "No chapter";
  return /^\d+$/.test(String(chapter)) ? `Chapter ${chapter}` : String(chapter);
}

// -------------------------------------------------- act / chapter choices

const num = (x: number | string | undefined) => (typeof x === "number" ? x : x !== undefined && /^\d+$/.test(String(x)) ? Number(x) : 0);
const uniq = (xs: Array<number | string>) => [...new Map(xs.map((x) => [String(x), x])).values()];

/** Existing acts in order. */
export function actChoices(scenes: HubScene[]): Array<number | string> {
  return uniq([...scenes].sort(compareScenes).map((s) => s.act));
}

/** Existing chapters inside one act, in order. */
export function chapterChoices(scenes: HubScene[], act: number | string): Array<number | string> {
  return uniq([...scenes].filter((s) => String(s.act) === String(act) && s.chapter !== undefined).sort(compareScenes).map((s) => s.chapter!));
}

/** The number "New act" would use. */
export function newActNumber(scenes: HubScene[]): number {
  return scenes.reduce((m, s) => Math.max(m, num(s.act)), 0) + 1;
}

/** The number "New chapter" would use. Chapters are numbered through the whole book, not restarted in each act. */
export function newChapterNumber(scenes: HubScene[]): number {
  return scenes.reduce((m, s) => Math.max(m, num(s.chapter)), 0) + 1;
}
