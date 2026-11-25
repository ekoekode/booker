/**
 * Alias help in the editor: when a scene uses an alias of a Codex note in a category that suggests aliases, a small bar over it offers the
 * real name. Clicking it, or Shift+Space straight after the alias, swaps it in. It looks and behaves like the scripture bar.
 */
import { Prec } from "@codemirror/state";
import { EditorView, keymap, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { setIcon } from "obsidian";
import type BookerPlugin from "../main";
import { aliasEntries, projectOfPath } from "../project/vaultOps";
import { aliasAt, type AliasEntry, type AliasHit } from "./aliases";

interface Found extends AliasHit {
  /** document offsets */
  start: number;
  end: number;
}

function entriesFor(plugin: BookerPlugin): AliasEntry[] {
  const f = plugin.app.workspace.getActiveFile();
  const proj = f ? projectOfPath(plugin.app, f.path) : undefined;
  return proj?.aliasKinds?.length ? aliasEntries(plugin.app, proj) : [];
}

function foundAt(plugin: BookerPlugin, view: EditorView, pos: number, atEnd: boolean): Found | null {
  const entries = entriesFor(plugin);
  if (!entries.length) return null;
  const line = view.state.doc.lineAt(pos);
  const hit = aliasAt(entries, line.text, pos - line.from, atEnd);
  return hit ? { ...hit, start: line.from + hit.from, end: line.from + hit.to } : null;
}

function swap(view: EditorView, hit: Found) {
  if (view.state.doc.sliceString(hit.start, hit.end) !== hit.alias) return;
  view.dispatch({ changes: { from: hit.start, to: hit.end, insert: hit.name }, selection: { anchor: hit.start + hit.name.length }, userEvent: "input.complete" });
  view.focus();
}

export function aliasAssist(plugin: BookerPlugin) {
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
      }

      update(u: ViewUpdate) {
        if (!u.docChanged && !u.selectionSet) return;
        const sel = u.state.selection.main;
        if (!sel.empty) return this.hide();
        window.clearTimeout(this.showTimer);
        // layout can't be read while the editor is updating
        this.showTimer = window.setTimeout(() => {
          const hit = foundAt(plugin, this.view, sel.head, u.docChanged);
          if (hit) this.show(hit, 5000);
          else this.hide();
        }, 0);
      }

      onMove = (e: MouseEvent) => {
        if (this.overBar) return;
        const pos = this.view.posAtCoords({ x: e.clientX, y: e.clientY }, false);
        const hit = pos === null ? null : foundAt(plugin, this.view, pos, false);
        const c = hit ? this.view.coordsAtPos(hit.start) : null;
        const d = hit ? this.view.coordsAtPos(hit.end) : null;
        const over = !!(hit && c && d && e.clientX >= c.left - 2 && e.clientX <= d.right + 2 && e.clientY >= c.top - 2 && e.clientY <= c.bottom + 2);
        window.clearTimeout(this.showTimer);
        if (over && hit) {
          if (this.hit && this.hit.start === hit.start && this.hit.end === hit.end && this.bar) return this.keep(3000);
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

      show(hit: Found, ms: number) {
        const same = this.bar && this.hit && this.hit.start === hit.start && this.hit.name === hit.name;
        this.hit = hit;
        if (!same) {
          this.bar?.remove();
          const bar = document.body.createDiv({ cls: "booker-scripture-pop" });
          const b = bar.createEl("button", { cls: "booker-scripture-pop-btn", attr: { "aria-label": "Use the real name (Shift+Space)" } });
          setIcon(b.createSpan(), "user");
          b.createSpan({ text: hit.name });
          b.addEventListener("mousedown", (e) => e.preventDefault());
          b.addEventListener("click", () => {
            const h = this.hit;
            if (h) swap(this.view, h);
            this.hide();
          });
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
        const c = this.view.coordsAtPos(hit.start);
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
  const keys = Prec.high(
    keymap.of([
      {
        key: "Shift-Space",
        run: (view) => {
          const sel = view.state.selection.main;
          if (!sel.empty) return false;
          // only straight after an alias, so Shift+Space stays an ordinary space everywhere else
          const hit = foundAt(plugin, view, sel.head, true);
          if (!hit) return false;
          swap(view, hit);
          return true;
        },
      },
    ])
  );
  return [view_, keys];
}
