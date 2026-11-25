import type { Editor, Menu } from "obsidian";
import { CALLOUT_LABELS, calloutText, type CalloutKind } from "./callout";

export function wrapCallout(editor: Editor, kind: CalloutKind) {
  const sel = editor.getSelection();
  const cur = editor.getCursor("from");
  const lead = !sel && editor.getLine(cur.line).trim() ? "\n\n" : "";
  editor.replaceSelection(`${lead}${calloutText(kind, sel)}\n\n`);
}

export function calloutMenu(menu: Menu, editor: Editor) {
  for (const k of Object.keys(CALLOUT_LABELS) as CalloutKind[]) menu.addItem((i) => i.setTitle(CALLOUT_LABELS[k]).setIcon("message-square-quote").onClick(() => wrapCallout(editor, k)));
}

