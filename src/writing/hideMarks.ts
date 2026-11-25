/**
 * Hide the Markdown marks (heading `#`s and `**`, `*`, `~~`, `==`, `__`, `_`) around formatted words while editing, even in the paragraph the cursor is in.
 * A pair of marks stays in the text, and stays protected, for as long as something other than spaces is between them.
 * Once the words between them are gone (or only spaces are left) the marks go too.
 */
import { EditorState, Extension, RangeSetBuilder, StateEffect } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";

export interface MarkSpan {
  open: [number, number];
  close: [number, number];
  inner: [number, number];
}

export interface Chg {
  from: number;
  to: number;
  insert: string;
}

const isWord = (c: string | undefined) => !!c && /[\p{L}\p{N}]/u.test(c);
const isSpace = (c: string | undefined) => c === undefined || /\s/.test(c);

/** The pairs of marks on one line, with offsets into that line. */
export function findSpans(text: string): MarkSpan[] {
  const spans: MarkSpan[] = [];
  const stack: Array<{ tok: string; at: number }> = [];
  const n = text.length;
  let i = 0;
  const closeAt = (tok: string, p: number): boolean => {
    for (let k = stack.length - 1; k >= 0; k--) {
      if (stack[k].tok !== tok) continue;
      const o = stack[k];
      if (isSpace(text[p - 1]) || text.slice(o.at + tok.length, p).trim() === "") return false;
      if (tok[0] === "_" && isWord(text[p + tok.length])) return false;
      spans.push({ open: [o.at, o.at + tok.length], inner: [o.at + tok.length, p], close: [p, p + tok.length] });
      stack.length = k;
      return true;
    }
    return false;
  };
  const openAt = (tok: string, p: number) => {
    if (isSpace(text[p + tok.length])) return;
    if (tok[0] === "_" && isWord(text[p - 1])) return;
    stack.push({ tok, at: p });
  };
  while (i < n) {
    const c = text[i];
    if (c === "\\") {
      i += 2;
    } else if (c === "`") {
      let r = 1;
      while (text[i + r] === "`") r++;
      const end = text.indexOf("`".repeat(r), i + r);
      i = end < 0 ? i + r : end + r;
    } else if (c === "*" || c === "_") {
      let run = 1;
      while (text[i + run] === c) run++;
      let p = i;
      let left = run;
      while (left > 0) {
        const top = stack[stack.length - 1];
        const tok = top && top.tok[0] === c && top.tok.length <= left ? top.tok : left >= 2 ? c + c : c;
        if (!closeAt(tok, p)) openAt(tok, p);
        p += tok.length;
        left -= tok.length;
      }
      i += run;
    } else if ((c === "~" || c === "=") && text[i + 1] === c && text[i + 2] !== c) {
      if (!closeAt(c + c, i)) openAt(c + c, i);
      i += 2;
    } else i++;
  }
  return spans.sort((a, b) => a.open[0] - b.open[0]);
}

/** Lines the marks are left alone in: the properties block and fenced code. */
function skipped(lines: string[]): boolean[] {
  const out = lines.map(() => false);
  let i = 0;
  if (lines[0]?.trim() === "---") {
    const end = lines.findIndex((l, k) => k > 0 && l.trim() === "---");
    if (end > 0) for (; i <= end; i++) out[i] = true;
  }
  let fence = "";
  for (; i < lines.length; i++) {
    const m = /^\s*(`{3,}|~{3,})/.exec(lines[i]);
    if (fence) {
      out[i] = true;
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length) fence = "";
    } else if (m) {
      out[i] = true;
      fence = m[1];
    }
  }
  return out;
}

/** Every pair of marks in a document, with offsets into it. */
export function allSpans(doc: string): MarkSpan[] {
  const lines = doc.split("\n");
  const skip = skipped(lines);
  const out: MarkSpan[] = [];
  let at = 0;
  lines.forEach((l, k) => {
    if (!skip[k] && /[*_~=]/.test(l)) {
      for (const s of findSpans(l)) out.push({ open: [s.open[0] + at, s.open[1] + at], inner: [s.inner[0] + at, s.inner[1] + at], close: [s.close[0] + at, s.close[1] + at] });
    }
    at += l.length + 1;
  });
  return out;
}

type Range = [number, number];

/** The leading `#` marks (and the space after them) of every heading that has words, with offsets into the document. */
export function headingMarks(doc: string): Range[] {
  const lines = doc.split("\n");
  const skip = skipped(lines);
  const out: Range[] = [];
  let at = 0;
  lines.forEach((l, k) => {
    if (!skip[k]) {
      const m = /^(#{1,6})[ \t]+(?=\S)/.exec(l);
      if (m) out.push([at, at + m[0].length]);
    }
    at += l.length + 1;
  });
  return out;
}

const subtract = (from: number, to: number, cut: Range[]): Range[] => {
  let parts: Range[] = [[from, to]];
  for (const [a, b] of cut) {
    parts = parts.flatMap(([x, y]) => (b <= x || a >= y ? [[x, y] as Range] : [[x, Math.min(y, a)] as Range, [Math.max(x, b), y] as Range].filter(([p, q]) => q > p)));
  }
  return parts;
};

/**
 * Rework edits so they never break a pair of marks that still has words in it. Deleting what is inside a pair keeps the marks;
 * deleting all of it (or leaving only spaces) takes the marks with it. Backspace or Delete right beside a mark removes the nearest letter instead.
 * `dir` is set for a single Backspace ("back") or Delete ("forward").
 */
export function protectChanges(doc: string, changes: Chg[], dir: "back" | "forward" | null = null): Chg[] {
  if (!changes.some((c) => c.to > c.from)) return changes;
  const spans = allSpans(doc);
  if (!spans.length) return changes;
  const marks = (): Range[] => spans.flatMap((s) => [s.open, s.close]);
  const out: Chg[] = [];
  for (const c of changes) {
    if (c.to <= c.from) {
      out.push(c);
      continue;
    }
    let { from, to } = c;
    const keep: Range[] = [];
    for (const s of spans) {
      const start = s.open[0];
      const end = s.close[1];
      if (!(c.from < end && c.to > start)) continue;
      let left = doc.slice(s.inner[0], s.inner[1]);
      const a = Math.max(c.from, s.inner[0]) - s.inner[0];
      const b = Math.min(c.to, s.inner[1]) - s.inner[0];
      if (b > a) left = left.slice(0, a) + left.slice(b);
      if (c.from >= s.open[0] && c.from <= s.inner[1]) left += c.insert;
      if (left.trim() === "" && c.insert.trim() === "") {
        from = Math.min(from, start);
        to = Math.max(to, end);
      } else keep.push(s.open, s.close);
    }
    const cut = keep.filter(([a, b]) => b > from && a < to);
    const parts = subtract(from, to, cut);
    if (!parts.length && !c.insert && dir) {
      const all = marks();
      let pos = dir === "back" ? c.from : c.to;
      for (let moved = true; moved; ) {
        moved = false;
        for (const [a, b] of all) {
          if (dir === "back" && pos > a && pos <= b) (pos = a), (moved = true);
          if (dir === "forward" && pos >= a && pos < b) (pos = b), (moved = true);
        }
      }
      const one: Chg = dir === "back" ? { from: pos - 1, to: pos, insert: "" } : { from: pos, to: pos + 1, insert: "" };
      if (one.from >= 0 && one.to <= doc.length && doc[one.from] !== "\n" && doc[one.to - 1] !== "\n") out.push(...protectChanges(doc, [one], null));
      continue;
    }
    if (!parts.length) {
      if (c.insert) out.push({ from: c.from, to: c.from, insert: c.insert });
      continue;
    }
    parts.forEach(([a, b], k) => out.push({ from: a, to: b, insert: k === 0 ? c.insert : "" }));
  }
  return out;
}

/** Sent to an editor to rebuild the hidden marks after the setting changed. */
export const refreshMarks = StateEffect.define<null>();

function hidden(state: EditorState, on: (s: EditorState) => boolean): DecorationSet {
  if (!on(state)) return Decoration.none;
  const b = new RangeSetBuilder<Decoration>();
  const hide = Decoration.replace({});
  const text = state.doc.toString();
  const ranges = [...allSpans(text).flatMap((s) => [s.open, s.close]), ...headingMarks(text)].sort((x, y) => x[0] - y[0]);
  let last = 0;
  for (const [a, z] of ranges) {
    if (a < last) continue;
    b.add(a, z, hide);
    last = z;
  }
  return b.finish();
}

/** `on` says whether a given editor hides its marks (the setting, a project note, Live Preview). */
export function hideMarksExtension(on: (s: EditorState) => boolean): Extension {
  const view = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      private was: boolean;
      constructor(v: EditorView) {
        this.was = on(v.state);
        this.decorations = hidden(v.state, on);
        window.setTimeout(() => v.dom.isConnected && v.dispatch({ effects: refreshMarks.of(null) }), 100);
      }
      update(u: ViewUpdate) {
        // a note's file and Live Preview are only known after the editor is made, so the answer is asked again on every update
        const now = on(u.state);
        if (u.docChanged || now !== this.was || u.transactions.some((t) => t.effects.some((e) => e.is(refreshMarks)))) {
          this.was = now;
          this.decorations = hidden(u.state, on);
        }
      }
    },
    { decorations: (v) => v.decorations, provide: (p) => EditorView.atomicRanges.of((v) => v.plugin(p)?.decorations ?? Decoration.none) }
  );
  const guard = EditorState.transactionFilter.of((tr) => {
    if (!tr.docChanged || !(tr.isUserEvent("input") || tr.isUserEvent("delete")) || !on(tr.startState)) return tr;
    const before: Chg[] = [];
    tr.changes.iterChanges((from, to, _a, _b, text) => before.push({ from, to, insert: text.toString() }));
    const dir = tr.isUserEvent("delete.backward") ? "back" : tr.isUserEvent("delete.forward") ? "forward" : null;
    const after = protectChanges(tr.startState.doc.toString(), before, dir);
    if (JSON.stringify(after) === JSON.stringify(before)) return tr;
    const changes = tr.startState.changes(after);
    const inserted = after.find((c) => c.insert);
    return [{ changes, selection: inserted ? { anchor: changes.mapPos(inserted.from, 1) } : tr.startState.selection.map(changes, 1), userEvent: "delete", scrollIntoView: true }];
  });
  return [view, guard];
}
