import { stringifyNote, type ProjectLayout } from "./format";

/** Names that are safe as a file name on every system. */
export function noteName(name: string): string {
  return name.replace(/[\\/:*?"<>|#^[\]\x00-\x1f]/g, "").replace(/\s+/g, " ").trim().replace(/^\.+/, "");
}

/** Project notes live in Notes/ with a title. */
export function projectNotePath(l: ProjectLayout, title: string): string {
  return `${l.notes}/${noteName(title)}.md`;
}

export function projectNoteText(title: string, today: string): string {
  return stringifyNote({ type: "note", title, created: today }, "\n");
}

// ----------------------------------------------------------------- snapshots

/**
 * A snapshot is a full copy of a scene note. They live under System/snapshots/<scene>/, away from Scenes/, so they
 * and the board never mistake a copy for a scene.
 */
export function snapshotFolder(l: ProjectLayout, sceneTitle: string): string {
  return `${l.system}/snapshots/${noteName(sceneTitle)}`;
}

const pad = (n: number) => String(n).padStart(2, "0");

export function snapshotStamp(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export function snapshotPath(l: ProjectLayout, sceneTitle: string, d: Date, label = ""): string {
  const tag = noteName(label);
  return `${snapshotFolder(l, sceneTitle)}/${snapshotStamp(d)}${tag ? ` ${tag}` : ""}.md`;
}

/** The time and label back out of a snapshot file name, or null when it is not one. */
export function parseSnapshotName(basename: string): { when: Date; label: string } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2})(\d{2})(\d{2})(?: (.+))?$/.exec(basename);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, label] = m;
  return { when: new Date(+y, +mo - 1, +d, +h, +mi, +s), label: label ?? "" };
}

// ---------------------------------------------------------------------- diff

export interface DiffLine {
  kind: "same" | "add" | "del";
  text: string;
}

/** Line by line difference between an older and a newer text (longest common subsequence). */
export function diffLines(older: string, newer: string): DiffLine[] {
  const a = older.split("\n");
  const b = newer.split("\n");
  const n = a.length;
  const m = b.length;
  const len: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) len[i][j] = a[i] === b[j] ? len[i + 1][j + 1] + 1 : Math.max(len[i + 1][j], len[i][j + 1]);
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) out.push({ kind: "same", text: a[i++] }), j++;
    else if (len[i + 1][j] >= len[i][j + 1]) out.push({ kind: "del", text: a[i++] });
    else out.push({ kind: "add", text: b[j++] });
  }
  while (i < n) out.push({ kind: "del", text: a[i++] });
  while (j < m) out.push({ kind: "add", text: b[j++] });
  return out;
}

export function diffCounts(d: DiffLine[]): { added: number; removed: number } {
  return { added: d.filter((x) => x.kind === "add").length, removed: d.filter((x) => x.kind === "del").length };
}
