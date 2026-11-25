import { linkList, parseNote, patchNote } from "./format";
import { splitDate } from "./lifeSequence";
import type { AnchorEdge, AnchorMode, DateEdit, SeqItem } from "./sequence";

/**
 * Safe application of sequence edits. Pure: notes are reached through a small store, so it is testable in memory.
 * Guarantees: nothing is written unless every target still has the dates the edits were computed from (write guard);
 * every touched note is copied first; if any write fails, all of them are put back (all-or-nothing).
 */
export interface SeqStore {
  read(path: string): Promise<string | null>;
  write(path: string, text: string): Promise<void>;
}

/** Read a note's frontmatter into a sequence item. `resolve` turns a link name into a note path. */
export function itemFromFm(path: string, fm: Record<string, any>, resolve: (name: string) => string | undefined): SeqItem {
  const [when, whenEnd] = splitDate(fm.storyDate ?? fm.story_date);
  const link = linkList(fm.anchor)[0];
  const char = linkList(fm.character)[0];
  // one sequence per template per group: a character's Lives and their Eras are numbered separately
  const group = fm.sequence ? String(fm.sequence) : `${String(fm.template ?? fm.type ?? "")}/${char ?? ""}`;
  const edge = fm.anchorEdge === "start" || fm.anchorEdge === "end" ? (fm.anchorEdge as AnchorEdge) : undefined;
  const mode = fm.anchorMode === "after" || fm.anchorMode === "with" || fm.anchorMode === "before" ? (fm.anchorMode as AnchorMode) : undefined;
  return {
    path,
    group,
    seq: Number(fm.number ?? 0) || 0,
    when: when ?? "",
    whenEnd: whenEnd ?? "",
    anchor: link ? resolve(link) : undefined,
    anchorEdge: edge,
    anchorMode: mode,
    gap: fm.gap ? String(fm.gap) : undefined,
  };
}

const dateText = (when: string, whenEnd: string) => (whenEnd ? `${when}..${whenEnd}` : when);

export interface ApplyResult {
  written: string[];
  /** notes skipped because they changed since the edits were computed */
  stale: string[];
  /** set when a write failed and everything was put back */
  rolledBack?: string;
}

/**
 * `base` maps path -> the item as it was read when the edits were computed. A target whose stored dates no longer match
 * is left alone and reported as stale (someone, or a sync tool, edited it in between).
 */
export async function applyDateEdits(store: SeqStore, edits: DateEdit[], base: Map<string, SeqItem>): Promise<ApplyResult> {
  const res: ApplyResult = { written: [], stale: [] };
  const before = new Map<string, string>();
  const todo: { edit: DateEdit; text: string }[] = [];
  for (const e of edits) {
    const text = await store.read(e.path);
    const b = base.get(e.path);
    if (text === null || !b) {
      res.stale.push(e.path);
      continue;
    }
    const [w, we] = splitDate(parseNote(text).fm.storyDate ?? parseNote(text).fm.story_date);
    if ((w ?? "") !== b.when || (we ?? "") !== b.whenEnd) {
      res.stale.push(e.path);
      continue;
    }
    before.set(e.path, text);
    todo.push({ edit: e, text });
  }
  const done: string[] = [];
  try {
    for (const { edit, text } of todo) {
      await store.write(edit.path, patchNote(text, { storyDate: dateText(edit.when, edit.whenEnd) }));
      done.push(edit.path);
    }
  } catch (err) {
    for (const p of done) await store.write(p, before.get(p)!);
    res.rolledBack = err instanceof Error ? err.message : String(err);
    return res;
  }
  res.written = done;
  return res;
}
