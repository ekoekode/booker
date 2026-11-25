/** Front and back matter: the pages before and after the chapters. Each is a note in the book's Matter folder. */

export type MatterPosition = "front" | "back";

/** Parts the export makes itself from the project note or the citations, so they get no note. */
const AUTOMATIC = new Set(["title", "copyright", "dedication", "bibliography", "scripture index", "references", "works cited", "about the author"]);

export interface MatterPlan {
  position: MatterPosition;
  title: string;
}

export const titleCase = (s: string) => s.replace(/\b([a-z])/g, (_, c: string) => c.toUpperCase()).replace(/\b(Of|The|To|A|And|In)\b(?!^)/g, (m, w: string, off: number) => (off === 0 ? w : w.toLowerCase()));

/** The notes a new book of this kind starts with, in order. */
export function matterPlan(front: string[], back: string[]): MatterPlan[] {
  const keep = (list: string[], position: MatterPosition) => list.filter((t) => !AUTOMATIC.has(t.trim().toLowerCase())).map((t) => ({ position, title: titleCase(t.trim()) }));
  return [...keep(front, "front"), ...keep(back, "back")];
}

export function matterFileName(index: number, title: string): string {
  const clean = title.replace(/[\\/:*?"<>|]/g, "-").trim();
  return `${String(index + 1).padStart(2, "0")} ${clean}.md`;
}

export interface MatterNote {
  position: MatterPosition;
  title: string;
  path: string;
  /** false when the page is switched off: it stays in the book but is left out of the export and the checks */
  enabled: boolean;
}

/** Sort by position (front first), then by the number at the start of the file name. */
export function sortMatter<T extends { position: MatterPosition; path: string }>(list: T[]): T[] {
  const name = (p: string) => p.slice(p.lastIndexOf("/") + 1);
  return [...list].sort((a, b) => (a.position === b.position ? name(a.path).localeCompare(name(b.path), undefined, { numeric: true }) : a.position === "front" ? -1 : 1));
}

/** Number to give the next note added to a position. */
export function nextMatterIndex(names: string[]): number {
  return names.reduce((m, n) => Math.max(m, parseInt(n, 10) || 0), 0);
}

/** Names for two neighbouring notes once they trade places: each takes the other's number. Null when a name has no number. */
export function swapMatterNames(a: string, b: string): [string, string] | null {
  const num = /^(\d+)(\s.*)$/;
  const ma = num.exec(a);
  const mb = num.exec(b);
  if (!ma || !mb) return null;
  return [`${mb[1]}${ma[2]}`, `${ma[1]}${mb[2]}`];
}

/**
 * Renames that put the page at `from` into slot `to` (its final place in the list), keeping the same set of numbers in the same order.
 * `names` are the file names of one section in order. Null when a name has no number; an empty list when nothing changes.
 */
export function reorderMatterNames(names: string[], from: number, to: number): Array<{ from: string; to: string }> | null {
  if (from < 0 || from >= names.length || to < 0 || to >= names.length) return [];
  const num = /^(\d+)(\s.*)$/;
  const parts = names.map((n) => num.exec(n));
  if (parts.some((m) => !m)) return null;
  if (from === to) return [];
  const order = names.map((n, i) => i);
  order.splice(to, 0, order.splice(from, 1)[0]);
  const out: Array<{ from: string; to: string }> = [];
  order.forEach((src, slot) => {
    const next = `${parts[slot]![1]}${parts[src]![2]}`;
    if (next !== names[src]) out.push({ from: names[src], to: next });
  });
  return out;
}
