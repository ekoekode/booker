import { Menu, Modal, Notice, Setting, setIcon } from "obsidian";
import type BookerPlugin from "../../main";
import { addGroup, addSaved, cleanGroup, groupTree, moveSaved, removeGroup, removeSaved, renameGroup, type GroupNode, type SavedSearch } from "../../library/savedSearches";
import { MODES, SCOPES, type Scope, type SearchMode } from "../../reader/searchOptions";

const NEW_GROUP = "\u0000new";

/** Name a search and choose its group. */
export class SaveSearchModal extends Modal {
  constructor(private plugin: BookerPlugin, private search: { query: string; scope: Scope; mode: SearchMode }, private done: () => void) {
    super(plugin.app);
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: "Save this search" });
    const data = await this.plugin.stores.savedData.get();
    const groups = [...new Set([...data.groups, ...data.searches.map((s) => s.group)].filter(Boolean))].sort();
    let name = this.search.query;
    let group = "";
    let fresh = "";
    new Setting(contentEl).setName("Name").addText((t) => t.setValue(name).onChange((v) => (name = v)));
    const groupRow = new Setting(contentEl).setName("Group").setDesc("Groups nest like folders: Doctrine/Grace.");
    const newBox = new Setting(contentEl).setName("New group name").addText((t) => t.onChange((v) => (fresh = v)));
    newBox.settingEl.hide();
    groupRow.addDropdown((d) => {
      d.addOption("", "(no group)");
      for (const g of groups) d.addOption(g, g);
      d.addOption(NEW_GROUP, "New group…");
      d.onChange((v) => {
        group = v;
        newBox.settingEl.toggle(v === NEW_GROUP);
      });
    });
    new Setting(contentEl).addButton((b) =>
      b.setButtonText("Save").setCta().onClick(async () => {
        const g = group === NEW_GROUP ? cleanGroup(fresh) : group;
        await this.plugin.stores.savedData.set(addSaved(data, { name: name.trim() || this.search.query, query: this.search.query, scope: this.search.scope, mode: this.search.mode, group: g }));
        new Notice("Booker: search saved.");
        this.done();
        this.close();
      })
    );
  }

  onClose() {
    this.contentEl.empty();
  }
}

const scopeLabel = (s: Scope) => SCOPES.find((x) => x.id === s)?.label ?? s;
const modeLabel = (m: SearchMode) => MODES.find((x) => x.id === m)?.label ?? m;

/** The saved searches as a tree of groups. Pressing one runs it. */
export function drawSavedSearches(el: HTMLElement, plugin: BookerPlugin, run: (s: SavedSearch) => void): void {
  const open = new Set<string>();
  const draw = async () => {
    const data = await plugin.stores.savedData.get();
    el.empty();
    const bar = el.createDiv({ cls: "booker-reader-picker-head", text: "Saved searches" });
    const add = bar.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "New group" } });
    setIcon(add, "folder-plus");
    add.addEventListener("click", () => {
      const m = new Modal(plugin.app);
      let v = "";
      m.contentEl.createEl("h3", { text: "New group" });
      new Setting(m.contentEl).setName("Name").addText((t) => t.onChange((x) => (v = x))).addButton((b) =>
        b.setButtonText("Add").setCta().onClick(async () => {
          await plugin.stores.savedData.set(addGroup(await plugin.stores.savedData.get(), v));
          m.close();
        })
      );
      m.open();
    });
    const tree = groupTree(data);
    if (!tree.children.length && !tree.searches.length) el.createEl("p", { cls: "booker-muted", text: "Nothing saved yet. Search, then press “Save this search”." });
    const node = (n: GroupNode, depth: number) => {
      for (const c of n.children) {
        const row = el.createDiv({ cls: "booker-reader-pop-row booker-saved-group" });
        row.style.paddingLeft = `${8 + depth * 14}px`;
        setIcon(row.createSpan(), open.has(c.path) ? "folder-open" : "folder");
        row.createSpan({ text: c.name });
        row.addEventListener("click", () => {
          open.has(c.path) ? open.delete(c.path) : open.add(c.path);
          void draw();
        });
        row.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          const m = new Menu();
          m.addItem((i) => i.setTitle("Rename group…").setIcon("pencil").onClick(() => promptName(plugin, "Rename group", c.path, async (v) => plugin.stores.savedData.set(renameGroup(await plugin.stores.savedData.get(), c.path, v)))));
          m.addItem((i) => i.setTitle("Remove group (keeps its searches)").setIcon("trash").onClick(async () => plugin.stores.savedData.set(removeGroup(await plugin.stores.savedData.get(), c.path))));
          m.showAtMouseEvent(e);
        });
        if (open.has(c.path)) node(c, depth + 1);
      }
      for (const s of n.searches) {
        const row = el.createDiv({ cls: "booker-reader-pop-row booker-saved-search" });
        row.style.paddingLeft = `${8 + depth * 14}px`;
        row.createSpan({ text: s.name });
        row.createSpan({ cls: "booker-muted", text: `${scopeLabel(s.scope)} · ${modeLabel(s.mode)}` });
        row.addEventListener("click", () => run(s));
        row.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          const m = new Menu();
          const groups = [...new Set([...data.groups, ...data.searches.map((x) => x.group)].filter(Boolean))].sort();
          m.addItem((i) => i.setTitle("No group").onClick(async () => plugin.stores.savedData.set(moveSaved(await plugin.stores.savedData.get(), s.id, ""))));
          for (const g of groups) m.addItem((i) => i.setTitle(`Move to ${g}`).onClick(async () => plugin.stores.savedData.set(moveSaved(await plugin.stores.savedData.get(), s.id, g))));
          m.addSeparator();
          m.addItem((i) => i.setTitle("Delete").setIcon("trash").onClick(async () => plugin.stores.savedData.set(removeSaved(await plugin.stores.savedData.get(), s.id))));
          m.showAtMouseEvent(e);
        });
      }
    };
    node(tree, 0);
  };
  const off = plugin.stores.savedData.onChange(() => (el.isConnected ? void draw() : off()));
  void draw();
}

function promptName(plugin: BookerPlugin, title: string, initial: string, done: (v: string) => Promise<void>) {
  const m = new Modal(plugin.app);
  let v = initial;
  m.contentEl.createEl("h3", { text: title });
  new Setting(m.contentEl).setName("Name").addText((t) => t.setValue(initial).onChange((x) => (v = x))).addButton((b) =>
    b.setButtonText("Save").setCta().onClick(async () => {
      await done(v);
      m.close();
    })
  );
  m.open();
}
