import { describe, expect, it } from "vitest";
import { Manuscript, parseMarkdown, plainText } from "../src/export/model";
import { bookNotes, chapterNotes, hasNotes, numberNotes } from "../src/export/notes";

const parse = (md: string, smart = false) => parseMarkdown(md, { lineBreaksAreParagraphs: false, smartQuotes: smart });
const para = (md: string) => {
  const b = parse(md)[0];
  if (b.kind === "rule") throw new Error("rule");
  return b.runs;
};

describe("footnote parsing", () => {
  it("turns [^label] and its definition into a note run", () => {
    const r = para("He wrote it.[^1] Then left.\n\n[^1]: See *Genesis* 1.");
    expect(r.map((x) => x.text)).toEqual(["He wrote it.", "", " Then left."]);
    expect(plainText(r[1].note!)).toBe("See Genesis 1.");
    expect(r[1].note![1].i).toBe(true);
  });

  it("reads inline ^[notes], continuation lines, and drops dangling marks", () => {
    const r = para("A^[inline note] and B[^x] and C[^none].\n\n[^x]: first line\n    second line\n[^unused]: never used");
    const notes = r.filter((x) => x.note).map((x) => plainText(x.note!));
    expect(notes).toEqual(["inline note", "first line second line"]);
    expect(plainText(r)).toBe("A and B and C.");
  });

  it("keeps emphasis around a mark and works in quotes and lists", () => {
    const blocks = parse("> quoted[^a]\n\n- item[^a]\n\n[^a]: note");
    expect(blocks.map((b) => b.kind)).toEqual(["quote", "li"]);
    for (const b of blocks) if (b.kind !== "rule") expect(b.runs.some((r) => r.note)).toBe(true);
  });

  it("applies smart quotes inside notes", () => {
    const b = parse('Text[^1]\n\n[^1]: "Quoted" -- ok', true)[0];
    if (b.kind === "rule") throw new Error();
    expect(plainText(b.runs.find((r) => r.note)!.note!)).toBe("“Quoted” — ok");
  });
});

const doc = (): Manuscript => {
  const ch = (title: string, md: string) => ({ title, number: 1, scenes: [{ title: "s", blocks: parse(md) }] });
  return {
    title: "T", subtitle: "", author: "", surname: "", contact: "", language: "en", words: 0, dedication: "", copyright: "", about: "", coverPath: null, identifier: "x",
    acts: [{ title: "A", titled: false, number: 1, chapters: [ch("one", "a[^1] b[^2]\n\n[^1]: n1\n[^2]: n2"), ch("two", "c[^1]\n\n[^1]: n3")] }],
  };
};

describe("note numbering", () => {
  it("restarts per chapter or runs on", () => {
    const per = numberNotes(doc(), "chapter");
    expect(per.acts[0].chapters.map((c) => chapterNotes(c).map((n) => n.n))).toEqual([[1, 2], [1]]);
    const all = numberNotes(doc(), "book");
    expect(all.acts[0].chapters.map((c) => chapterNotes(c).map((n) => n.n))).toEqual([[1, 2], [3]]);
    expect(bookNotes(all)).toHaveLength(2);
    expect(hasNotes(all)).toBe(true);
  });
});
