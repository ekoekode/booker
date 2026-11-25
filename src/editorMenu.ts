/** Right-click menu in a note: the Booker actions that fit what is selected or under the cursor. */
import { Editor, Menu, Notice } from "obsidian";
import type BookerPlugin from "./main";
import { insertFootnote } from "./writing/bar";
import { calloutMenu } from "./notes/calloutMenu";
import { CITE } from "./citations/cite";
import { referenceAt } from "./scripture/ref";
import { projectOfPath, scriptureOn } from "./project/vaultOps";

/** The [@key, loc] the cursor sits in, or null. */
export function citationAt(line: string, ch: number): { key: string; from: number; to: number } | null {
  for (const m of line.matchAll(CITE)) {
    const from = m.index!;
    const to = from + m[0].length;
    if (ch >= from && ch <= to) return { key: m[1], from, to };
  }
  return null;
}

export function registerEditorMenu(plugin: BookerPlugin) {
  plugin.registerEvent(
    plugin.app.workspace.on("editor-menu", (menu, editor, view) => {
      const file = view.file;
      const proj = file ? projectOfPath(plugin.app, file.path) : undefined;
      if (!file || !proj) return;
      const verses = scriptureOn(proj);
      const cur = editor.getCursor();
      const line = editor.getLine(cur.line);
      const sel = editor.getSelection();
      const cite = citationAt(line, cur.ch);
      const ref = verses && !sel ? referenceAt(line, cur.ch) : null;
      menu.addSeparator();
      if (cite) {
        const s = plugin.sources().find((x) => x.citekey === cite.key);
        menu.addItem((i) => i.setTitle(s ? `Open source: ${s.title}` : `No source has the key “${cite.key}”`).setIcon("file-text").setDisabled(!s).onClick(() => s && void plugin.openSource(s)));
      }
      if (ref) {
        const text = line.slice(ref.from, ref.to);
        menu.addItem((i) => i.setTitle(`Read ${text} in the Bible reader`).setIcon("book-open").onClick(() => void plugin.openBible(text)));
        menu.addItem((i) =>
          i.setTitle(`Write out ${text}`).setIcon("text-quote").onClick(() => {
            editor.setSelection({ line: cur.line, ch: ref.from }, { line: cur.line, ch: ref.to });
            plugin.insertScripture(editor, text);
          })
        );
      }
      const term = sel.trim();
      if (term && term.length <= 60 && !term.includes("\n")) menu.addItem((i) => i.setTitle(`Add “${term.length > 24 ? `${term.slice(0, 24)}…` : term}” to the index`).setIcon("list-plus").onClick(() => void plugin.addIndexTerm(file.path, term)));
      if (/^[A-Za-z][A-Za-z'’-]{1,40}$/.test(sel.trim())) menu.addItem((i) => i.setTitle(`Look up “${sel.trim()}”`).setIcon("book-a").onClick(() => void plugin.lookupWord(sel.trim())));
      menu.addItem((i) => i.setTitle("Cite a source…").setIcon("at-sign").onClick(() => plugin.citeHere(editor)));
      menu.addItem((i) => i.setTitle("Add footnote").setIcon("superscript").onClick(() => {
        const cm = (editor as any).cm;
        if (cm) insertFootnote(cm);
      }));
      if (verses) menu.addItem((i) => i.setTitle("Insert scripture…").setIcon("book-open").onClick(() => plugin.insertScripture(editor, sel)));
      if (verses) menu.addItem((i) => i.setTitle("Hebrew or Greek word study…").setIcon("languages").onClick(() => void (plugin.app as any).commands.executeCommandById("booker:insert-word-study")));
      menu.addItem((i) => {
        i.setTitle("Wrap as").setIcon("message-square-quote");
        const sub = (i as any).setSubmenu?.() as Menu | undefined;
        if (sub) calloutMenu(sub, editor);
        else i.onClick(() => new Notice("Booker: use the callout button in the formatting bar."));
      });
    })
  );
}
