import { describe, expect, it } from "vitest";
import { JsonFile, type FileAdapter } from "../src/library/jsonStore";
import { addToBucket, bucketQuote, bucketTags, emptyBucket, filterBucket, parseBucket, removeFromBucket, retag } from "../src/library/bucket";
import { addGroup, addSaved, emptySaved, groupTree, moveSaved, parseSaved, removeGroup, removeSaved, renameGroup } from "../src/library/savedSearches";
import { addBibleHighlight, emptyHighlights, forChapter, parseBibleHighlights, removeBibleHighlight, splitVerse } from "../src/library/bibleHighlights";

const memory = (): FileAdapter & { files: Map<string, string>; dirs: Set<string> } => {
  const files = new Map<string, string>();
  const dirs = new Set<string>();
  return { files, dirs, exists: async (p) => files.has(p) || dirs.has(p), read: async (p) => files.get(p)!, write: async (p, d) => void files.set(p, d), mkdir: async (p) => void dirs.add(p) };
};

describe("JsonFile", () => {
  it("starts empty, saves into Booker/Library and reads back", async () => {
    const a = memory();
    const f = new JsonFile(a, "T.json", parseBucket, emptyBucket);
    expect(await f.load()).toEqual({ items: [], groups: [] });
    await f.save({ items: [{ id: "1", text: "x", citation: "", archiveSource: "", book: "", chapter: "", topic: [], created: 1 }] });
    expect(a.dirs.has("Booker") && a.dirs.has("Booker/Library")).toBe(true);
    expect(a.files.has("Booker/Library/T.json")).toBe(true);
    expect((await f.load()).items[0].text).toBe("x");
  });
  it("falls back to empty when the file is damaged", async () => {
    const a = memory();
    a.files.set("Booker/Library/T.json", "{not json");
    expect(await new JsonFile(a, "T.json", parseBucket, emptyBucket).load()).toEqual({ items: [], groups: [] });
  });
  it("keeps two quick saves in order", async () => {
    const a = memory();
    const f = new JsonFile<number>(a, "N.json", (r) => Number(r), () => 0);
    void f.save(1);
    await f.save(2);
    expect(a.files.get("Booker/Library/N.json")).toBe("2");
  });
});

describe("reference bucket", () => {
  const n = (over = {}) => ({ text: "For God so loved the world", citation: "John 3:16", archiveSource: "BSB", book: "John", chapter: "3", ...over });
  it("adds to the top and keeps the same passage once, merging tags", () => {
    let b = addToBucket(emptyBucket(), n({ topic: ["love"] }), 1).bucket;
    const second = addToBucket(b, n({ text: "Other", citation: "John 3:17" }), 2);
    expect(second.bucket.items.map((i) => i.citation)).toEqual(["John 3:17", "John 3:16"]);
    const again = addToBucket(second.bucket, n({ topic: ["grace", "love"] }), 3);
    expect(again.added).toBe(false);
    expect(again.bucket.items).toHaveLength(2);
    expect(again.bucket.items.find((i) => i.citation === "John 3:16")!.topic).toEqual(["love", "grace"]);
  });
  it("filters by archive, book, chapter, topic and text, and lists the tags in use", () => {
    let b = emptyBucket();
    b = addToBucket(b, n({ topic: ["love"] }), 1).bucket;
    b = addToBucket(b, n({ text: "Nicodemus came by night", citation: "John 3:2", topic: ["night"] }), 2).bucket;
    b = addToBucket(b, n({ text: "In the beginning", citation: "Gen 1:1", archiveSource: "Fathers", book: "Gen", chapter: "1" }), 3).bucket;
    expect(filterBucket(b.items, { archiveSource: "BSB" })).toHaveLength(2);
    expect(filterBucket(b.items, { book: "Gen" })).toHaveLength(1);
    expect(filterBucket(b.items, { topic: "night" })[0].citation).toBe("John 3:2");
    expect(filterBucket(b.items, { text: "BEGINNING" })).toHaveLength(1);
    expect(bucketTags(b.items)).toEqual({ archiveSource: ["BSB", "Fathers"], book: ["Gen", "John"], chapter: ["1", "3"], topic: ["love", "night"] });
  });
  it("retags, removes and writes a quotation", () => {
    const { bucket, item } = addToBucket(emptyBucket(), n(), 1);
    expect(retag(bucket, item.id, [" a ", "a", ""]).items[0].topic).toEqual(["a"]);
    expect(removeFromBucket(bucket, item.id).items).toEqual([]);
    expect(bucketQuote(item)).toBe("> For God so loved the world\n> — John 3:16\n");
  });
  it("ignores damaged entries when reading", () => {
    expect(parseBucket({ items: [{ text: "ok", topic: ["a", 3] }, { nope: 1 }, null] }).items.map((i) => [i.text, i.topic])).toEqual([["ok", ["a"]]]);
    expect(parseBucket(null).items).toEqual([]);
  });
});

describe("saved searches", () => {
  const s = (name: string, group = "") => ({ name, query: name.toLowerCase(), scope: "all" as const, mode: "exact" as const, group });
  it("keeps one entry for the same search and renames it", () => {
    let x = addSaved(emptySaved(), s("Grace"));
    x = addSaved(x, { ...s("Grace"), name: "Grace again" });
    expect(x.searches).toHaveLength(1);
    expect(x.searches[0].name).toBe("Grace again");
  });
  it("builds a tree of nested groups, with empty groups shown", () => {
    let x = addSaved(emptySaved(), s("Grace", "Doctrine/Soteriology"));
    x = addSaved(x, s("Faith"));
    x = addGroup(x, "Empty");
    const t = groupTree(x);
    expect(t.searches.map((q) => q.name)).toEqual(["Faith"]);
    expect(t.children.map((c) => c.name)).toEqual(["Doctrine", "Empty"]);
    expect(t.children[0].children[0].searches[0].name).toBe("Grace");
  });
  it("moves, renames a group with what is inside it, and removes a group upward", () => {
    let x = addSaved(emptySaved(), s("Grace", "A/B"));
    x = renameGroup(x, "A", "Z");
    expect(x.searches[0].group).toBe("Z/B");
    x = removeGroup(x, "Z/B");
    expect(x.searches[0].group).toBe("Z");
    x = moveSaved(x, x.searches[0].id, "");
    expect(x.searches[0].group).toBe("");
    expect(removeSaved(x, x.searches[0].id).searches).toEqual([]);
  });
  it("reads a damaged file safely", () => {
    const x = parseSaved({ searches: [{ query: "a", scope: "bogus", mode: "nope", group: " / A /" }, { query: "" }], groups: ["x", 5] });
    expect(x.searches).toMatchObject([{ query: "a", scope: "all", mode: "exact", group: "A" }]);
    expect(x.groups).toEqual(["x"]);
  });
});

describe("Bible highlights", () => {
  const h = (start: number, end: number, color = "yellow") => ({ module: "B", book: "John", chapter: 3, verse: 16, start, end, text: "x", color });
  it("replaces an overlapping highlight so a stretch has one colour", () => {
    let x = addBibleHighlight(emptyHighlights(), h(0, 5), 1).highlights;
    x = addBibleHighlight(x, h(10, 15), 2).highlights;
    x = addBibleHighlight(x, h(3, 8, "green"), 3).highlights;
    expect(x.items.map((i) => [i.start, i.end, i.color])).toEqual([[10, 15, "yellow"], [3, 8, "green"]]);
  });
  it("finds a chapter's highlights by verse and cuts the verse text around them", () => {
    let x = addBibleHighlight(emptyHighlights(), h(4, 7), 1).highlights;
    x = addBibleHighlight(x, { ...h(0, 2), verse: 17 }, 2).highlights;
    const by = forChapter(x, "B", "John", 3);
    expect([...by.keys()]).toEqual([16, 17]);
    expect(splitVerse("For God so loved", by.get(16)!).map((p) => [p.text, !!p.mark])).toEqual([["For ", false], ["God", true], [" so loved", false]]);
    expect(forChapter(x, "Other", "John", 3).size).toBe(0);
  });
  it("removes one and drops damaged entries", () => {
    const { highlights, item } = addBibleHighlight(emptyHighlights(), h(0, 2), 1);
    expect(removeBibleHighlight(highlights, item.id).items).toEqual([]);
    expect(parseBibleHighlights({ items: [{ book: "J", start: 3, end: 1 }, { book: "J", start: 0, end: 4, chapter: 1, verse: 2 }] }).items).toHaveLength(1);
  });
});
