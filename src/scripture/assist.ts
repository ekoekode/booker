/**
 * Scripture help in the editor: a reference you have just typed, or one the mouse rests on, gets a small bar with
 * Insert (writes the verses as the Reader's Insert does), Read (opens it in the Bible reader), Footnote, Cite and Word study (these put the cursor after the reference).
 * Shift+Space fills in a reference you just typed.
 */
import { Prec, type EditorState } from "@codemirror/state";
import { EditorView, keymap, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { MarkdownView, setIcon, type Editor } from "obsidian";
import type BookerPlugin from "../main";
import { parseRefs } from "./ref";
import { referenceAt } from "./ref";
import { parseCopy } from "../reader/copySettings";
import { quickQuotation } from "./quick";
import { insertFootnote } from "../writing/bar";
import { projectOfPath, scriptureOn } from "../project/vaultOps";

interface Hit {
  from: number;
  to: number;
  text: string;
}

function hitAt(view: { state: EditorState }, pos: number): Hit | null {
  const line = view.state.doc.lineAt(pos);
  const r = referenceAt(line.text, pos - line.from);
  if (!r) return null;
  const text = line.text.slice(r.from, r.to);
  return { from: line.from + r.from, to: line.from + r.to, text };
}

/** Replace a reference with its verses, written the way the Reader's Insert button writes them (the default copy settings, with a footnote). */
export async function fillReference(plugin: BookerPlugin, view: EditorView, hit: Hit) {
  const q = await quickQuotation(plugin, hit.text, parseCopy(plugin.scriptureData().copy));
  if (!q) return;
  // the document may have changed while the Bible was loading
  const doc = view.state.doc;
  if (hit.to > doc.length || doc.sliceString(hit.from, hit.to) !== hit.text) return;
  view.dispatch({ changes: { from: hit.from, to: hit.to, insert: "" }, selection: { anchor: hit.from }, userEvent: "input.complete" });
  view.focus();
  let editor: Editor | undefined;
  plugin.app.workspace.iterateAllLeaves((l) => {
    if (l.view instanceof MarkdownView && (l.view.editor as any).cm === view) editor = l.view.editor;
  });
  await plugin.insertQuoted(q, editor);
}

/** The editor helper runs only where the book wants it: ministry kinds by default, or whatever its settings say. */
export function assistOn(plugin: BookerPlugin): boolean {
  if (!plugin.settings.scriptureAssist) return false;
  const f = plugin.app.workspace.getActiveFile();
  return scriptureOn(f ? projectOfPath(plugin.app, f.path) : null);
}

export function scriptureAssist(plugin: BookerPlugin) {
  const plugin_ = ViewPlugin.fromClass(
    class {
      bar: HTMLElement | null = null;
      hit: Hit | null = null;
      hideTimer = 0;
      showTimer = 0;
      overBar = false;

      constructor(readonly view: EditorView) {
        view.dom.addEventListener("mousemove", this.onMove);
        view.dom.addEventListener("mouseleave", this.onLeave);
      }

      update(u: ViewUpdate) {
        if (!u.docChanged && !u.selectionSet) return;
        if (!assistOn(plugin)) return this.hide();
        const sel = u.state.selection.main;
        if (!sel.empty) return this.hide();
        // only while typing at the end of a reference, or moving the cursor onto one
        const hit = hitAt(u, sel.head);
        if (!hit) return this.hide();
        if (u.docChanged && sel.head !== hit.to) return this.hide();
        // layout can't be read while the editor is updating
        window.clearTimeout(this.showTimer);
        this.showTimer = window.setTimeout(() => this.show(hit, 5000), 0);
      }

      onMove = (e: MouseEvent) => {
        if (this.overBar || !assistOn(plugin)) return;
        const pos = this.view.posAtCoords({ x: e.clientX, y: e.clientY }, false);
        const hit = pos === null ? null : hitAt(this.view, pos);
        // the mouse must really be over the text of the reference, not just on the same line
        const c = hit ? this.view.coordsAtPos(hit.from) : null;
        const d = hit ? this.view.coordsAtPos(hit.to) : null;
        const over = !!(hit && c && d && e.clientX >= c.left - 2 && e.clientX <= d.right + 2 && e.clientY >= c.top - 2 && e.clientY <= c.bottom + 2);
        window.clearTimeout(this.showTimer);
        if (over && hit) {
          if (this.hit && this.hit.from === hit.from && this.hit.to === hit.to && this.bar) return this.keep(3000);
          this.showTimer = window.setTimeout(() => this.show(hit, 3000), 250);
        } else if (this.bar && !this.overBar) this.keep(700);
      };

      onLeave = () => {
        window.clearTimeout(this.showTimer);
        if (this.bar && !this.overBar) this.keep(500);
      };

      keep(ms: number) {
        window.clearTimeout(this.hideTimer);
        this.hideTimer = window.setTimeout(() => this.hide(), ms);
      }

      show(hit: Hit, ms: number) {
        const same = this.bar && this.hit && this.hit.from === hit.from && this.hit.text === hit.text;
        this.hit = hit;
        if (!same) {
          this.destroyBar();
          const bar = document.body.createDiv({ cls: "booker-scripture-pop" });
          const mk = (icon: string, label: string, tip: string, run: () => void) => {
            const b = bar.createEl("button", { cls: "booker-scripture-pop-btn" });
            setIcon(b.createSpan(), icon);
            b.createSpan({ text: label });
            b.setAttr("aria-label", tip);
            b.addEventListener("mousedown", (e) => e.preventDefault());
            b.addEventListener("click", () => {
              run();
              this.hide();
            });
          };
          mk("text-quote", "Insert", "Write out the verses here (Shift+Space)", () => {
            const h = this.hit;
            if (h) void fillReference(plugin, this.view, h);
          });
          mk("book-open", "Read", "Open this passage in the Bible reader", () => {
            const h = this.hit;
            if (h) void plugin.openBible(h.text);
          });
          /** Put the cursor straight after the reference, then run something that works at the cursor. */
          const after = (run: () => void) => () => {
            const h = this.hit;
            if (!h) return;
            this.view.dispatch({ selection: { anchor: h.to } });
            this.view.focus();
            run();
          };
          mk("superscript", "Footnote", "Add a footnote after this reference", after(() => insertFootnote(this.view)));
          mk("at-sign", "Cite", "Cite a source after this reference", after(() => plugin.withEditor((ed) => plugin.citeHere(ed))));
          mk("languages", "Word study", "Insert a Hebrew or Greek word study", after(() => void (plugin.app as any).commands.executeCommandById("booker:insert-word-study")));
          bar.addEventListener("mouseenter", () => {
            this.overBar = true;
            window.clearTimeout(this.hideTimer);
          });
          bar.addEventListener("mouseleave", () => {
            this.overBar = false;
            this.keep(600);
          });
          this.bar = bar;
        }
        const c = this.view.coordsAtPos(hit.from);
        if (c && this.bar) {
          const h = this.bar.offsetHeight || 30;
          this.bar.style.left = `${Math.max(4, c.left)}px`;
          this.bar.style.top = `${Math.max(4, c.top - h - 4)}px`;
        }
        this.keep(ms);
      }

      hide() {
        window.clearTimeout(this.hideTimer);
        window.clearTimeout(this.showTimer);
        this.overBar = false;
        this.destroyBar();
        this.hit = null;
      }

      destroyBar() {
        this.bar?.remove();
        this.bar = null;
      }

      destroy() {
        this.hide();
        this.view.dom.removeEventListener("mousemove", this.onMove);
        this.view.dom.removeEventListener("mouseleave", this.onLeave);
      }
    }
  );
  const keys = Prec.high(
    keymap.of([
      {
        key: "Shift-Space",
        run: (view) => {
          if (!plugin.settings.scriptureAssist) return false;
          const sel = view.state.selection.main;
          if (!sel.empty) return false;
          const hit = hitAt(view, sel.head);
          // only straight after a reference, so Shift+Space stays an ordinary space everywhere else
          if (!hit || sel.head !== hit.to || !parseRefs(hit.text)) return false;
          void fillReference(plugin, view, hit);
          return true;
        },
      },
    ])
  );
  return [plugin_, keys];
}
