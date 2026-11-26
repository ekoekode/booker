import { EditorState, Extension, Prec, RangeSetBuilder, StateEffect } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate, keymap } from "@codemirror/view";
import { classifyLines, EM_SPACE } from "./lines";
import { FONTS } from "../export/fonts";

export interface WritingFormat {
  /** typeset prose in the editor (the text itself never changes) */
  on: boolean;
  /** first-line indent in em, 0 for none */
  indent: number;
  /** extra space before each paragraph in em */
  paragraphGap: number;
  /** extra space before each line of dialogue in em */
  dialogueGap: number;
  /** show the automatic first-line indent (off: paragraphs sit flush left, spacing stays) */
  autoIndent: boolean;
  /** also indent the first paragraph after a heading or scene break */
  indentFirst: boolean;
  /** Tab at the start of a line inserts an em space */
  tabIndent: boolean;
  /** show the formatting buttons above the editor */
  bar: boolean;
  /** write in the font the book export uses (Literata) */
  bookFont: boolean;
}

/** Sent to an editor to rebuild its line classes after the format settings changed. */
export const refreshFormat = StateEffect.define<null>();

export const DEFAULT_FORMAT: WritingFormat = { on: true, indent: 1.5, paragraphGap: 0.4, dialogueGap: 0.2, autoIndent: true, indentFirst: false, tabIndent: true, bar: true, bookFont: true };

const mark = {
  text: Decoration.line({ class: "nv-text" }),
  first: Decoration.line({ class: "nv-text nv-first" }),
  dialogue: Decoration.line({ class: "nv-text nv-dialogue" }),
  firstDialogue: Decoration.line({ class: "nv-text nv-first nv-dialogue" }),
  block: Decoration.line({ class: "nv-block" }),
};

const firstWithLetter = new Map<string, Decoration>();
/** a first line that carries its letter, so the stylesheet can draw the illuminated one */
function openingMark(ch: string, dialogue: boolean): Decoration {
  const key = ch + (dialogue ? "d" : "");
  let d = firstWithLetter.get(key);
  if (!d) {
    d = Decoration.line({ class: dialogue ? "nv-text nv-first nv-dialogue" : "nv-text nv-first", attributes: { "data-ini": ch } });
    firstWithLetter.set(key, d);
  }
  return d;
}

function build(view: EditorView): DecorationSet {
  const b = new RangeSetBuilder<Decoration>();
  const doc = view.state.doc;
  const lines: string[] = [];
  for (let i = 1; i <= doc.lines; i++) lines.push(doc.line(i).text);
  classifyLines(lines).forEach((info, i) => {
    if (info.kind !== "text") {
      if (info.block) b.add(doc.line(i + 1).from, doc.line(i + 1).from, mark.block);
      return;
    }
    const line = doc.line(i + 1);
    const letter = info.first ? /^[\s\u2003]*([A-Za-z])/.exec(line.text)?.[1]?.toUpperCase() : undefined;
    b.add(line.from, line.from, letter ? openingMark(letter, info.dialogue) : info.first ? (info.dialogue ? mark.firstDialogue : mark.first) : info.dialogue ? mark.dialogue : mark.text);
  });
  return b.finish();
}

/** Typeset the native editor with line classes only, so other plugins that share it (live cursors, for example) keep working. */
export function writingExtension(get: (state: EditorState) => WritingFormat): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = get(view.state).on ? build(view) : Decoration.none;
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.transactions.some((t) => t.effects.some((e) => e.is(refreshFormat)))) this.decorations = get(u.view.state).on ? build(u.view) : Decoration.none;
      }
    },
    { decorations: (v) => v.decorations }
  );
  /** A prose line: not a list, heading, quote, table or blank. Those keep Obsidian's own Tab and Enter. */
  const prose = (text: string) => text.trim() !== "" && !/^\s*([-*+>#|]|\d+[.)]|```|~~~)/.test(text);
  const tab = Prec.high(
    keymap.of([
      {
        key: "Tab",
        run: (view) => {
          const f = get(view.state);
          const sel = view.state.selection.main;
          if (!f.on || !f.tabIndent || !sel.empty) return false;
          const line = view.state.doc.lineAt(sel.head);
          if (!prose(line.text)) return false;
          // the indent always goes at the start of the paragraph, wherever the cursor is, and never as a real tab (that would make a code block)
          view.dispatch({ changes: { from: line.from, insert: EM_SPACE }, selection: { anchor: sel.head + EM_SPACE.length } });
          return true;
        },
      },
      {
        key: "Shift-Tab",
        run: (view) => {
          const f = get(view.state);
          const sel = view.state.selection.main;
          if (!f.on || !f.tabIndent) return false;
          const line = view.state.doc.lineAt(sel.head);
          if (!/^[\u2003\t]/.test(line.text)) return false;
          view.dispatch({ changes: { from: line.from, to: line.from + 1 }, selection: { anchor: Math.max(line.from, sel.head - 1) } });
          return true;
        },
      },
      {
        // a new paragraph starts clean: the typeset indent already shows, so the manual one is not carried over
        key: "Enter",
        run: (view) => {
          const f = get(view.state);
          const sel = view.state.selection.main;
          if (!f.on || !f.tabIndent) return false;
          const line = view.state.doc.lineAt(sel.head);
          if (!/^[\u2003\t]/.test(line.text) || !prose(line.text)) return false;
          view.dispatch({ changes: { from: sel.from, to: sel.to, insert: "\n" }, selection: { anchor: sel.from + 1 }, userEvent: "input" });
          return true;
        },
      },
    ])
  );
  return [plugin, tab];
}

/** Push the numbers to CSS variables on the page; the stylesheet does the typesetting. */
let fontsLoaded = false;

/** Make the book export's font (Literata, kept inside the plugin) available to the editor as "Booker Literata". */
export function loadBookFont() {
  if (fontsLoaded || typeof FontFace === "undefined") return;
  fontsLoaded = true;
  const faces: Array<[Uint8Array, string, string]> = [[FONTS.regular, "normal", "normal"], [FONTS.italic, "italic", "normal"], [FONTS.bold, "normal", "bold"], [FONTS.boldItalic, "italic", "bold"]];
  for (const [data, style, weight] of faces) {
    const face = new FontFace("Booker Literata", new Uint8Array(data).buffer, { style, weight });
    void face.load().then(() => (document.fonts as unknown as { add(f: FontFace): void }).add(face)).catch(() => undefined);
  }
}

/** The classes and variables that typeset one editor, to be put on that editor (so each project can have its own format). */
export function formatAttrs(f: WritingFormat): { class: string; style: string } {
  if (f.bookFont) loadBookFont();
  const cls = [f.on && "booker-fmt-on", f.bookFont && "booker-book-font", !f.bar && "booker-fmtbar-off", f.indentFirst && "booker-fmt-indent-first", !f.autoIndent && "booker-fmt-no-indent"].filter(Boolean).join(" ");
  return { class: cls, style: `--nv-indent:${f.indent}em;--nv-gap:${f.paragraphGap}em;--nv-dlg-gap:${f.dialogueGap}em;` };
}
