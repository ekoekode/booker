import { Editor, EditorPosition, EditorSuggest, EditorSuggestContext, EditorSuggestTriggerInfo, TFile } from "obsidian";
import type BookerPlugin from "../main";
import type { Source } from "../sources/types";

/** Typing [@ lists your sources; picking one writes [@key, ] with the cursor ready for the page. */
export class CiteSuggest extends EditorSuggest<Source> {
  constructor(private plugin: BookerPlugin) {
    super(plugin.app);
  }

  onTrigger(cursor: EditorPosition, editor: Editor, _file: TFile | null): EditorSuggestTriggerInfo | null {
    const before = editor.getLine(cursor.line).slice(0, cursor.ch);
    const m = /\[@([A-Za-z0-9_:.-]*)$/.exec(before);
    if (!m) return null;
    return { start: { line: cursor.line, ch: cursor.ch - m[0].length }, end: cursor, query: m[1] };
  }

  getSuggestions(ctx: EditorSuggestContext): Source[] {
    const q = ctx.query.toLowerCase();
    const all = this.plugin.sources().filter((s) => s.kind !== "db");
    return all
      .filter((s) => !q || s.citekey.toLowerCase().includes(q) || s.title.toLowerCase().includes(q) || s.authors.some((a) => a.toLowerCase().includes(q)))
      .slice(0, 30);
  }

  renderSuggestion(s: Source, el: HTMLElement) {
    el.createDiv({ text: s.title });
    el.createEl("small", { text: `${s.authors.join(", ")}${s.year ? ` (${s.year})` : ""} · ${s.citekey}` });
  }

  selectSuggestion(s: Source) {
    const ctx = this.context;
    if (!ctx) return;
    const text = `[@${s.citekey}, ]`;
    ctx.editor.replaceRange(text, ctx.start, ctx.end);
    ctx.editor.setCursor({ line: ctx.start.line, ch: ctx.start.ch + text.length - 1 });
  }
}
