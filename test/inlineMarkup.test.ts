import { describe, expect, it } from "vitest";
import { decodeEntities, inlinePieces } from "../src/views/inlineMarkup";

describe("inline markup", () => {
  it("applies sup instead of showing it", () => {
    expect(inlinePieces("water<sup>1</sup> is")).toEqual([{ text: "water", tags: [] }, { text: "1", tags: ["sup"] }, { text: " is", tags: [] }]);
  });
  it("maps em/strong and nests", () => {
    expect(inlinePieces("<strong>a <em>b</em></strong>")).toEqual([{ text: "a ", tags: ["b"] }, { text: "b", tags: ["b", "i"] }]);
  });
  it("drops unknown tags and breaks into spaces", () => {
    expect(inlinePieces('<span class="x">one</span><br/>two').map((p) => p.text).join("")).toBe("one two");
  });
  it("decodes entities and ignores stray closers", () => {
    expect(decodeEntities("a&nbsp;&amp;&#233;")).toBe("a &é");
    expect(inlinePieces("x</i>y")).toEqual([{ text: "x", tags: [] }, { text: "y", tags: [] }]);
  });
});
