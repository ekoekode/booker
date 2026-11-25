import { setIcon } from "obsidian";

/** Selecting text in the reader: where in a verse a selection starts and ends, colouring stretches, and the little toolbar. */

/** How many characters of `root`'s text come before the point (`node`, `off`). */
export function offsetIn(root: Node, node: Node, off: number): number {
  let n = 0;
  const walk = (cur: Node): boolean => {
    if (cur === node) {
      n += cur.nodeType === 3 ? off : 0;
      if (cur.nodeType !== 3) for (let i = 0; i < off; i++) n += (cur.childNodes[i].textContent ?? "").length;
      return true;
    }
    if (cur.nodeType === 3) n += (cur as Text).length;
    else for (const ch of Array.from(cur.childNodes)) if (walk(ch)) return true;
    return false;
  };
  walk(root);
  return n;
}

export interface Part {
  verse: number;
  start: number;
  end: number;
  text: string;
}

/** The stretch of each verse a selection covers. `rows` are verse elements with `data-v` and a `.booker-bible-vtext` holding the words. */
export function partsOf(range: Range, rows: HTMLElement[]): Part[] {
  const out: Part[] = [];
  for (const row of rows) {
    const body = row.querySelector<HTMLElement>(".booker-bible-vtext");
    if (!body || !range.intersectsNode(body)) continue;
    const full = body.textContent ?? "";
    const start = body.contains(range.startContainer) ? offsetIn(body, range.startContainer, range.startOffset) : 0;
    const end = body.contains(range.endContainer) ? offsetIn(body, range.endContainer, range.endOffset) : full.length;
    const lo = Math.min(start, end);
    const hi = Math.max(start, end);
    if (hi <= lo || !full.slice(lo, hi).trim()) continue;
    out.push({ verse: Number(row.dataset.v), start: lo, end: hi, text: full.slice(lo, hi) });
  }
  return out;
}

export interface Wrap {
  start: number;
  end: number;
  cls: string;
  data?: Record<string, string>;
}

/** Wrap stretches of an element's text (offsets into its textContent) in <mark> elements. Stretches must not overlap. Returns the marks. */
export function wrapRanges(el: HTMLElement, ranges: Wrap[]): HTMLElement[] {
  if (!ranges.length) return [];
  const doc = el.ownerDocument;
  const nodes: Array<{ node: Text; at: number }> = [];
  const walker = doc.createTreeWalker(el, 4 /* SHOW_TEXT */);
  let at = 0;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    nodes.push({ node: n as Text, at });
    at += (n as Text).length;
  }
  const marks: HTMLElement[] = [];
  for (const r of [...ranges].sort((a, b) => b.start - a.start)) {
    for (const { node, at: from } of nodes) {
      const len = node.length;
      const s = Math.max(r.start, from) - from;
      const e = Math.min(r.end, from + len) - from;
      if (e <= s || !node.parentNode) continue;
      const mid = s > 0 ? node.splitText(s) : node;
      if (e - s < mid.length) mid.splitText(e - s);
      const mark = doc.createElement("mark");
      mark.className = r.cls;
      for (const [k, v] of Object.entries(r.data ?? {})) mark.dataset[k] = v;
      mid.parentNode!.insertBefore(mark, mid);
      mark.appendChild(mid);
      marks.push(mark);
    }
  }
  return marks.sort((a, b) => (a.compareDocumentPosition(b) & 4 ? -1 : 1));
}

/** Take the marks that match a selector back out, leaving the text. */
export function unwrapMarks(el: HTMLElement, selector: string) {
  const parents = new Set<Node>();
  el.querySelectorAll(selector).forEach((m) => {
    const p = m.parentNode;
    if (!p) return;
    while (m.firstChild) p.insertBefore(m.firstChild, m);
    p.removeChild(m);
    parents.add(p);
  });
  parents.forEach((p) => p.normalize());
}

export interface BarButton {
  label: string;
  /** an icon shown before the label */
  icon?: string;
  tip?: string;
  /** a switch that is on: drawn pressed */
  on?: boolean;
  run(e: MouseEvent): void;
}

/** A small toolbar under a selection. It stays out of the way of the selection itself (mousedown is not taken). */
export function showSelectionBar(where: DOMRect | (() => DOMRect), buttons: BarButton[]): { el: HTMLElement; hide(): void; place(): void } {
  const el = document.body.createDiv({ cls: "booker-src-pop booker-sel-bar" });
  /** under the words it belongs to, wherever they are now; out of sight when they have scrolled out of view */
  const place = () => {
    const rect = typeof where === "function" ? where() : where;
    el.style.left = `${Math.max(8, rect.left)}px`;
    el.style.top = `${rect.bottom + 6}px`;
    el.toggleClass("is-offscreen", rect.bottom < 0 || rect.top > window.innerHeight);
  };
  place();
  for (const b of buttons) {
    const btn = el.createEl("button", { attr: b.tip ? { "aria-label": b.tip } : {} });
    if (b.on !== undefined) {
      btn.toggleClass("is-active", b.on);
      btn.setAttr("aria-pressed", String(b.on));
    }
    if (b.icon) setIcon(btn.createSpan({ cls: "booker-sel-ico" }), b.icon);
    btn.createSpan({ text: b.label });
    btn.addEventListener("mousedown", (e) => e.preventDefault());
    btn.addEventListener("click", (e) => b.run(e));
  }
  return { el, hide: () => el.remove(), place };
}
