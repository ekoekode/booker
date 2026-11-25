import type { ProjectLayout } from "./format";
import { blankCodexProps } from "./inspectorModel";

/**
 * The kinds of world-building notes a project can hold. Characters and places have their own folders; items, creatures, lore,
 * culture and systems are codex categories (`Codex/<Label>/Name.md` with `type: <id>`); notes live in the notes folder.
 * Any other folder inside Codex counts as a category you added yourself.
 */
export interface WorldKind {
  id: string;
  label: string;
  /** "Add ___" on the button */
  singular: string;
  icon: string;
  folder: string;
  /** the `type` property written on new notes */
  type: string;
  custom: boolean;
}

interface Def {
  id: string;
  label: string;
  singular: string;
  icon: string;
  type: string;
  /** folder name under Codex, or a key of the layout */
  folder: "characters" | "locations" | "notes" | string;
}

const DEFS: Def[] = [
  { id: "characters", label: "Characters", singular: "character", icon: "user", type: "character", folder: "characters" },
  { id: "locations", label: "Places", singular: "place", icon: "map-pin", type: "location", folder: "locations" },
  { id: "items", label: "Items", singular: "item", icon: "package", type: "items", folder: "Items" },
  { id: "creatures", label: "Creatures", singular: "creature", icon: "paw-print", type: "creatures", folder: "Creatures" },
  { id: "lore", label: "Lore", singular: "lore entry", icon: "scroll", type: "lore", folder: "Lore" },
  { id: "culture", label: "Culture", singular: "culture", icon: "landmark", type: "culture", folder: "Culture" },
  { id: "systems", label: "Systems", singular: "system", icon: "cog", type: "systems", folder: "Systems" },
  { id: "notes", label: "Notes", singular: "note", icon: "sticky-note", type: "note", folder: "notes" },
];

export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/** The built-in kinds with their folders in this project. */
export function builtinKinds(l: ProjectLayout, profileKinds?: Array<{ id: string; label: string; singular: string; icon: string }>): WorldKind[] {
  const ids = new Set(DEFS.map((d) => d.id));
  // a profile whose kinds are not the fiction ones (people, places, key terms…) brings its own, each a folder in Codex
  if (profileKinds && profileKinds.length && !profileKinds.every((k) => ids.has(k.id))) {
    const own: WorldKind[] = profileKinds.map((k) => ({ id: k.id, label: k.label, singular: k.singular, icon: k.icon, type: slug(k.id) || k.id, custom: false, folder: `${l.codex}/${k.label}` }));
    return [...own, ...builtinKinds(l).filter((k) => k.id === "notes")];
  }
  const wanted = profileKinds && profileKinds.length ? new Set([...profileKinds.map((k) => k.id), "notes"]) : null;
  return DEFS.filter((d) => !wanted || wanted.has(d.id)).map((d) => ({
    id: d.id,
    label: d.label,
    singular: d.singular,
    icon: d.icon,
    type: d.type,
    custom: false,
    folder: d.folder === "characters" ? l.characters : d.folder === "locations" ? l.locations : d.folder === "notes" ? l.notes : `${l.codex}/${d.folder}`,
  }));
}

/** Kinds for the folders in Codex that are not built in. `names` are the folder names found there. */
export function customKinds(l: ProjectLayout, names: string[]): WorldKind[] {
  const known = new Set(builtinKinds(l).map((k) => k.folder.split("/").pop()!.toLowerCase()));
  return names
    .filter((n) => !known.has(n.toLowerCase()))
    .sort((a, b) => a.localeCompare(b))
    .map((n) => (n.toLowerCase() === "lives" ? { id: "lives", label: n, singular: "life", icon: "repeat", type: "life", folder: `${l.codex}/${n}`, custom: true } : { id: slug(n) || n, label: n, singular: n.toLowerCase().replace(/s$/, ""), icon: "file-text", type: slug(n) || n, folder: `${l.codex}/${n}`, custom: true }));
}

/** Properties for a new note of this kind, as codex entries are written. */
export function entryFm(kind: WorldKind, name: string, today: string): Record<string, unknown> {
  if (kind.id === "notes") return { type: "note", title: name, created: today };
  const group = kind.id === "characters" ? "character" : kind.id === "locations" ? "location" : kind.type === "life" ? "life" : "other";
  return { type: kind.type, name, created: today, modified: today, ...blankCodexProps(group) };
}
