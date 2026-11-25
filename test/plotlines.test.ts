import { describe, expect, it } from "vitest";
import { buildMap, normTags, parsePlotlines, toggleTag } from "../src/project/plotlines";

describe("plotlines", () => {
  it("keeps unknown keys and fills the known ones", () => {
    const p = parsePlotlines({ tagColors: { a: "#fff" }, other: 1 });
    expect(p.other).toBe(1);
    expect(p.plotlineDescriptions).toEqual({});
    expect(p.tagColors.a).toBe("#fff");
    expect(parsePlotlines(null).tagTypeOverrides).toEqual({});
  });
  it("normalises tags", () => {
    expect(normTags(["#Romance", "romance", " ", "Romance"])).toEqual(["Romance", "romance"]);
    expect(normTags("a, #b")).toEqual(["a", "b"]);
    expect(normTags(undefined)).toEqual([]);
  });
  it("toggles", () => {
    expect(toggleTag(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleTag(["a", "b"], "a")).toEqual(["b"]);
  });
  it("builds lanes in order of first appearance with interchanges", () => {
    const m = buildMap([{ path: "1", tags: ["x"] }, { path: "2", tags: ["y", "x"] }, { path: "3", tags: [] }], { y: "#123456" }, ["z"]);
    expect(m.lines.map((l) => l.tag)).toEqual(["x", "y", "z"]);
    expect(m.lines[0].stops).toEqual([0, 1]);
    expect(m.lines[1].color).toBe("#123456");
    expect(m.spans[1]).toEqual({ lo: 0, hi: 1, lanes: [0, 1] });
    expect(m.spans[2]).toBeNull();
  });
});
