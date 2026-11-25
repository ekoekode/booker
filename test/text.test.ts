import { describe, expect, it } from "vitest";
import { countWords, numericPrefix, proseOf, safeName, splitFrontmatter, stripPrefix } from "../src/text";

describe("countWords", () => {
  it("ignores frontmatter, comments, headings and scene rules", () => {
    const t = `---\ntitle: x\nsummary: lots of words here\n---\n# Heading Words\nOne two three.\n\n* * *\n\n%% hidden note %%\nFour five.`;
    expect(countWords(t)).toBe(5);
  });
  it("counts wiki-link display text once", () => {
    expect(countWords("She met [[Aria Vale|Aria]] at dawn.")).toBe(5);
    expect(countWords("[[Aria Vale]] smiled")).toBe(3);
  });
  it("handles em dashes, contractions and hyphens", () => {
    expect(countWords("It's well-known—really.")).toBe(3);
  });
  it("is zero for empty", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("---\na: b\n---\n")).toBe(0);
  });
});

describe("helpers", () => {
  it("splits frontmatter", () => {
    const r = splitFrontmatter("---\na: 1\n---\nbody");
    expect(r.fm).toBe("a: 1");
    expect(r.body).toBe("body");
    expect(splitFrontmatter("no fm").fm).toBeNull();
  });
  it("prefix helpers", () => {
    expect(numericPrefix("03 Storm")).toBe(3);
    expect(numericPrefix("Storm")).toBeNull();
    expect(stripPrefix("03 Storm")).toBe("Storm");
    expect(stripPrefix("12-The End")).toBe("The End");
  });
  it("safeName strips illegal characters", () => {
    expect(safeName('A/B: "C"?')).toBe("AB C");
    expect(safeName("  ..hidden")).toBe("hidden");
  });
  it("proseOf removes links", () => {
    expect(proseOf("[a](http://x) and [[B|c]]")).toBe("a and c");
  });
});
