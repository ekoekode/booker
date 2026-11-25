/**
 * Picking and quoting in every reader pane, the same way: click a verse, paragraph or card to pick all of it (shift for a stretch,
 * cmd/ctrl to add or take away), or drag over words to take just those. Either way a small bar offers what can be done with it.
 */
import { cutText, isDrag, type Cut } from "../../reader/partial";
import { nextPick, sortedPicks, type PickState } from "./passagePick";
import { offsetIn, showSelectionBar, type BarButton } from "./selectionBar";
import { wireQuoteClip } from "./quoteClip";
import type { Quotation } from "../../reader/quote";

/** What is taken from one unit (verse, paragraph, card): the cut, and which unit it is. */
export interface Taken extends Cut {
  index: number;
  el: HTMLElement;
}

export interface SelectOpts {
  root: HTMLElement;
  /** selects one verse, paragraph or card */
  unitSel: string;
  /** every verse, paragraph or card, in reading order */
  units(): HTMLElement[];
  /** the element holding the words of a unit */
  body(unit: HTMLElement): HTMLElement;
  /** words were picked or selected: `how` says by clicking or by dragging */
  changed?(indices: number[], how: "click" | "drag" | "set"): void;
  /** the quotation for what is taken */
  quote(taken: Taken[]): Quotation | null;
  /** the popup bar for what is taken; `done` closes it and clears the selection */
  buttons(taken: Taken[], done: () => void, whole: boolean): BarButton[];
}

/** The words of an element, without the buttons the reader adds to it. */
export function bodyText(body: HTMLElement): string {
  let t = body.textContent ?? "";
  body.querySelectorAll(":scope > .booker-quoted-go").forEach((g) => (t = t.replace((g.textContent ?? "") + "", "")));
  return t;
}

export class ReadingSelect {
  picks: PickState = { picked: new Set(), anchor: null };
  private bar: { el: HTMLElement; hide(): void; place(): void } | null = null;
  /** counts the 1 second after the mouse leaves the bar */
  private away = 0;
  private down: { x: number; y: number } | null = null;
  private offs: Array<() => void> = [];

  constructor(private o: SelectOpts) {
    const { root } = o;
    wireQuoteClip(root, () => o.quote(this.taken()), (el) => el.hasClass("is-picked"), o.unitSel);
    const on = <K extends keyof DocumentEventMap>(target: Document | HTMLElement, type: K, fn: (e: DocumentEventMap[K]) => void, capture = false) => {
      target.addEventListener(type, fn as EventListener, capture);
      this.offs.push(() => target.removeEventListener(type, fn as EventListener, capture));
    };
    on(root, "mousedown", (e) => {
      this.down = { x: e.clientX, y: e.clientY };
      // shift or cmd/ctrl pick units; they must not also stretch the browser's own selection
      if ((e.shiftKey || e.metaKey || e.ctrlKey) && this.unitOf(e.target as HTMLElement)) e.preventDefault();
    });
    on(document, "mousedown", (e) => {
      if (this.bar && !(e.target as HTMLElement).closest(".booker-sel-bar")) this.hide();
    });
    on(document, "mouseup", (e) => {
      const down = this.down;
      this.down = null;
      if (!down || !root.isConnected) return;
      const target = e.target as HTMLElement;
      if (target.closest?.(".booker-sel-bar")) return;
      window.setTimeout(() => this.released(e, down), 0);
    });
    // the bar stays under its words when the page scrolls, and goes 1 second after the mouse leaves it
    on(document, "scroll", () => this.bar?.place(), true);
    on(document, "mousemove", (e) => {
      if (!this.bar) return;
      if (this.bar.el.contains(e.target as Node)) {
        window.clearTimeout(this.away);
        this.away = 0;
        return;
      }
      if (!this.away) this.away = window.setTimeout(() => this.hide(), 1000);
    });
    on(root, "keyup", (e) => {
      if (e.shiftKey && e.key.startsWith("Arrow")) this.fromSelection();
    });
  }

  private units() {
    return this.o.units();
  }
  private unitOf(el: HTMLElement | null): HTMLElement | null {
    return el ? this.units().find((u) => u.contains(el)) ?? null : null;
  }

  /** Words selected in the pane right now, if any. */
  private range(): Range | null {
    const s = window.getSelection();
    if (!s || s.isCollapsed || !s.rangeCount) return null;
    const r = s.getRangeAt(0);
    return this.o.root.contains(r.commonAncestorContainer) && s.toString().trim() ? r : null;
  }

  private released(e: MouseEvent, down: { x: number; y: number }) {
    if (this.range()) return this.fromSelection();
    if (isDrag(down, { x: e.clientX, y: e.clientY })) return;
    const t = e.target as HTMLElement;
    if (t.closest("a, button, input, select, .booker-sel-bar")) return;
    const unit = this.unitOf(t);
    if (!unit) return;
    this.hide();
    const all = this.units();
    this.picks = nextPick(all.map((_, k) => k), this.picks, all.indexOf(unit), { shift: e.shiftKey, toggle: e.metaKey || e.ctrlKey });
    this.paint();
    this.o.root.focus({ preventScroll: true });
    const list = sortedPicks(this.picks.picked);
    this.o.changed?.(list, "click");
    const last = all[list[list.length - 1]];
    if (last) this.offer(() => last.getBoundingClientRect(), true);
  }

  /** A drag over words: take the stretch of every unit it touches. */
  private fromSelection() {
    const r = this.range();
    if (!r) return;
    const taken = this.partsOf(r);
    if (!taken.length) return this.hide();
    this.picks = { picked: new Set(taken.map((t) => t.index)), anchor: taken[0].index };
    this.paint();
    this.o.changed?.(taken.map((t) => t.index), "drag");
    const kept = r.cloneRange();
    this.offer(() => kept.getBoundingClientRect(), false);
  }

  private partsOf(r: Range): Taken[] {
    const out: Taken[] = [];
    this.units().forEach((el, index) => {
      const body = this.o.body(el);
      if (!r.intersectsNode(body)) return;
      const full = bodyText(body);
      const start = body.contains(r.startContainer) ? offsetIn(body, r.startContainer, r.startOffset) : 0;
      const end = body.contains(r.endContainer) ? offsetIn(body, r.endContainer, r.endOffset) : full.length;
      const lo = Math.min(start, end);
      const hi = Math.min(full.length, Math.max(start, end));
      if (hi > lo && full.slice(lo, hi).trim()) out.push({ index, el, full, start: lo, end: hi });
    });
    return out;
  }

  /** What is taken now: the selected words, or the whole of every picked unit. */
  taken(): Taken[] {
    const r = this.range();
    if (r) return this.partsOf(r);
    const all = this.units();
    return sortedPicks(this.picks.picked).filter((i) => all[i]).map((i) => {
      const full = bodyText(this.o.body(all[i]));
      return { index: i, el: all[i], full, start: 0, end: full.length };
    });
  }

  /** The words as the quotation will write them, cut ends marked. */
  words(taken = this.taken()): string[] {
    return taken.map(cutText).filter(Boolean);
  }

  private offer(rect: () => DOMRect, whole: boolean) {
    this.hide();
    const taken = this.taken();
    if (!taken.length) return;
    const done = () => {
      this.hide();
      window.getSelection()?.removeAllRanges();
    };
    this.bar = showSelectionBar(rect, this.o.buttons(taken, done, whole));
  }

  paint() {
    this.units().forEach((u, i) => u.toggleClass("is-picked", this.picks.picked.has(i)));
  }

  /** Pick these units without a bar (a verse the reader was opened at). */
  set(indices: number[]) {
    this.picks = { picked: new Set(indices), anchor: indices[0] ?? null };
    this.paint();
    this.o.changed?.(indices, "set");
  }

  reset() {
    this.picks = { picked: new Set(), anchor: null };
    this.hide();
  }

  hide() {
    window.clearTimeout(this.away);
    this.away = 0;
    this.bar?.hide();
    this.bar = null;
  }

  destroy() {
    this.hide();
    this.offs.forEach((f) => f());
    this.offs = [];
  }
}
