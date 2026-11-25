import { describe, expect, it } from "vitest";
import { MemoryBible, verseKey } from "../src/scripture/module";
import { cutParts, DEFAULT_STYLE, formatInsert, partOffsets, verseParts, type VerseStyle } from "../src/scripture/format";
import { parseRefs } from "../src/scripture/ref";
import { parseMarkdown } from "../src/export/model";

const V: Record<string, string> = {
  "John.3.16": "For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.",
  "John.3.17": "For God sent not his Son into the world to condemn the world; but that the world through him might be saved.",
  "John.3.18": "He that believeth on him is not condemned: but he that believeth not is condemned already.",
  "John.4.1": "When therefore the Lord knew how the Pharisees had heard.",
};
const mod = new MemoryBible("kjv", { name: "King James", abbr: "KJV", verses: new Map(Object.entries(V).map(([k, t]) => [k.split(".").length ? verseKey(...(k.split(".") as [string, string, string]).map((x, i) => (i ? +x : x)) as [string, number, number]) : k, [{ t }]])), markup: "plain" });
const fmt = (ref: string, over: Partial<VerseStyle> = {}) => formatInsert(mod, parseRefs(ref)!, { ...DEFAULT_STYLE, ...over });

describe("formatting a quotation", () => {
  it("a single verse as a block quote with the reference after", () => {
    expect(fmt("Jn 3:16")).toBe(`> ${V["John.3.16"]}\n> — John 3:16 KJV`);
  });
  it("numbers the verses of a range and writes the range with an en dash", () => {
    const out = fmt("John 3:16-17");
    expect(out).toContain("<sup>16</sup>For God so loved");
    expect(out).toContain("<sup>17</sup>For God sent");
    expect(out.endsWith("— John 3:16–17 KJV")).toBe(true);
  });
  it("offers inline, plain, bracketed numbers, lines and every reference position", () => {
    expect(fmt("John 3:17", { layout: "inline", reference: "paren" })).toBe(`“${V["John.3.17"]}” (John 3:17 KJV)`);
    expect(fmt("John 3:17", { layout: "inline", reference: "before", translation: "off", naming: "sbl" })).toBe(`John 3:17: “${V["John.3.17"]}”`);
    expect(fmt("John 3:16-17", { layout: "plain", numbers: "bracket", reference: "none" })).toMatch(/^\[16\]For God so loved.* \[17\]For God sent/);
    expect(fmt("John 3:16-17", { lines: true, numbers: "plain", reference: "none" }).split("\n")).toHaveLength(2);
    expect(fmt("John 3:16", { layout: "block", reference: "before", translation: "paren", naming: "short" }).split("\n")[0]).toBe("> John 3:16 (KJV)");
    expect(fmt("John 3:16", { skipSingleNumber: false })).toContain("<sup>16</sup>");
  });
  it("shows the chapter when a range crosses one, and handles whole chapters", () => {
    expect(fmt("John 3:18-4:1", { reference: "none" })).toContain("<sup>4:1</sup>When therefore");
    expect(fmt("John 4", { reference: "after" })).toContain("— John 4 KJV");
  });
  it("joins several passages", () => {
    const out = fmt("John 3:16; 3:18");
    expect(out.split("\n>\n")).toHaveLength(2);
  });
  it("cuts partial verses into a, b and c", () => {
    const parts = verseParts([{ t: V["John.3.16"] }]);
    expect(parts).toHaveLength(3);
    expect(parts.map((p) => p[0].t).join(" ")).toBe(V["John.3.16"]);
    expect(offsetsAreOrdered(V["John.3.16"])).toBe(true);
    const b = fmt("John 3:16b", { reference: "after" });
    expect(b).toMatch(/^> …/);
    expect(b).toContain("John 3:16b KJV");
    const a = fmt("John 3:16a", { reference: "none" });
    expect(a.endsWith("…")).toBe(true);
    expect(a).not.toContain("only begotten Son, that whosoever");
    expect(cutParts([{ t: V["John.3.17"] }], "a", "b")[0].t.length).toBeGreaterThan(10);
    expect(fmt("John 3:16-17a", { reference: "none", numbers: "none" })).toContain("For God sent not his Son into the world");
  });
  it("marks added words and words of Jesus in italics when asked", () => {
    const m = new MemoryBible("x", { name: "X", abbr: "X", verses: new Map([[verseKey("John", 1, 1), [{ t: "Jesus said, " }, { t: "Follow me", jesus: true }, { t: " and the " }, { t: "word", i: true }]]]), markup: "plain" });
    const out = formatInsert(m, parseRefs("John 1:1")!, { ...DEFAULT_STYLE, jesus: "italic", reference: "none" });
    expect(out).toBe("> Jesus said, *Follow me* and the *word*");
    expect(formatInsert(m, parseRefs("John 1:1")!, { ...DEFAULT_STYLE, addedWords: "plain", reference: "none" })).toBe("> Jesus said, Follow me and the word");
  });
  it("gives export a real superscript", () => {
    const blocks = parseMarkdown(fmt("John 3:16-17", { layout: "plain", reference: "none" }), { lineBreaksAreParagraphs: true, smartQuotes: false });
    const runs = (blocks[0] as any).runs;
    expect(runs.filter((r: any) => r.sup).map((r: any) => r.text)).toEqual(["16", "17"]);
  });
});

function offsetsAreOrdered(t: string) {
  const o = partOffsets(t);
  return o.length === 2 && o[0] > 0 && o[1] > o[0] && o[1] < t.length;
}
