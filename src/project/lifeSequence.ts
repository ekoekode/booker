import { shiftStoryDate, resizeStoryDate } from "../dates";

/** Days between the end of one life and the start of the next in a sequence. */
export const LIFE_GAP_DAYS = 3;
const GAP_YEARS = LIFE_GAP_DAYS / 365.25;

/** A life as the sequence sees it: `seq` is its sequence number, 0 or missing when it floats free. */
export interface SeqLife {
  path: string;
  character: string;
  seq: number;
  when: string;
  whenEnd: string;
}

export interface SeqEdit {
  path: string;
  kind: "shift" | "start" | "end";
}

/** Lives of a character that are in a sequence, in order. */
export function sequenceOf(lives: SeqLife[], character: string): SeqLife[] {
  return lives.filter((l) => l.character === character && l.seq > 0 && l.when).sort((a, b) => a.seq - b.seq);
}

/**
 * The start for the life that follows `prev`: three days after prev ends. A life with no end yet gives no answer (it has no
 * last day to count from).
 */
export function nextLifeStart(prevWhen: string, prevEnd: string, anchor?: number): string {
  if (!prevEnd) return "";
  return shiftStoryDate(prevEnd, "", GAP_YEARS, anchor).when;
}

/**
 * What else moves when one life in a sequence is dragged, so the gaps between lives stay as they were.
 * Dragging an end moves only the start of the next life; dragging a start moves only the end of the life before it; moving a
 * life does both. With `all` (shift held) the lives after it move as a block instead of just the next one's start.
 */
export function followers(seq: SeqLife[], path: string, mode: "move" | "start" | "end", all = false): SeqEdit[] {
  const i = seq.findIndex((l) => l.path === path);
  if (i < 0) return [];
  const out: SeqEdit[] = [];
  if ((mode === "start" || mode === "move") && i > 0) out.push({ path: seq[i - 1].path, kind: "end" });
  if ((mode === "end" || mode === "move") && i < seq.length - 1) {
    if (all) for (const l of seq.slice(i + 1)) out.push({ path: l.path, kind: "shift" });
    else out.push({ path: seq[i + 1].path, kind: "start" });
  }
  return out;
}

export function applyEdit(l: SeqLife, e: SeqEdit, dT: number, anchor?: number): { when: string; when_end: string } {
  return e.kind === "shift" ? shiftStoryDate(l.when, l.whenEnd, dT, anchor) : resizeStoryDate(l.when, l.whenEnd, e.kind, dT, anchor);
}

/** A note keeps its dates in one property: "1342-05-03" or, for a span, "1342-05-03..1342-06-01". */
export function splitDate(v: unknown): [string, string] {
  const t = v === undefined || v === null ? "" : String(v).trim();
  const i = t.indexOf("..");
  return i > 0 ? [t.slice(0, i).trim(), t.slice(i + 2).trim()] : [t, ""];
}
