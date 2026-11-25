import { planFootnote } from "../notes/footnote";
import { calloutMenu } from "../notes/calloutMenu";
import { EditorSelection, Extension } from "@codemirror/state";
import { EditorView, Panel, showPanel } from "@codemirror/view";
import { Menu, Notice, setIcon, TFile } from "obsidian";
import type BookerPlugin from "../main";
import { findProjects, splitScene } from "../project/vaultOps";
import { NamePrompt, notifyError } from "../ui";
import { clearFormatting, cursorAfter, toggleWrap, togglePrefix } from "./wrap";

interface Tool {
  icon: string;
  tip: string;
  run: (view: EditorView, ev: MouseEvent) => void;
}

function wrap(open: string, close = open) {
  return (view: EditorView) => {
    const doc = view.state.doc.toString();
    view.dispatch(
      view.state.changeByRange((r) => {
        const e = toggleWrap(doc, r.from, r.to, open, close);
        return { changes: e.changes, range: EditorSelection.range(e.anchor, e.head) };
      }),
      { userEvent: "input" }
    );
    view.focus();
  };
}

function prefix(p: string) {
  return (view: EditorView) => {
    const line = view.state.doc.lineAt(view.state.selection.main.head);
    const next = togglePrefix(line.text, p);
    view.dispatch({ changes: { from: line.from, to: line.to, insert: next }, selection: { anchor: cursorAfter(line, next, view.state.selection.main.head) }, userEvent: "input" });
    view.focus();
  };
}

export function insertFootnote(view: EditorView, letters = false) {
  const doc = view.state.doc;
  const e = planFootnote(doc.toString(), view.state.selection.main.to, letters);
  view.dispatch({
    changes: [
      { from: e.markAt, insert: e.mark },
      { from: e.appendAt, to: doc.length, insert: e.append },
    ],
    selection: { anchor: e.cursor },
    scrollIntoView: true,
    userEvent: "input",
  });
  view.focus();
}

function sceneBreak(view: EditorView) {
  const line = view.state.doc.lineAt(view.state.selection.main.head);
  const insert = `\n\n***\n\n`;
  view.dispatch({ changes: { from: line.to, insert }, selection: { anchor: line.to + insert.length }, userEvent: "input" });
  view.focus();
}

function clear(view: EditorView) {
  const r = view.state.selection.main;
  const from = r.empty ? view.state.doc.lineAt(r.head).from : r.from;
  const to = r.empty ? view.state.doc.lineAt(r.head).to : r.to;
  const text = view.state.sliceDoc(from, to);
  view.dispatch({ changes: { from, to, insert: clearFormatting(text) }, userEvent: "input" });
  view.focus();
}

function headingMenu(view: EditorView, ev: MouseEvent) {
  const menu = new Menu();
  const set = (p: string) => () => {
    const line = view.state.doc.lineAt(view.state.selection.main.head);
    const plain = line.text.replace(/^#{1,6} /, "");
    view.dispatch({ changes: { from: line.from, to: line.to, insert: p + plain }, selection: { anchor: cursorAfter(line, p + plain, view.state.selection.main.head) }, userEvent: "input" });
    view.focus();
  };
  menu.addItem((i) => i.setTitle("Paragraph").setIcon("pilcrow").onClick(set("")));
  for (let n = 1; n <= 4; n++) menu.addItem((i) => i.setTitle(`Heading ${n}`).setIcon(`heading-${n}`).onClick(set("#".repeat(n) + " ")));
  menu.showAtMouseEvent(ev);
}

/** Cut the scene at the cursor: what follows goes into a new scene right after this one. */
function splitHere(plugin: BookerPlugin, view: EditorView) {
  const file = plugin.app.workspace.getActiveFile();
  const proj = file && findProjects(plugin.app).find((p) => file.path.startsWith(p.layout.scenes + "/"));
  if (!file || !proj) return void new Notice("Booker: open one of the book's scenes to split it.");
  const at = view.state.selection.main.head;
  const props = view.state.sliceDoc().match(/^---\n[\s\S]*?\n---\n?/);
  if (props && at < props[0].length) return void new Notice("Booker: put the cursor in the scene's text, below the properties.");
  const body = view.state.sliceDoc(at).replace(/^\s*(\*\*\*|---|\* \* \*|#)\s*\n/, "");
  new NamePrompt(plugin.app, "Split into a new scene", "The text after the cursor moves to a new scene placed right after this one. Name it:", (name) => {
    void (async () => {
      try {
        await plugin.lastMarkdownView()?.save();
        const made: TFile = await plugin.undoable("Split scene", proj, plugin.sceneFiles(proj), () => splitScene(plugin.app, proj, file.path, name, body));
        const cur = view.state.doc.length;
        // drop the blank lines that were before the cut too
        let cut = Math.min(at, cur);
        const floor = props ? props[0].length : 0;
        while (cut > floor && /\s/.test(view.state.sliceDoc(cut - 1, cut))) cut--;
        view.dispatch({ changes: { from: cut, to: cur, insert: "" }, userEvent: "input" });
        await plugin.app.workspace.getLeaf(false).openFile(made);
        new Notice(`Split: “${made.basename}” is next.`);
      } catch (e) {
        notifyError(e, "split the scene");
      }
    })();
  }, "Untitled", true, "Split").open();
}

function calloutBarMenu(plugin: BookerPlugin, v: EditorView) {
  const ed = plugin.app.workspace.activeEditor?.editor;
  if (!ed) return;
  const menu = new Menu();
  calloutMenu(menu, ed);
  const r = v.coordsAtPos(v.state.selection.main.head);
  menu.showAtPosition({ x: r?.left ?? 100, y: (r?.bottom ?? 100) + 4 });
}

function tools(plugin: BookerPlugin): Array<Tool | null> {
  return [
    { icon: "undo-2", tip: "Undo", run: (v) => (plugin.app.workspace.activeEditor?.editor?.undo(), v.focus()) },
    { icon: "redo-2", tip: "Redo", run: (v) => (plugin.app.workspace.activeEditor?.editor?.redo(), v.focus()) },
    { icon: "eraser", tip: "Clear formatting", run: clear },
    null,
    { icon: "heading", tip: "Heading", run: headingMenu as Tool["run"] },
    { icon: "bold", tip: "Bold", run: wrap("**") },
    { icon: "italic", tip: "Italic", run: wrap("*") },
    { icon: "underline", tip: "Underline", run: wrap("<u>", "</u>") },
    { icon: "strikethrough", tip: "Strikethrough", run: wrap("~~") },
    { icon: "highlighter", tip: "Highlight", run: wrap("==") },
    null,
    { icon: "list", tip: "Bulleted list", run: prefix("- ") },
    { icon: "list-ordered", tip: "Numbered list", run: prefix("1. ") },
    { icon: "quote", tip: "Quote", run: prefix("> ") },
    null,
    { icon: "separator-horizontal", tip: "Scene break (adds ***)", run: sceneBreak },
    { icon: "superscript", tip: "Insert footnote", run: (v) => insertFootnote(v) },
    { icon: "at-sign", tip: "Cite a source", run: () => plugin.citeHere(plugin.app.workspace.activeEditor!.editor!) },
    { icon: "message-square-quote", tip: "Epigraph, summary or questions", run: (v) => calloutBarMenu(plugin, v) },
    { icon: "book-open", tip: "Insert scripture", run: (v) => plugin.insertScripture((plugin.app.workspace.activeEditor?.editor)!, "") },
    { icon: "scissors", tip: "Split into a new scene at the cursor", run: (v) => splitHere(plugin, v) },
  ];
}

function makePanel(plugin: BookerPlugin) {
  return (view: EditorView): Panel => {
    const dom = document.createElement("div");
    dom.className = "booker-fmtbar";
    const box = dom.createDiv({ cls: "booker-fmtbar-box" });
    let group = box.createDiv({ cls: "booker-fmtbar-group" });
    for (const t of tools(plugin)) {
      if (!t) {
        group = box.createDiv({ cls: "booker-fmtbar-group" });
        continue;
      }
      const b = group.createEl("button", { cls: "booker-fmtbar-btn clickable-icon" });
      b.setAttr("aria-label", t.tip);
      setIcon(b, t.icon);
      // keep the cursor and selection where they are
      b.addEventListener("mousedown", (e) => e.preventDefault());
      b.addEventListener("click", (e) => t.run(view, e));
    }
    return { dom, top: true };
  };
}

/** A compact row of formatting buttons above the editor. Drawn on screen only: it never writes to a note by itself. */
export function formatBarExtension(plugin: BookerPlugin): Extension {
  return showPanel.of(makePanel(plugin));
}
