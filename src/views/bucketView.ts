import { ItemView, Menu, Notice, WorkspaceLeaf, getIconIds, setIcon } from "obsidian";
import type BookerPlugin from "../main";
import { moveBookmark, renameBucketGroup } from "../library/bucket";
import { placeFromState } from "../reader/place";
import { allFolders, bookmarksOf, countIn, filterBookmarks, folderTree, iconFor, sortBookmarks, type Bookmark, type BookmarkKind, type BookmarkSort, type FolderNode } from "../library/bookmarks";
import { addGroup, cleanGroup, moveSaved, removeGroup, removeSaved, renameGroup } from "../library/savedSearches";
import { NamePrompt } from "../ui";

/** Kept under this id so saved layouts still find the tab. */
export const VIEW_BUCKET = "booker-bucket";

const KINDS: Array<{ id: BookmarkKind | ""; label: string; icon: string }> = [
  { id: "", label: "All", icon: "bookmark" },
  { id: "search", label: "Searches", icon: "search" },
  { id: "verse", label: "Verses", icon: "book-open" },
  { id: "reference", label: "References", icon: "file-text" },
];

const SORTS: Array<{ id: BookmarkSort; label: string }> = [
  { id: "newest", label: "Newest first" },
  { id: "oldest", label: "Oldest first" },
  { id: "name", label: "Name" },
  { id: "kind", label: "Kind" },
];

const DRAG = "application/x-booker-bookmark";

const icon = (el: HTMLElement, name: string) => setIcon(el, getIconIds().includes(`lucide-${name}`) || getIconIds().includes(name) ? name : "file");

/** Bookmarks: saved searches, verses and references, in folders you make, with a filter, a search box and sorting. */
export class BucketView extends ItemView {
  private text = "";
  private kind: BookmarkKind | "" = "";
  private sort: BookmarkSort = "newest";
  private expanded = new Set<string>([""]);
  private list!: HTMLElement;
  private offs: Array<() => void> = [];

  constructor(leaf: WorkspaceLeaf, private plugin: BookerPlugin) {
    super(leaf);
  }

  getViewType() {
    return VIEW_BUCKET;
  }
  getDisplayText() {
    return "Bookmarks";
  }
  getIcon() {
    return "bookmark";
  }

  async onOpen() {
    const root = this.contentEl;
    root.empty();
    root.addClass("booker-bucket", "booker-bookmarks");
    this.drawBar(root.createDiv({ cls: "booker-bucket-bar" }));
    this.list = root.createDiv({ cls: "booker-bucket-list" });
    this.dropOn(this.list, "");
    this.offs = [this.plugin.stores.bucketData.onChange(() => void this.draw()), this.plugin.stores.savedData.onChange(() => void this.draw())];
    await this.draw();
  }

  async onClose() {
    this.offs.forEach((f) => f());
  }

  private drawBar(bar: HTMLElement) {
    const find = bar.createEl("input", { type: "search", placeholder: "Search bookmarks", attr: { "aria-label": "Search bookmarks" } });
    find.value = this.text;
    find.addEventListener("input", () => {
      this.text = find.value;
      void this.draw();
    });
    const kinds = bar.createDiv({ cls: "booker-bm-kinds" });
    for (const k of KINDS) {
      const b = kinds.createEl("button", { cls: "booker-bm-kind" + (this.kind === k.id ? " is-active" : ""), attr: { "aria-label": k.label, title: k.label } });
      setIcon(b.createSpan(), k.icon);
      b.createSpan({ text: k.label, cls: "booker-bm-kind-text" });
      b.addEventListener("click", () => {
        this.kind = k.id;
        kinds.querySelectorAll(".booker-bm-kind").forEach((x) => x.removeClass("is-active"));
        b.addClass("is-active");
        void this.draw();
      });
    }
    const sort = bar.createEl("select", { cls: "dropdown", attr: { "aria-label": "Sort" } });
    for (const s of SORTS) sort.createEl("option", { value: s.id, text: s.label });
    sort.value = this.sort;
    sort.addEventListener("change", () => {
      this.sort = sort.value as BookmarkSort;
      void this.draw();
    });
    const add = bar.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "New folder" } });
    setIcon(add, "folder-plus");
    add.addEventListener("click", () => this.newFolder(""));
  }

  private async draw() {
    const { bucketData, savedData } = this.plugin.stores;
    const [bucket, saved] = await Promise.all([bucketData.get(), savedData.get()]);
    const all = bookmarksOf(bucket, saved);
    const filtering = !!this.text.trim() || !!this.kind;
    const shown = sortBookmarks(filterBookmarks(all, { text: this.text, kind: this.kind }), this.sort);
    this.list.empty();
    if (!all.length) return void this.list.createEl("p", { cls: "booker-muted", text: "Nothing saved yet. Press the bookmark button on a verse, a passage or a search." });
    if (!shown.length) return void this.list.createEl("p", { cls: "booker-muted", text: "Nothing matches." });
    const tree = folderTree(shown, filtering ? [] : allFolders(bucket, saved));
    this.node(this.list, tree, filtering);
  }

  private node(into: HTMLElement, n: FolderNode, force: boolean) {
    for (const c of n.children) {
      const open = force || this.expanded.has(c.path);
      const f = into.createDiv({ cls: "booker-bm-folder" + (open ? " is-open" : "") });
      const head = f.createDiv({ cls: "booker-bm-folderhead" });
      head.draggable = true;
      head.addEventListener("dragstart", (e) => {
        e.dataTransfer?.setData(DRAG, `folder|${c.path}`);
        e.stopPropagation();
      });
      this.dropOn(f, c.path);
      setIcon(head.createSpan({ cls: "booker-bm-ico" }), open ? "folder-open" : "folder");
      head.createSpan({ text: c.name, cls: "booker-bm-foldername" });
      head.createSpan({ text: String(countIn(c)), cls: "booker-muted" });
      const more = head.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "Folder menu" } });
      setIcon(more, "more-horizontal");
      more.addEventListener("click", (e) => {
        e.stopPropagation();
        const m = new Menu();
        m.addItem((i) => i.setTitle("New folder inside").setIcon("folder-plus").onClick(() => this.newFolder(c.path)));
        m.addItem((i) => i.setTitle("Delete folder (keeps what is in it)").setIcon("trash").onClick(() => void this.deleteFolder(c.path)));
        m.showAtMouseEvent(e);
      });
      head.addEventListener("click", () => {
        if (this.expanded.has(c.path)) this.expanded.delete(c.path);
        else this.expanded.add(c.path);
        void this.draw();
      });
      if (open) this.node(f.createDiv({ cls: "booker-bm-inner" }), c, force);
    }
    for (const b of n.items) this.card(into, b);
  }

  private card(into: HTMLElement, b: Bookmark) {
    const c = into.createDiv({ cls: `booker-bm-card booker-item-card is-${b.kind}` });
    c.draggable = true;
    c.addEventListener("dragstart", (e) => {
      e.dataTransfer?.setData(DRAG, `item|${b.store}|${b.id}`);
      e.dataTransfer!.effectAllowed = "move";
    });
    icon(c.createSpan({ cls: "booker-bm-ico" }), iconFor(b));
    const main = c.createDiv({ cls: "booker-bm-main" });
    main.createDiv({ cls: "booker-bm-title", text: b.title });
    main.createDiv({ cls: "booker-bm-detail booker-muted", text: b.detail });
    const tools = c.createDiv({ cls: "booker-bm-tools" });
    const btn = (name: string, tip: string, run: (e: MouseEvent) => void) => {
      const x = tools.createEl("button", { cls: "clickable-icon", attr: { "aria-label": tip } });
      setIcon(x, name);
      x.addEventListener("click", (e) => {
        e.stopPropagation();
        run(e);
      });
    };
    if (b.text) btn("text-quote", "Write into the most recent note, with a footnote", () => void this.plugin.insertQuotation(b.text, b.citation, ""));
    if (b.text) btn("copy", "Copy", () => void navigator.clipboard.writeText(b.text).then(() => new Notice("Booker: copied.")));
    btn("folder-input", "Move to a folder", (e) => this.moveMenu(e, b));
    btn("trash", "Remove bookmark", () => void this.remove(b));
    c.addEventListener("click", () => void this.openIt(b));
  }

  private async openIt(b: Bookmark) {
    const p = this.plugin;
    if (b.kind === "search") {
      const s = (await p.stores.savedData.get()).searches.find((x) => x.id === b.id);
      if (s) await p.runReaderSearch(s.query, s.scope, s.mode);
      return;
    }
    if (b.place) {
      try {
        const place = placeFromState({ place: JSON.parse(b.place) });
        if (place.kind !== "shelf") return void (await p.openPlace(place));
      } catch {
        /* fall through to the older ways */
      }
    }
    if (b.kind === "verse") await p.openBible(b.citation);
    else if (b.uid) {
      const src = p.sources().find((x) => x.uid === b.uid);
      if (src) await p.openSource(src);
      else new Notice("Booker: that document is no longer in the library.");
    } else new Notice("Booker: this bookmark was made before bookmarks remembered their place, so it cannot be opened. Bookmark it again to fix that.");
  }

  /** Let a bookmark or a folder be dropped on `el` to move it into the folder `group` ("" is the top). */
  private dropOn(el: HTMLElement, group: string) {
    el.addEventListener("dragover", (e) => {
      if (!e.dataTransfer?.types.includes(DRAG)) return;
      e.preventDefault();
      e.stopPropagation();
      el.addClass("is-drop");
    });
    el.addEventListener("dragleave", () => el.removeClass("is-drop"));
    el.addEventListener("drop", (e) => {
      el.removeClass("is-drop");
      const raw = e.dataTransfer?.getData(DRAG);
      if (!raw) return;
      e.preventDefault();
      e.stopPropagation();
      void this.dropped(raw, group);
    });
  }

  private async dropped(raw: string, group: string) {
    const { bucketData, savedData } = this.plugin.stores;
    const [kind, a, b] = raw.split("|");
    if (kind === "item") {
      if (a === "bucket") await bucketData.set(moveBookmark(await bucketData.get(), b, group));
      else await savedData.set(moveSaved(await savedData.get(), b, group));
    } else if (kind === "folder") {
      const name = a.slice(a.lastIndexOf("/") + 1);
      const to = group ? `${group}/${name}` : name;
      if (to === a || group === a || group.startsWith(`${a}/`)) return;
      await bucketData.set(renameBucketGroup(await bucketData.get(), a, to));
      await savedData.set(renameGroup(await savedData.get(), a, to));
      if (group) this.expanded.add(group);
    }
  }

  private async remove(b: Bookmark) {
    const { savedData } = this.plugin.stores;
    if (b.store === "bucket") await this.plugin.stores.removeFromBucket(b.id);
    else await savedData.set(removeSaved(await savedData.get(), b.id));
  }

  private async moveTo(b: Bookmark, group: string) {
    const { bucketData, savedData } = this.plugin.stores;
    if (b.store === "bucket") await bucketData.set(moveBookmark(await bucketData.get(), b.id, group));
    else await savedData.set(moveSaved(await savedData.get(), b.id, group));
  }

  private async moveMenu(e: MouseEvent, b: Bookmark) {
    const { bucketData, savedData } = this.plugin.stores;
    const folders = allFolders(await bucketData.get(), await savedData.get());
    const m = new Menu();
    m.addItem((i) => i.setTitle("No folder").setChecked(!b.group).onClick(() => void this.moveTo(b, "")));
    for (const f of folders) m.addItem((i) => i.setTitle(f).setChecked(b.group === f).onClick(() => void this.moveTo(b, f)));
    m.addItem((i) => i.setTitle("New folder…").setIcon("folder-plus").onClick(() => new NamePrompt(this.app, "New folder", "", (n) => void this.moveTo(b, cleanGroup(n))).open()));
    m.showAtMouseEvent(e);
  }

  private newFolder(parent: string) {
    new NamePrompt(this.app, "New folder", "", async (n) => {
      const g = cleanGroup(parent ? `${parent}/${n}` : n);
      if (!g) return;
      const { bucketData } = this.plugin.stores;
      const b = await bucketData.get();
      this.expanded.add(g.includes("/") ? g.slice(0, g.lastIndexOf("/")) : "");
      await bucketData.set({ ...b, groups: [...new Set([...b.groups, g])] });
    }).open();
  }

  private async deleteFolder(path: string) {
    const { bucketData, savedData } = this.plugin.stores;
    const b = await bucketData.get();
    const up = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    const re = (x: string) => (x === path ? up : x.startsWith(`${path}/`) ? (up ? `${up}/` : "") + x.slice(path.length + 1) : x);
    await savedData.set(removeGroup(await savedData.get(), path));
    await bucketData.set({ items: b.items.map((i) => ({ ...i, group: re(i.group) })), groups: [...new Set(b.groups.filter((g) => g !== path).map(re).filter(Boolean))] });
  }
}
