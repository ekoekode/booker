/**
 * Optional word suggestions in the editor (off by default): a small bar appears over a plain word as you write it (or when you hover it, or press Shift+Space after it) and offers
 * richer words (SAT-level and other high-register vocabulary). Clicking one swaps it in. It looks and behaves like the scripture and alias bars.
 */
import { Prec } from "@codemirror/state";
import { EditorView, keymap, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import type BookerPlugin from "../main";
import { projectOfPath } from "../project/vaultOps";
import { richFor, vocabFor } from "./vocab";
import { wordAt } from "./lookup";

interface Found {
  start: number;
  end: number;
  word: string;
  alts: string[];
}

function foundAt(plugin: BookerPlugin, view: EditorView, pos: number, any = false): Found | null {
  if (!plugin.settings.vocabSuggest) return null;
  const f = plugin.app.workspace.getActiveFile();
  if (!f || !projectOfPath(plugin.app, f.path)) return null;
  const line = view.state.doc.lineAt(pos);
  if (/^\s*(#|---|>)/.test(line.text)) return null;
  const w = wordAt(line.text, pos - line.from);
  if (!w) return null;
  const idx = plugin.english.peek();
  const syn = idx ? idx.synonyms(w.word, 60) : [];
  // a plain word gets richer ones; a richer word already written gets new ones based on itself
  let alts = vocabFor(w.word, syn, 6).length ? vocabFor(w.word, syn, 6) : richFor(w.word, syn, 6);
  // Shift+Space asks outright: any word with synonyms gets them, listed or not
  if (!alts.length && any) alts = syn.filter((x) => /^[a-z'-]+$/i.test(x) && x.toLowerCase() !== w.word.toLowerCase()).slice(0, 6);
  if (!alts.length) return null;
  return { start: line.from + w.from, end: line.from + w.to, word: w.word, alts };
}

/** The word at the cursor, or the one just left behind: the bar stays up through the space or comma typed after it. */
function foundNear(plugin: BookerPlugin, view: EditorView, pos: number): Found | null {
  const here = foundAt(plugin, view, pos);
  if (here) return here;
  if (pos < 1) return null;
  const line = view.state.doc.lineAt(pos);
  if (pos - line.from < 2 || !/[\s.,;:!?)"'”’]/.test(line.text[pos - line.from - 1])) return null;
  const prev = foundAt(plugin, view, pos - 1);
  return prev && prev.end === pos - 1 ? prev : null;
}

function swap(view: EditorView, hit: Found, alt: string) {
  if (view.state.doc.sliceString(hit.start, hit.end) !== hit.word) return;
  view.dispatch({ changes: { from: hit.start, to: hit.end, insert: alt }, selection: { anchor: hit.start + alt.length }, userEvent: "input.complete" });
  view.focus();
}

/** Shift+Space on a word: the words it steps through, and where the word is now. Dropped when the cursor moves away. */
interface Cycle {
  start: number;
  end: number;
  options: string[];
  i: number;
}

export function vocabAssist(plugin: BookerPlugin) {
  let cycle: Cycle | null = null;
  let own = false;
  let showCycle: ((c: Cycle) => void) | null = null;

  const view_ = ViewPlugin.fromClass(
    class {
      bar: HTMLElement | null = null;
      hit: Found | null = null;
      hideTimer = 0;
      showTimer = 0;
      overBar = false;

      constructor(readonly view: EditorView) {
        view.dom.addEventListener("mousemove", this.onMove);
        view.dom.addEventListener("mouseleave", this.onLeave);
        showCycle = (c) => this.showCycle(c);
      }

      update(u: ViewUpdate) {
        if (!u.docChanged && !u.selectionSet) return;
        // our own swap keeps the cycle and its bar going; any other change or a move off the word ends both
        if (own) return;
        this.hide();
        if (cycle && (u.docChanged || u.state.selection.main.head !== cycle.end)) cycle = null;
        const sel = u.state.selection.main;
        if (!plugin.settings.vocabSuggest || !sel.empty) return;
        // wait for a pause in typing, then offer words for the one just written, like the scripture bar does for a reference
        this.showTimer = window.setTimeout(() => {
          const hit = foundNear(plugin, this.view, sel.head);
          if (hit) this.show(hit, 6000);
        }, u.docChanged ? 450 : 150);
      }

      onMove = (e: MouseEvent) => {
        if (!plugin.settings.vocabSuggest || this.overBar || cycle) return;
        const pos = this.view.posAtCoords({ x: e.clientX, y: e.clientY }, false);
        const hit = pos === null ? null : foundAt(plugin, this.view, pos);
        const c = hit ? this.view.coordsAtPos(hit.start) : null;
        const d = hit ? this.view.coordsAtPos(hit.end) : null;
        const over = !!(hit && c && d && e.clientX >= c.left - 2 && e.clientX <= d.right + 2 && e.clientY >= c.top - 2 && e.clientY <= c.bottom + 2);
        window.clearTimeout(this.showTimer);
        if (over && hit) {
          if (this.hit && this.hit.start === hit.start && this.bar) return this.keep(3000);
          this.showTimer = window.setTimeout(() => this.show(hit, 3500), 350);
        } else if (this.bar && !this.overBar) this.keep(700);
      };

      onLeave = () => {
        if (cycle) return;
        window.clearTimeout(this.showTimer);
        if (this.bar && !this.overBar) this.keep(500);
      };

      keep(ms: number) {
        window.clearTimeout(this.hideTimer);
        this.hideTimer = window.setTimeout(() => this.hide(), ms);
      }

      show(hit: Found, ms: number) {
        this.bar?.remove();
        this.hit = hit;
        const bar = document.body.createDiv({ cls: "booker-scripture-pop" });
        for (const alt of hit.alts) {
          const b = bar.createEl("button", { cls: "booker-scripture-pop-btn", text: alt, attr: { "aria-label": `Use “${alt}” instead of “${hit.word}”` } });
          b.addEventListener("mousedown", (e) => e.preventDefault());
          b.addEventListener("click", () => {
            const h = this.hit;
            if (h) swap(this.view, h, alt);
            this.hide();
          });
        }
        bar.addEventListener("mouseenter", () => {
          this.overBar = true;
          window.clearTimeout(this.hideTimer);
        });
        bar.addEventListener("mouseleave", () => {
          this.overBar = false;
          this.keep(600);
        });
        this.bar = bar;
        const c = this.view.coordsAtPos(hit.start);
        if (c) {
          const h = bar.offsetHeight || 30;
          bar.style.left = `${Math.max(4, c.left)}px`;
          bar.style.top = `${Math.max(4, c.top - h - 4)}px`;
        }
        this.keep(ms);
      }

      /** The bar while Shift+Space is cycling: every word in the cycle, the one now in the text highlighted, until the cursor moves off. */
      showCycle(c: Cycle) {
        this.bar?.remove();
        window.clearTimeout(this.hideTimer);
        window.clearTimeout(this.showTimer);
        this.hit = null;
        const bar = document.body.createDiv({ cls: "booker-scripture-pop is-cycle" });
        c.options.forEach((opt, i) => {
          const b = bar.createEl("button", { cls: "booker-scripture-pop-btn" + (i === c.i ? " is-current" : ""), text: opt });
          b.addEventListener("mousedown", (e) => e.preventDefault());
          b.addEventListener("click", () => {
            if (!cycle) return;
            put(this.view, cycle.start, cycle.end, opt);
            cycle = { ...cycle, i, end: cycle.start + opt.length };
            this.showCycle(cycle);
            this.view.focus();
          });
        });
        this.bar = bar;
        const co = this.view.coordsAtPos(c.start);
        if (co) {
          const h = bar.offsetHeight || 30;
          bar.style.left = `${Math.max(4, co.left)}px`;
          bar.style.top = `${Math.max(4, co.top - h - 4)}px`;
        }
      }

      hide() {
        window.clearTimeout(this.hideTimer);
        window.clearTimeout(this.showTimer);
        this.overBar = false;
        this.bar?.remove();
        this.bar = null;
        this.hit = null;
      }

      destroy() {
        this.hide();
        this.view.dom.removeEventListener("mousemove", this.onMove);
        this.view.dom.removeEventListener("mouseleave", this.onLeave);
      }
    }
  );
  const put = (view: EditorView, from: number, to: number, text: string) => {
    own = true;
    try {
      view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length }, userEvent: "input.complete" });
    } finally {
      own = false;
    }
  };
  const keys = Prec.high(
    keymap.of([
      {
        key: "Shift-Space",
        run: (view) => {
          const sel = view.state.selection.main;
          if (!sel.empty || !plugin.settings.vocabSuggest) return false;
          // again on the word just put in: the next one, and back to the first word after the last
          if (cycle && sel.head === cycle.end) {
            const next = (cycle.i + 1) % cycle.options.length;
            const word = cycle.options[next];
            put(view, cycle.start, cycle.end, word);
            cycle = { ...cycle, i: next, end: cycle.start + word.length };
            showCycle?.(cycle);
            return true;
          }
          const hit = foundAt(plugin, view, sel.head, true);
          // only straight after a word on the list, so Shift+Space stays an ordinary space everywhere else
          if (!hit || hit.end !== sel.head) return false;
          const options = [...hit.alts, hit.word];
          put(view, hit.start, hit.end, options[0]);
          cycle = { start: hit.start, end: hit.start + options[0].length, options, i: 0 };
          showCycle?.(cycle);
          return true;
        },
      },
    ])
  );
  return [view_, keys];
}
