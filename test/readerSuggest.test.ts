import { describe, expect, it } from "vitest";
import { bookGroups, numbers } from "../src/reader/passage";
import { suggest, type SuggestContext } from "../src/reader/suggest";
import type { Source } from "../src/sources/types";

const src = (o: Partial<Source>): Source => ({ uid: o.title ?? "x", citekey: "k", title: "T", authors: [], type: "book", kind: "db", file: "a.nlib", ...o });
const ctx: SuggestContext = {
  books: ["Gen", "Ps", "Rom", "1Cor", "2Cor", "John"],
  sources: [
    src({ title: "The Writings of Augustine of Hippo", authors: ["Augustine of Hippo"], container: "Historical Christian Faith, Writings Database" }),
    src({ title: "Romans: Commentary on Scripture", authors: ["Origen"], container: "Historical Christian Faith, Commentaries Database" }),
  ],
  bibles: [{ path: "BLB.bbl.mybible", name: "Berean Literal Bible" }],
  commentaries: [{ path: "CFC.cmt.mybible", name: "Church Fathers Commentary" }],
};

describe("suggest", () => {
  it("offers nothing for empty input", () => expect(suggest("  ", ctx)).toEqual([]));
  it("puts a passage first and a search last", () => {
    const s = suggest("john 3:16", ctx);
    expect(s[0]).toMatchObject({ kind: "passage", book: "John", chapter: 3, verse: 16 });
    expect(s[s.length - 1]).toMatchObject({ kind: "search", text: "john 3:16" });
  });
  it("offers book prefixes", () => {
    const s = suggest("co", ctx);
    expect(s.filter((x) => x.kind === "book").map((x) => (x as any).book)).toEqual(["1Cor", "2Cor"]);
  });
  it("finds works, databases, Bibles and commentaries by name", () => {
    const s = suggest("augustine", ctx);
    expect(s.some((x) => x.kind === "open" && x.place.kind === "work")).toBe(true);
    expect(suggest("church fathers", ctx).some((x) => x.kind === "open" && x.place.kind === "commentary")).toBe(true);
    expect(suggest("church fathers", ctx).some((x) => x.kind === "open" && x.place.kind === "works")).toBe(true);
    expect(suggest("berean", ctx).some((x) => x.kind === "bible")).toBe(true);
  });
  it("caps the list", () => expect(suggest("a", ctx, 3).length).toBeLessThanOrEqual(3));
});

describe("bookGroups", () => {
  it("groups by testament in order", () => {
    const g = bookGroups(["Gen", "Ps", "John", "Tob"]);
    expect(g.map((x) => x.label)).toEqual(["Old Testament", "New Testament", "Other books"]);
    expect(g[0].books.map((b) => b.osis)).toEqual(["Gen", "Ps"]);
    expect(numbers(3)).toEqual([1, 2, 3]);
  });
});
