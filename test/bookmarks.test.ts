import { describe, expect, it } from "vitest";
import { addToBucket, emptyBucket, parseBucket } from "../src/library/bucket";
import { addSaved, emptySaved } from "../src/library/savedSearches";
import { allFolders, bookmarksOf, filterBookmarks, folderTree, iconFor, sortBookmarks } from "../src/library/bookmarks";

const item = { text: "For God so loved", citation: "John 3:16", archiveSource: "BLB", book: "John", chapter: "3" };

describe("bookmarks", () => {
  it("lists searches, verses and references together with their icons", () => {
    let b = addToBucket(emptyBucket(), { ...item, kind: "verse" }, 5).bucket;
    b = addToBucket(b, { text: "x", citation: "Doc p1", archiveSource: "Doc", book: "", chapter: "", kind: "reference", fileKind: "pdf" }, 6).bucket;
    const s = addSaved(emptySaved(), { name: "Grace", query: "grace", scope: "all", mode: "exact", group: "Doctrine" });
    const list = bookmarksOf(b, s);
    expect(list.map((x) => [x.kind, iconFor(x)])).toEqual([["search", "search"], ["reference", "file-text"], ["verse", "book-open"]]);
    expect(filterBookmarks(list, { kind: "verse" })).toHaveLength(1);
    expect(filterBookmarks(list, { text: "grace" })[0].kind).toBe("search");
    expect(sortBookmarks(list, "newest")[0].kind).toBe("reference");
  });
  it("builds a tree of folders, with the folders above a nested one", () => {
    const b = addToBucket(emptyBucket(), { ...item, group: "A/B" }, 1).bucket;
    expect(allFolders(b, emptySaved())).toEqual(["A", "A/B"]);
    const tree = folderTree(bookmarksOf(b, emptySaved()), ["C"]);
    expect(tree.children.map((c) => c.name)).toEqual(["A", "C"]);
    expect(tree.children[0].children[0].items).toHaveLength(1);
  });
  it("reads old bucket files", () => {
    const b = parseBucket({ items: [{ id: "1", text: "t", citation: "c" }] });
    expect(b.items[0]).toMatchObject({ kind: "reference", group: "" });
    expect(b.groups).toEqual([]);
  });
});
