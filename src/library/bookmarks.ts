/** Bookmarks: saved searches, verses and references in one list, kept in folders, filtered and sorted. Pure. */
import type { Bucket } from "./bucket";
import type { SavedSearches } from "./savedSearches";
import { fuzzyScore } from "../fuzzyMatch";

export type BookmarkKind = "search" | "verse" | "reference";

export interface Bookmark {
  id: string;
  kind: BookmarkKind;
  /** where it is stored: a kept passage (the bucket) or a saved search */
  store: "bucket" | "search";
  title: string;
  /** the words, or what the search looks for */
  detail: string;
  fileKind: string;
  group: string;
  created: number;
  /** the text it holds, for a quotation */
  text: string;
  citation: string;
  uid: string;
  place: string;
}

export function bookmarksOf(bucket: Bucket, saved: SavedSearches): Bookmark[] {
  const kept: Bookmark[] = bucket.items.map((i) => ({ id: i.id, kind: i.kind, store: "bucket", title: i.citation || i.archiveSource || "Kept passage", detail: i.text, fileKind: i.fileKind, group: i.group, created: i.created, text: i.text, citation: i.citation, uid: i.uid, place: i.place }));
  const searches: Bookmark[] = saved.searches.map((s) => ({ id: s.id, kind: "search", store: "search", title: s.name, detail: s.query, fileKind: "", group: s.group, created: 0, text: "", citation: "", uid: "", place: "" }));
  return [...searches, ...kept];
}

/** Every folder in use or made empty, with the folders above them. */
export function allFolders(bucket: Bucket, saved: SavedSearches): string[] {
  const out = new Set<string>();
  for (const g of [...bucket.groups, ...saved.groups, ...bucket.items.map((i) => i.group), ...saved.searches.map((s) => s.group)]) {
    const parts = g.split("/").filter(Boolean);
    for (let i = 1; i <= parts.length; i++) out.add(parts.slice(0, i).join("/"));
  }
  return [...out].sort((a, b) => a.localeCompare(b));
}

export interface BookmarkFilter {
  text?: string;
  kind?: BookmarkKind | "";
}

export function filterBookmarks(list: Bookmark[], f: BookmarkFilter): Bookmark[] {
  const q = f.text?.trim() ?? "";
  return list.filter((b) => (!f.kind || b.kind === f.kind) && (!q || fuzzyScore(q, `${b.title} ${b.detail} ${b.group} ${b.fileKind}`) !== null));
}

export type BookmarkSort = "newest" | "oldest" | "name" | "kind";

export function sortBookmarks(list: Bookmark[], by: BookmarkSort): Bookmark[] {
  const name = (a: Bookmark, b: Bookmark) => a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: "base" });
  const out = [...list];
  if (by === "name") out.sort(name);
  else if (by === "kind") out.sort((a, b) => a.kind.localeCompare(b.kind) || name(a, b));
  else out.sort((a, b) => (by === "newest" ? b.created - a.created : a.created - b.created) || name(a, b));
  return out;
}

export interface FolderNode {
  name: string;
  path: string;
  items: Bookmark[];
  children: FolderNode[];
}

/** The tree of folders: bookmarks without a folder are the root's own items. */
export function folderTree(list: Bookmark[], folders: string[]): FolderNode {
  const root: FolderNode = { name: "", path: "", items: [], children: [] };
  const at = (path: string): FolderNode => {
    let node = root;
    let built = "";
    for (const part of path.split("/").filter(Boolean)) {
      built = built ? `${built}/${part}` : part;
      let next = node.children.find((c) => c.name === part);
      if (!next) {
        next = { name: part, path: built, items: [], children: [] };
        node.children.push(next);
      }
      node = next;
    }
    return node;
  };
  for (const f of folders) at(f);
  for (const b of list) at(b.group).items.push(b);
  const order = (n: FolderNode) => {
    n.children.sort((a, b) => a.name.localeCompare(b.name));
    n.children.forEach(order);
  };
  order(root);
  return root;
}

/** Items in a folder and everything under it. */
export const countIn = (n: FolderNode): number => n.items.length + n.children.reduce((s, c) => s + countIn(c), 0);

const FILE_ICONS: Record<string, string> = { pdf: "file-text", docx: "file-type", doc: "file-type", odt: "file-type", rtf: "file-type", md: "file-code", txt: "file", epub: "book", html: "globe", db: "database", commentary: "message-square-text", bible: "book-open", web: "globe" };

/** The icon for a bookmark: a magnifying glass for a search, a book for a verse, and the kind of file for a reference. */
export function iconFor(b: Pick<Bookmark, "kind" | "fileKind">): string {
  if (b.kind === "search") return "search";
  if (b.kind === "verse") return "book-open";
  return FILE_ICONS[b.fileKind.toLowerCase()] ?? "file-text";
}
