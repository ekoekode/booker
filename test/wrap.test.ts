import { describe, expect, it } from "vitest";
import { toggleWrap, togglePrefix, Edit } from "../src/writing/wrap";

function apply(doc: string, e: Edit): string {
  // apply right to left so earlier offsets stay valid
  let out = doc;
  for (const c of [...e.changes].sort((a, b) => b.from - a.from)) out = out.slice(0, c.from) + c.insert + out.slice(c.to ?? c.from);
  return out;
}
const wrapped = (doc: string, from: number, to: number, o: string, c = o) => {
  const e = toggleWrap(doc, from, to, o, c);
  const out = apply(doc, e);
  return { out, sel: out.slice(e.anchor, e.head) };
};

describe("toggleWrap", () => {
  it("wraps a selection and keeps it selected", () => {
    expect(wrapped("a word b", 2, 6, "**")).toEqual({ out: "a **word** b", sel: "word" });
  });
  it("removes marks around the selection", () => {
    expect(wrapped("a **word** b", 4, 8, "**")).toEqual({ out: "a word b", sel: "word" });
  });
  it("removes marks included in the selection", () => {
    expect(wrapped("a **word** b", 2, 10, "**")).toEqual({ out: "a word b", sel: "word" });
  });
  it("puts the cursor between a new pair", () => {
    const e = toggleWrap("ab", 1, 1, "*");
    expect(apply("ab", e)).toBe("a**b");
    expect(e.anchor).toBe(2);
    expect(e.head).toBe(2);
  });
  it("italic inside bold wraps instead of stripping the bold", () => {
    expect(wrapped("**word**", 2, 6, "*").out).toBe("***word***");
  });
  it("handles paired html marks", () => {
    expect(wrapped("x y", 2, 3, "<u>", "</u>").out).toBe("x <u>y</u>");
    expect(wrapped("x <u>y</u>", 5, 6, "<u>", "</u>").out).toBe("x y");
  });
});

describe("togglePrefix", () => {
  it("adds and removes", () => {
    expect(togglePrefix("Line", "> ")).toBe("> Line");
    expect(togglePrefix("> Line", "> ")).toBe("Line");
  });
  it("swaps heading levels", () => {
    expect(togglePrefix("# Title", "## ")).toBe("## Title");
    expect(togglePrefix("## Title", "## ")).toBe("Title");
  });
});

import { clearFormatting } from "../src/writing/wrap";
describe("clearFormatting", () => {
  it("removes marks and prefixes", () => {
    expect(clearFormatting("## **Bold** and *it* and ~~x~~ ==hi== <u>u</u>")).toBe("Bold and it and x hi u");
    expect(clearFormatting("> quote\n- item\n1. one")).toBe("quote\nitem\none");
  });
  it("keeps plain text and snake_case", () => {
    expect(clearFormatting("a snake_case word, 2*3")).toBe("a snake_case word, 2*3");
  });
});
