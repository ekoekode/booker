/** Which fields the inspector shows for a project note. Pure, so it can be tested. */
import type { ProjectLayout } from "./format";

export type NoteKind = { kind: "scene" } | { kind: "codex"; type: string; group: "character" | "location" | "life" | "other" } | { kind: "none" };

const under = (path: string, folder: string) => path.startsWith(folder + "/");

/** What a note is, from where it lives and its `type`. */
export function classify(path: string, fm: Record<string, any> | undefined, l: ProjectLayout): NoteKind {
  if (under(path, l.scenes) && fm?.type === "scene") return { kind: "scene" };
  if (under(path, l.characters)) return { kind: "codex", type: "character", group: "character" };
  if (under(path, l.locations)) return { kind: "codex", type: "location", group: "location" };
  if (under(path, l.codex)) return { kind: "codex", type: String(fm?.type ?? "note"), group: fm?.type === "life" ? "life" : "other" };
  return { kind: "none" };
}

export interface TextField {
  key: string;
  label: string;
  /** a long, multi-line field */
  long?: boolean;
  placeholder?: string;
}

export const CHARACTER_FIELDS: TextField[] = [
  { key: "role", label: "Role" },
  { key: "occupation", label: "Occupation" },
  { key: "residency", label: "Lives in" },
  { key: "family", label: "Family notes" },
  { key: "appearance", label: "Appearance", long: true },
  { key: "personality", label: "Personality", long: true },
  { key: "goal", label: "Goal" },
  { key: "belief", label: "Belief" },
  { key: "misbelief", label: "Misbelief" },
  { key: "fears", label: "Fears" },
  { key: "flaws", label: "Flaws" },
  { key: "strengths", label: "Strengths" },
];

export const LOCATION_FIELDS: TextField[] = [
  { key: "locationType", label: "Kind of place" },
  { key: "description", label: "Description", long: true },
  { key: "geography", label: "Geography", long: true },
  { key: "culture", label: "Culture" },
  { key: "atmosphere", label: "Atmosphere" },
  { key: "significance", label: "Why it matters", long: true },
];

export const OTHER_FIELDS: TextField[] = [
  { key: "storyDate", label: "Date", placeholder: "e.g. 1342-05-03 or 1340..1350" },
  { key: "description", label: "Description", long: true },
  { key: "color", label: "Colour on the timeline", placeholder: "e.g. #3e63dd" },
];

/** A life of a character: its own name, when it ran, how it ended. The character link is a separate field. */
export const LIFE_FIELDS: TextField[] = [
  { key: "lifeName", label: "Name of this life", placeholder: "e.g. The sailor" },
  { key: "number", label: "Sequence", placeholder: "1, 2, 3… or leave empty to float free" },
  { key: "storyDate", label: "Dates", placeholder: "e.g. 1342..1391, or 1342 for no end yet" },
  { key: "anchor", label: "Anchored to", placeholder: "empty = follows the previous life" },
  { key: "gap", label: "Gap", placeholder: "e.g. 3d, 2w (empty = 3d)" },
  { key: "howEnded", label: "How it ended" },
  { key: "description", label: "Description", long: true },
  { key: "color", label: "Colour on the timeline", placeholder: "e.g. #3e63dd" },
];

/** Time-link fields for notes made from a sequence template (any type), beyond its own fields. */
export const SEQ_FIELDS: TextField[] = [
  { key: "anchor", label: "Anchored to", placeholder: "a note to follow, e.g. [[Scene 12]]" },
  { key: "anchorMode", label: "Relation", placeholder: "after, with or before" },
  { key: "anchorEdge", label: "Of its", placeholder: "start or end" },
  { key: "gap", label: "Gap", placeholder: "e.g. 3d, 2w, 1m, 1y (empty = template default)" },
];

export function codexFields(group: "character" | "location" | "life" | "other"): TextField[] {
  return group === "character" ? CHARACTER_FIELDS : group === "location" ? LOCATION_FIELDS : group === "life" ? LIFE_FIELDS : OTHER_FIELDS;
}

/** Scene text fields beyond the structured ones. */
export const SCENE_FIELDS: TextField[] = [
  { key: "conflict", label: "Conflict" },
  { key: "emotion", label: "Emotion" },
  { key: "color", label: "Colour on the timeline", placeholder: "e.g. #3e63dd" },
];

/** Every property a new codex note starts with, empty, so they all show in the note's properties and the inspector. */
export function blankCodexProps(group: "character" | "location" | "life" | "other"): Record<string, unknown> {
  const out: Record<string, unknown> = { aliases: [] };
  if (group === "character") Object.assign(out, { parents: [], partners: [] });
  if (group === "life") out.character = "";
  for (const f of codexFields(group)) out[f.key] = "";
  return out;
}

/** The properties a new scene starts with, empty, beyond title, place in the book and status. */
export function blankSceneProps(): Record<string, unknown> {
  return { synopsis: "", pov: "", characters: [], location: "", storyDate: "", storyTime: "", tags: [], conflict: "", emotion: "" };
}
