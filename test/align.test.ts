import { describe, expect, it } from "vitest";
import { alignVerse, Lexicon, learn, runs, stem, tokenize } from "../src/scripture/align";
import { taggedSpans } from "../src/scripture/tagged";
import type { IWord } from "../src/scripture/interlinear";

const w = (s: string, g: string): IWord => ({ t: "", tr: "", g, s, p: "" });
const said = (text: string, spans: ReturnType<typeof alignVerse>) => spans.map(([a, b, s]) => `${text.slice(a, b)}=${s}`);

const JOHN316 = [w("G3779", "so"), w("G1063", "For"), w("G25", "loved"), w("G3588", ""), w("G2316", "God"), w("G3588", "the"), w("G2889", "world"), w("G5620", "that"), w("G3588", "[His]"), w("G5207", "Son"), w("G3588", ""), w("G3439", "one and only"), w("G1325", "He gave"), w("G2443", "that"), w("G3956", "everyone"), w("G3588", "who"), w("G4100", "believes"), w("G1519", "in"), w("G846", "Him"), w("G3361", "vvv"), w("G622", "shall not perish"), w("G235", "but"), w("G2192", "have"), w("G2222", "life"), w("G166", "eternal")];
const BLB316 = "For God so loved the world that He gave the Son, the only begotten, so that everyone believing in Him shall not perish but shall have eternal life.";

describe("stem", () => {
  it("joins forms of a word", () => {
    expect(stem("loved")).toBe(stem("loves"));
    expect(stem("believing")).toBe(stem("believes"));
    expect(stem("heavens")).toBe(stem("heaven"));
  });
});

describe("alignVerse", () => {
  it("finds the words the Berean tables name", () => {
    const got = said(BLB316, alignVerse(JOHN316, BLB316));
    expect(got).toContain("loved=G25");
    expect(got).toContain("God=G2316");
    expect(got).toContain("world=G2889");
    expect(got).toContain("gave=G1325");
    expect(got).toContain("everyone=G3956");
    expect(got).toContain("perish=G622");
    expect(got).toContain("life=G2222");
    expect(got).toContain("eternal=G166");
  });
  it("takes the use of a word nearest the place it should be", () => {
    const text = "In the beginning God created the heavens and the earth. And God saw the light.";
    const words = [w("H430", "God"), w("H1254", "created")];
    const spans = alignVerse([w("H7225", "In the beginning"), w("H1254", "created"), w("H430", "God")], text);
    expect(said(text, spans)).toContain("God=H430");
    expect(spans.filter((s) => s[2] === "H430").length).toBe(1);
    expect(text.slice(spans.find((s) => s[2] === "H430")![0])).toMatch(/^God created/);
    expect(words.length).toBe(2);
  });
  it("fills a word whose English differs from the tables when its neighbours match", () => {
    const text = "the only begotten Son";
    const spans = alignVerse([w("G5207", "Son"), w("G3439", "one and only")], text);
    expect(said(text, spans)).toContain("Son=G5207");
  });
  it("uses what the Bible says of a number elsewhere", () => {
    const lex = new Lexicon();
    for (let i = 0; i < 3; i++) learn(lex, "begotten", [[0, 8, "G3439"]]);
    const text = "his begotten Son came and sat";
    const spans = alignVerse([w("G3439", "one and only"), w("G5207", "Son"), w("G2064", "came")], text, lex);
    expect(said(text, spans)).toContain("begotten=G3439");
  });
  it("gives nothing when the verse and the words share nothing", () => {
    expect(alignVerse([w("H1", "xyz")], "In the beginning")).toEqual([]);
  });
});

describe("runs", () => {
  it("joins words side by side", () => {
    const text = "he shall not perish";
    const spans = alignVerse([w("G622", "shall not perish")], text);
    expect(runs(text, spans, "g622").map(([a, b]) => text.slice(a, b))).toEqual(["not perish"]);
  });
});

describe("taggedSpans", () => {
  it("reads e-Sword Strong's tags", () => {
    const t = taggedSpans("In<WH7225> the<WH7225> beginning<WH7225> God<WH430> created<WH1254>");
    expect(t).not.toBeNull();
    expect(t!.text).toBe("In the beginning God created");
    expect(t!.spans.filter((s) => s[2] === "H7225").map((s) => t!.text.slice(s[0], s[1]))).toEqual(["In", "the", "beginning"]);
    expect(t!.spans.find((s) => s[2] === "H430")!.slice(0, 2)).toEqual([17, 20]);
  });
  it("gives null for a plain verse", () => {
    expect(taggedSpans("In the beginning")).toBeNull();
  });
  it("shares a word between tags in a row", () => {
    const t = taggedSpans("created<WH1254><WH853>");
    expect(t!.spans.map((s) => s[2])).toEqual(["H1254", "H853"]);
  });
});

describe("tokenize", () => {
  it("keeps offsets", () => {
    expect(tokenize("a God's b").map((t) => t.w)).toEqual(["a", "God's", "b"]);
  });
});

import { interlinearVerse } from "../src/scripture/interlinearBible";
describe("interlinearVerse", () => {
  it("tags every English word with its number and drops blanks", () => {
    const t = interlinearVerse([w("H7225", "In the beginning"), w("H853", ""), w("H430", "God"), w("G3361", "vvv")]);
    expect(t).toBe("In<WH7225> the<WH7225> beginning<WH7225> God<WH430>");
    const read = taggedSpans(t)!;
    expect(read.text).toBe("In the beginning God");
    expect(runs(read.text, read.spans, "H7225").map(([a, b]) => read.text.slice(a, b))).toEqual(["In the beginning"]);
  });
});
