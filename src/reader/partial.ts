/** Words taken from the middle of a passage show where they were cut with an ellipsis. Pure. */

export interface Cut {
  /** the whole text of the verse, paragraph or card */
  full: string;
  /** the stretch taken, as offsets into `full` */
  start: number;
  end: number;
}

export const ELLIPSIS = "…";

/** One cut as words: an ellipsis before when something was left off the start, and after when something was left off the end. */
export function cutText(c: Cut): string {
  const lo = Math.max(0, Math.min(c.start, c.end));
  const hi = Math.min(c.full.length, Math.max(c.start, c.end));
  const words = c.full.slice(lo, hi).replace(/\s+/g, " ").trim();
  if (!words) return "";
  const before = c.full.slice(0, lo).trim() !== "";
  const after = c.full.slice(hi).trim() !== "";
  return `${before ? `${ELLIPSIS} ` : ""}${words}${after ? ` ${ELLIPSIS}` : ""}`;
}

/** True when the cut is the whole text, so nothing needs marking. */
export const isWhole = (c: Cut): boolean => cutText({ ...c, start: 0, end: c.full.length }) === cutText(c);

/** A pointer that moved this far between pressing and letting go was dragging, not clicking. */
export const DRAG_DISTANCE = 4;
export const isDrag = (from: { x: number; y: number }, to: { x: number; y: number }): boolean => Math.hypot(to.x - from.x, to.y - from.y) >= DRAG_DISTANCE;
