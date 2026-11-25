import { describe, expect, it } from "vitest";
import { splitOnBreaks } from "../src/project/mdImport";

describe("splitOnBreaks", () => {
  it("splits on every common scene-break style", () => {
    for (const mark of ["***", "---", "___", "* * *", "- - -", "*****"]) {
      expect(splitOnBreaks(`One.\n\n${mark}\n\nTwo.`)).toEqual(["One.", "Two."]);
    }
  });
  it("keeps text with no break as one section", () => {
    expect(splitOnBreaks("Just one scene.\n")).toEqual(["Just one scene."]);
    expect(splitOnBreaks("")).toEqual([""]);
  });
  it("drops empty sections from leading and trailing breaks", () => {
    expect(splitOnBreaks("***\nA\n***\n***\nB\n***")).toEqual(["A", "B"]);
  });
  it("ignores breaks inside code fences", () => {
    expect(splitOnBreaks("A\n```\n***\n```\nB")).toEqual(["A\n```\n***\n```\nB"]);
  });
  it("treats a dash line right under text as a heading underline", () => {
    expect(splitOnBreaks("Title\n---\nbody")).toEqual(["Title\n---\nbody"]);
  });
  it("accepts a custom break line", () => {
    expect(splitOnBreaks("A\n#\nB", "^#$")).toEqual(["A", "B"]);
  });
  it("round trips a merge: joining with the break mark splits back to the same scenes", () => {
    const scenes = ["First scene.", "Second\n\nwith paragraphs.", "Third."];
    expect(splitOnBreaks(scenes.join("\n\n* * *\n\n"))).toEqual(scenes);
  });
});
