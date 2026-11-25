import { describe, expect, it } from "vitest";
import { planMarkdownImport, planTotals } from "../src/project/mdImport";

describe("planMarkdownImport", () => {
  const md = `---
title: x
---
Opening words.

# Part One
## The Arrival 1998
First para.

***

Second section.

## Leaving
\`\`\`
# not a heading
\`\`\`
---
Last one.
# Act Two
## Return
Home.
`;
  it("makes headings chapters, Part/Act headings acts and breaks sections", () => {
    const p = planMarkdownImport(md);
    expect(p.acts.map((a) => a.title)).toEqual([undefined, "Part One", "Act Two"]);
    expect(p.acts[0].chapters[0]).toEqual({ title: "Introduction", sections: ["Opening words."] });
    const one = p.acts[1].chapters;
    expect(one.map((c) => c.title)).toEqual(["The Arrival 1998", "Leaving"]);
    expect(one[0].sections).toEqual(["First para.", "Second section."]);
    expect(one[1].sections).toHaveLength(2);
    expect(one[1].sections[0]).toContain("# not a heading");
    expect(p.acts[2].chapters[0].sections).toEqual(["Home."]);
  });
  it("counts", () => {
    expect(planTotals(planMarkdownImport(md))).toMatchObject({ acts: 2, chapters: 4, sections: 6 });
  });
  it("puts plain chapters in one untitled act", () => {
    const p = planMarkdownImport("# A\nx\n# B\ny");
    expect(p.acts).toHaveLength(1);
    expect(p.acts[0].title).toBeUndefined();
  });
});

describe("heading cleanup", () => {
  it("strips {#anchors} and links from headings", () => {
    const p = planMarkdownImport("# Part One {#part-1}\n## The Arrival {#ch1 .chapter}\ntext\n## [Linked](#x) title\nmore");
    expect(p.acts[0].title).toBe("Part One");
    expect(p.acts[0].chapters.map((c) => c.title)).toEqual(["The Arrival", "Linked title"]);
  });
});

describe("planMarkdownImport options", () => {
  const md = "# Book One\n## Chapter A\nText.\n### Sub heading\nMore.\nXXX\nAfter.\n# Book Two\n## Chapter B\nEnd.\n";
  it("chapterLevel keeps deeper headings as text", () => {
    const p = planMarkdownImport(md, { chapterLevel: 2, actWords: "Book" });
    expect(p.acts.map((a) => a.title)).toEqual(["Book One", "Book Two"]);
    expect(p.acts[0].chapters[0].sections[0]).toContain("### Sub heading");
  });
  it("custom act words and break line", () => {
    const p = planMarkdownImport(md, { chapterLevel: 2, actWords: "Book", breakPattern: "XXX" });
    expect(p.acts[0].chapters[0].sections).toHaveLength(2);
  });
  it("empty act words turn acts off", () => {
    const p = planMarkdownImport("# Part One\n## A\nx\n", { actWords: "" });
    expect(p.acts.every((a) => a.title === undefined)).toBe(true);
    expect(p.acts[0].chapters.map((c) => c.title)).toEqual(["Part One", "A"]);
  });
  it("an invalid pattern is treated as plain text", () => {
    const p = planMarkdownImport("# A\none\n((\ntwo\n", { breakPattern: "((" });
    expect(p.acts[0].chapters[0].sections).toEqual(["one", "two"]);
  });
});
