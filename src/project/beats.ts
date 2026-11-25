import { PROFILE_SHEETS } from "../profiles/beatSheets";

export interface Beat {
  act: number;
  label: string;
  description: string;
}

export interface BeatSheet {
  id: string;
  name: string;
  summary: string;
  actLabels: Record<number, string>;
  beats: Beat[];
}

const b = (act: number, label: string, description: string): Beat => ({ act, label, description });

/** Well-known story structures, described in plain words. Applying one makes a scene for each beat. */
export const BEAT_SHEETS: BeatSheet[] = [
  {
    id: "three-act",
    name: "Three-act structure",
    summary: "Setup, confrontation, resolution.",
    actLabels: { 1: "Act 1: Setup", 2: "Act 2: Confrontation", 3: "Act 3: Resolution" },
    beats: [
      b(1, "Opening", "Show the protagonist's ordinary world and what is missing from it."),
      b(1, "Inciting incident", "Something happens that disturbs that world and starts the story."),
      b(1, "First plot point", "A decision or event that commits the protagonist to the main conflict."),
      b(2, "Rising action", "Obstacles grow, allies and enemies are sorted, the stakes go up."),
      b(2, "Midpoint", "A turn that changes what the protagonist understands or wants."),
      b(2, "Crisis", "Things get worse; the plan fails and the protagonist loses ground."),
      b(2, "Second plot point", "The last piece falls into place and sends the story into the final act."),
      b(3, "Climax", "The decisive confrontation."),
      b(3, "Resolution", "The new normal: what has changed, and what it cost."),
    ],
  },
  {
    id: "save-the-cat",
    name: "Save the Cat",
    summary: "Fifteen beats for a commercial novel or screenplay.",
    actLabels: { 1: "Act 1", 2: "Act 2", 3: "Act 3" },
    beats: [
      b(1, "Opening image", "A snapshot of the protagonist's world before the change."),
      b(1, "Theme stated", "Someone hints at what the story is really about."),
      b(1, "Set-up", "Introduce the main people, the world and what is wrong with it."),
      b(1, "Catalyst", "The event that knocks the protagonist's life off course."),
      b(1, "Debate", "The protagonist hesitates: should they go?"),
      b(2, "Break into two", "The protagonist chooses to act and enters the new world."),
      b(2, "B story", "A secondary relationship that carries the theme."),
      b(2, "Fun and games", "The promise of the premise: the new world explored."),
      b(2, "Midpoint", "A false victory or false defeat; stakes rise."),
      b(2, "Bad guys close in", "Pressure from outside and trouble within."),
      b(2, "All is lost", "The lowest point; something or someone is lost."),
      b(2, "Dark night of the soul", "The protagonist faces what they have lost and why."),
      b(3, "Break into three", "A new idea, joining the A and B stories, shows the way."),
      b(3, "Finale", "The protagonist uses what they have learned to win."),
      b(3, "Final image", "The mirror of the opening: proof that things have changed."),
    ],
  },
  {
    id: "heros-journey",
    name: "Hero's journey",
    summary: "Twelve stages of leaving home, being tested and coming back changed.",
    actLabels: { 1: "Departure", 2: "Initiation", 3: "Return" },
    beats: [
      b(1, "Ordinary world", "The hero's everyday life before the adventure."),
      b(1, "Call to adventure", "A challenge or problem arrives."),
      b(1, "Refusal of the call", "Fear or duty holds the hero back."),
      b(1, "Meeting the mentor", "Someone gives advice, a gift or confidence."),
      b(1, "Crossing the threshold", "The hero commits and leaves the familiar world."),
      b(2, "Tests, allies, enemies", "The hero learns the rules of the new world."),
      b(2, "Approach to the inmost cave", "Preparation for the central ordeal."),
      b(2, "The ordeal", "The greatest crisis: a brush with death or failure."),
      b(2, "The reward", "The hero takes what they came for."),
      b(3, "The road back", "The hero heads home, pursued or pressed to finish."),
      b(3, "Resurrection", "A final test where the hero is changed for good."),
      b(3, "Return with the elixir", "The hero comes home with something that helps others."),
    ],
  },
  {
    id: "seven-point",
    name: "Seven-point structure",
    summary: "Work backwards from the resolution through seven turning points.",
    actLabels: { 1: "Beginning", 2: "Middle", 3: "End" },
    beats: [
      b(1, "Hook", "The starting state, the opposite of where the story ends."),
      b(1, "Plot turn 1", "New information or a new goal sets the story moving."),
      b(2, "Pinch 1", "Pressure shows the strength of the opposition."),
      b(2, "Midpoint", "The protagonist moves from reacting to acting."),
      b(2, "Pinch 2", "Everything seems lost; pressure at its worst."),
      b(3, "Plot turn 2", "The last piece of information that lets the protagonist win."),
      b(3, "Resolution", "The conflict is settled and the ending answers the hook."),
    ],
  },
  {
    id: "story-circle",
    name: "Story circle",
    summary: "Eight steps: a character goes into the unknown and returns changed.",
    actLabels: { 1: "Comfort", 2: "Unfamiliar", 3: "Return" },
    beats: [
      b(1, "You", "A character in a zone of comfort."),
      b(1, "Need", "But they want something."),
      b(2, "Go", "They enter an unfamiliar situation."),
      b(2, "Search", "They adapt to it."),
      b(2, "Find", "They get what they wanted."),
      b(3, "Take", "They pay a heavy price for it."),
      b(3, "Return", "They go back to where they started."),
      b(3, "Change", "They have changed."),
    ],
  },
];

/** Every sheet Booker knows, fiction first. */
export const ALL_SHEETS = (): BeatSheet[] => [...BEAT_SHEETS, ...Object.values(PROFILE_SHEETS).flat()];

export function sheetByName(name: string | undefined | null, extra: BeatSheet[] = []): BeatSheet | undefined {
  if (!name) return undefined;
  const n = String(name).trim().toLowerCase();
  return [...extra, ...ALL_SHEETS()].find((s) => s.name.toLowerCase() === n || s.id === n);
}

export interface BeatScene {
  path: string;
  title: string;
  beat?: string;
  beatsheet?: string;
}

export interface BeatRow {
  beat: Beat;
  scenes: BeatScene[];
}

const same = (a: string, b2: string) => a.trim().toLowerCase() === b2.trim().toLowerCase();

/**
 * Which scenes carry each beat of a sheet. A scene counts when its `beat` property names the beat, or, for scenes made from
 * the sheet, when its title is the beat's name.
 */
export function beatCoverage(sheet: BeatSheet, scenes: BeatScene[]): BeatRow[] {
  return sheet.beats.map((beat) => ({
    beat,
    scenes: scenes.filter((s) => (s.beat ? same(s.beat, beat.label) && (!s.beatsheet || same(s.beatsheet, sheet.name)) : !!s.beatsheet && same(s.beatsheet, sheet.name) && same(s.title, beat.label))),
  }));
}

/** Beats with no scene yet, in order. */
export function emptyBeats(rows: BeatRow[]): Beat[] {
  return rows.filter((r) => r.scenes.length === 0).map((r) => r.beat);
}
