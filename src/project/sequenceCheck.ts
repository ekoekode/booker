import { parseStoryDate } from "../dates";
import { anchorOf, gapYears, resolveStarts, groupOf, type AnchorDate, type SeqItem, type SeqTemplate } from "./sequence";

export type SeqFindingCode = "cycle" | "dangling-anchor" | "bad-gap" | "bad-date" | "number-gap" | "number-dup" | "overlap" | "drift" | "before-anchor";

export interface SeqFinding {
  code: SeqFindingCode;
  path: string;
  message: string;
}

/**
 * Pure integrity check over a set of sequence items. `external` holds dates of anchors outside the set; `exists` says
 * whether a note path exists (to flag anchors pointing at deleted notes).
 */
export function checkSequences(
  items: SeqItem[],
  external: Map<string, AnchorDate>,
  templateOf: (item: SeqItem) => SeqTemplate | undefined,
  exists: (path: string) => boolean,
): SeqFinding[] {
  const out: SeqFinding[] = [];
  const known = new Set(items.map((i) => i.path));

  for (const i of items) {
    if (i.when && !parseStoryDate(i.when)) out.push({ code: "bad-date", path: i.path, message: `Unreadable date "${i.when}"` });
    if (i.gap && gapYears(i.gap) === null) out.push({ code: "bad-gap", path: i.path, message: `Unreadable gap "${i.gap}"` });
    const a = i.anchor;
    if (a && !known.has(a) && !external.has(a) && !exists(a)) out.push({ code: "dangling-anchor", path: i.path, message: `Anchor ${a} no longer exists` });
  }

  const groups = new Set(items.filter((i) => i.seq > 0).map((i) => i.group));
  for (const g of groups) {
    const seq = groupOf(items, g);
    const seen = new Map<number, string>();
    seq.forEach((i, idx) => {
      if (seen.has(i.seq)) out.push({ code: "number-dup", path: i.path, message: `Sequence number ${i.seq} is also used by ${seen.get(i.seq)}` });
      else seen.set(i.seq, i.path);
      if (idx > 0 && i.seq - seq[idx - 1].seq > 1) out.push({ code: "number-gap", path: i.path, message: `Sequence jumps from ${seq[idx - 1].seq} to ${i.seq}` });
      if (idx > 0) {
        const p = parseStoryDate(seq[idx - 1].whenEnd || seq[idx - 1].when);
        const c = parseStoryDate(i.when);
        if (p && c && seq[idx - 1].whenEnd && c.start < p.start) out.push({ code: "overlap", path: i.path, message: "Starts before the previous item ends" });
      }
    });
  }

  const r = resolveStarts(items, external, templateOf);
  for (const p of r.cyclic) out.push({ code: "cycle", path: p, message: "Anchors form a loop" });
  for (const e of r.edits) out.push({ code: "drift", path: e.path, message: `Dates differ from what its anchor/sequence gives (${e.when}${e.whenEnd ? ".." + e.whenEnd : ""})` });
  for (const i of items) {
    const a = anchorOf(items, i);
    const src = a ? (items.find((x) => x.path === a) ?? external.get(a)) : undefined;
    if (!src || !i.when) continue;
    const s = parseStoryDate(i.when);
    const e = parseStoryDate(i.anchorMode === "before" ? src.when : (src.whenEnd || src.when));
    if (s && e && i.anchorMode !== "before" && i.anchorMode !== "with" && s.start < e.start) out.push({ code: "before-anchor", path: i.path, message: "Starts before its anchor" });
  }
  return out;
}
