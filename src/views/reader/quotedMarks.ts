import { Menu, Notice, TFile } from "obsidian";
import type BookerPlugin from "../../main";
import type { QuoteRecord } from "../../library/quoted";

/** Colour an element that is quoted in your writing, and give it a Go to button that lists the notes. */
export function markQuoted(plugin: BookerPlugin, el: HTMLElement, records: QuoteRecord[]) {
  el.querySelectorAll(":scope > .booker-quoted-go").forEach((x) => x.remove());
  el.toggleClass("is-quoted", records.length > 0);
  if (!records.length) return;
  const go = el.createEl("a", { cls: "booker-quoted-go", text: `Go to (${records.length})`, attr: { "aria-label": "Show the places in your writing that quote this" } });
  go.addEventListener("mousedown", (e) => e.stopPropagation());
  go.addEventListener("click", (e) => {
    e.stopPropagation();
    e.preventDefault();
    // a note that is gone since the list was drawn is dropped from it now
    const live = records.filter((r) => plugin.app.vault.getAbstractFileByPath(r.path) instanceof TFile);
    if (live.length !== records.length) {
      records.filter((r) => !live.includes(r)).forEach((r) => plugin.quoted.drop(r.path));
      new Notice("Booker: a note that quoted this no longer exists, so it was removed from the list.");
      markQuoted(plugin, el, live);
      if (!live.length) return;
    }
    const menu = new Menu();
    for (const r of live) {
      const f = plugin.app.vault.getAbstractFileByPath(r.path);
      const title = f instanceof TFile ? f.basename : r.path;
      menu.addItem((i) =>
        i.setTitle(`${title} · line ${r.line + 1}`).setIcon("file-text").onClick(async () => {
          if (f instanceof TFile) await plugin.app.workspace.getLeaf("tab").openFile(f, { eState: { line: r.line } });
        })
      );
    }
    menu.showAtMouseEvent(e);
  });
}
