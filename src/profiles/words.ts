/** The words a book uses for its levels, for every screen that names them. Pure. */
import { hasMiddleLevel, hasTopLevel } from "./structure";
import { levelName, type Profile } from "./profile";

export interface Words {
  hasTop: boolean;
  hasMid: boolean;
  /** capitalised singular and plural for each level; top and mid are only meant to be shown when hasTop / hasMid */
  top: string;
  topMany: string;
  mid: string;
  midMany: string;
  item: string;
  itemMany: string;
  /** "3 scenes", "1 sermon" */
  items: (n: number) => string;
}

export function wordsFor(p: Pick<Profile, "levels">): Words {
  const n = p.levels.length;
  const at = (depth: number, plural = false) => levelName(p as Profile, depth, plural);
  const hasTop = hasTopLevel(p);
  const hasMid = hasMiddleLevel(p);
  const item = at(n - 1);
  const itemMany = at(n - 1, true);
  return {
    hasTop,
    hasMid,
    top: hasTop ? at(0) : "Act",
    topMany: hasTop ? at(0, true) : "Acts",
    mid: hasMid ? at(1) : "Chapter",
    midMany: hasMid ? at(1, true) : "Chapters",
    item,
    itemMany,
    items: (c) => `${c} ${(c === 1 ? item : itemMany).toLowerCase()}`,
  };
}
