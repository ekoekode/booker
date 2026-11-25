/**
 * Footnote numbering and placement for an export. Pure: works on the manuscript model, so Word, ePub and PDF share it.
 */
import type { ActDoc, Block, ChapterDoc, Manuscript, Run } from "./model";

/** Where the notes are printed: at the foot of the page, at the end of each chapter, or in one list at the end of the book. */
export type NotePlacement = "bottom" | "chapter" | "book";
/** Whether numbering starts again at 1 in each chapter or runs through the book. */
export type NoteNumbering = "chapter" | "book";

export interface NoteItem {
  n: number;
  runs: Run[];
}

export const NOTE_PLACEMENTS: Record<NotePlacement, string> = { bottom: "Foot of the page", chapter: "End of each chapter", book: "End of the book" };

const eachRun = (blocks: Block[], f: (r: Run) => void) => {
  for (const b of blocks) if (b.kind !== "rule") for (const r of b.runs) f(r);
};

/**
 * A copy of the manuscript where every footnote mark carries its printed number. Page-bottom notes in Word are
 * numbered by Word itself through the whole document, so for that case pass numbering "book".
 */
export function numberNotes(m: Manuscript, numbering: NoteNumbering): Manuscript {
  let n = 0;
  const acts: ActDoc[] = m.acts.map((a) => ({
    ...a,
    chapters: a.chapters.map((c) => {
      if (numbering === "chapter") n = 0;
      return {
        ...c,
        scenes: c.scenes.map((s) => ({
          ...s,
          blocks: s.blocks.map((b): Block => {
            if (b.kind === "rule" || !b.runs.some((r) => r.note)) return b;
            return { ...b, runs: b.runs.map((r) => (r.note ? { ...r, noteNo: ++n } : r)) };
          }),
        })),
      };
    }),
  }));
  return { ...m, acts };
}

/** The notes of one chapter in order (the manuscript must have been through numberNotes). */
export function chapterNotes(c: ChapterDoc): NoteItem[] {
  const out: NoteItem[] = [];
  for (const s of c.scenes) eachRun(s.blocks, (r) => r.note && out.push({ n: r.noteNo ?? out.length + 1, runs: r.note }));
  return out;
}

export function hasNotes(m: Manuscript): boolean {
  return m.acts.some((a) => a.chapters.some((c) => c.scenes.some((s) => s.blocks.some((b) => b.kind !== "rule" && b.runs.some((r) => r.note)))));
}

/** Notes grouped by chapter, for the list at the end of the book. Chapters with no notes are left out. */
export function bookNotes(m: Manuscript): Array<{ chapter: ChapterDoc; notes: NoteItem[] }> {
  return m.acts.flatMap((a) => a.chapters).map((chapter) => ({ chapter, notes: chapterNotes(chapter) })).filter((x) => x.notes.length);
}
