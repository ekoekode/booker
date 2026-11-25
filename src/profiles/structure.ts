/** A book's own structure: how many levels it has (1, 2 or 3) and what each is called. Pure.
 *  Three levels are act > chapter > scene. Two have a top level and its items (the middle level is hidden). One has only its items, such as a book of chapters. */
import type { Level, Profile } from "./profile";

export const MAX_LEVELS = 3;

const VOWEL_Y = /[aeiou]y$/i;

/** A plural for a level name the writer typed: "entry" gives "entries", "day" gives "days". */
export function pluralOf(word: string): string {
  const w = word.trim();
  if (!w) return w;
  if (/y$/i.test(w) && !VOWEL_Y.test(w)) return `${w.slice(0, -1)}ies`;
  if (/(s|x|ch|sh)$/i.test(w)) return `${w}es`;
  return `${w}s`;
}

export function makeLevel(singular: string, plural?: string): Level {
  const s = singular.trim().toLowerCase();
  return { id: s.replace(/[^\p{L}\p{N}]+/gu, "-") || "level", singular: s, plural: (plural?.trim() || pluralOf(s)).toLowerCase() };
}

/** Read the `structure` property of a project note: a list of "Name" or "Name|Names". Null when it is missing or unusable. */
export function parseLevels(raw: unknown): Level[] | null {
  if (!Array.isArray(raw)) return null;
  const levels = raw
    .map((x) => String(x ?? "").trim())
    .filter(Boolean)
    .slice(0, MAX_LEVELS)
    .map((x) => {
      const [s, p] = x.split("|");
      return makeLevel(s, p);
    });
  return levels.length ? levels : null;
}

/** The `structure` property for these levels; the plural is written only when it is not the usual one. */
export function levelsToFm(levels: Level[]): string[] {
  return levels.map((l) => (l.plural === pluralOf(l.singular) ? l.singular : `${l.singular}|${l.plural}`));
}

/** The profile with the book's own levels in place of its kind's, when it has any. */
export function withLevels(p: Profile, levels?: Level[] | null): Profile {
  return levels && levels.length ? { ...p, levels } : p;
}

/** Does the book show act headings? Only with two or more levels. */
export const hasTopLevel = (p: Pick<Profile, "levels">) => p.levels.length >= 2;

/** Does it show chapter headings between the top level and its items? Only with three. */
export const hasMiddleLevel = (p: Pick<Profile, "levels">) => p.levels.length >= 3;

/** The names of the three slots (top, middle, items) for editing: a book with fewer levels keeps the rest as they were in its kind. */
export function slotNames(levels: Level[], fallback: Level[]): [string, string, string] {
  const name = (l: Level | undefined, f: Level | undefined) => (l ?? f)?.singular ?? "";
  if (levels.length >= 3) return [levels[0].singular, levels[1].singular, levels[2].singular];
  const mid = name(fallback[1], undefined) || "chapter";
  if (levels.length === 2) return [levels[0].singular, fallback.length >= 3 ? fallback[1].singular : mid, levels[1].singular];
  return [fallback[0]?.singular ?? "part", fallback.length >= 3 ? fallback[1].singular : mid, levels[0]?.singular ?? "chapter"];
}

/** Levels from a count and the names of the three slots: 3 uses all, 2 uses top and items, 1 uses items only. */
export function levelsFromSlots(count: number, names: [string, string, string]): Level[] {
  const [top, mid, item] = names.map((n) => n.trim() || "") as [string, string, string];
  if (count >= 3) return [makeLevel(top || "act"), makeLevel(mid || "chapter"), makeLevel(item || "scene")];
  if (count === 2) return [makeLevel(top || "part"), makeLevel(item || "entry")];
  return [makeLevel(item || "chapter")];
}

/** The structure an existing folder of scenes already has, for adopting or importing it: no chapters and one act is just scenes; no chapters but several acts is acts and scenes. Null when it needs the usual three levels. */
export function inferLevels(scenes: Array<{ act?: unknown; chapter?: unknown }>): Level[] | null {
  if (!scenes.length) return null;
  const hasChapters = scenes.some((s) => s.chapter !== undefined && s.chapter !== null && s.chapter !== "");
  if (hasChapters) return null;
  const acts = new Set(scenes.map((s) => String(s.act ?? 1)));
  return acts.size > 1 ? [makeLevel("act"), makeLevel("scene")] : [makeLevel("scene")];
}

/** What the scenes folder calls the top level: its name, nothing for a book with no top level, and undefined for a book that never set its structure (it keeps "Act"). */
export function folderWordFor(levels: Level[] | null | undefined): string | undefined {
  if (!levels || !levels.length) return undefined;
  return levels.length >= 2 ? levels[0].singular : "";
}

/** The usual names for a book of 1, 2 or 3 levels. Fiction is chapters; act and chapter; act, chapter and scene. A sermon book is sermon; series and sermon; audience, series and sermon. Other kinds keep their own names, dropping the middle level first. */
export function presetNames(profileId: string, kind: Level[], count: number): string[] {
  const n = Math.min(Math.max(count, 1), MAX_LEVELS);
  const table: Record<string, string[][]> = {
    fiction: [["chapter"], ["act", "chapter"], ["act", "chapter", "scene"]],
    sermon: [["sermon"], ["series", "sermon"], ["audience", "series", "sermon"]],
  };
  const fixed = table[profileId]?.[n - 1];
  if (fixed) return fixed;
  const first = kind[0]?.singular ?? "part";
  const last = kind[kind.length - 1]?.singular ?? "chapter";
  if (n === 1) return [last];
  if (n === 2) return [first, last];
  return [first, kind.length >= 3 ? kind[1].singular : "chapter", last];
}

/** Levels from the names in order, top first. */
export const levelsFromNames = (names: string[]): Level[] => names.map((n) => makeLevel(n.trim() || "section")).slice(0, MAX_LEVELS);
