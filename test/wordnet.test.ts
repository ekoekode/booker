import { describe, expect, it } from "vitest";
import { parseDataFile, parseWordNet, readTarBuffer } from "../src/resources/wordnet";

const noun = `  1 This software and database is being provided to you
00001740 03 n 01 entity 0 003 ~ 00001930 n 0000 | that which is perceived or known; "an entity"
00002000 03 n 03 big_cat 0 cat 1 feline 0 001 @ 00001740 n 0000 | any of several large cats typically able to roar; "lions are big cats"
`;
const adj = `00003000 00 s 02 large(a) 0 big 0 000 | above average in size
`;

describe("wordnet", () => {
  it("reads synsets, skipping the licence header and examples", () => {
    const s = parseDataFile(noun, "n.");
    expect(s).toHaveLength(2);
    expect(s[1]).toEqual({ pos: "n.", words: ["big cat", "cat", "feline"], gloss: "any of several large cats typically able to roar" });
  });
  it("builds one row per word with senses and synonyms", () => {
    const rows = parseWordNet({ noun, verb: "", adj, adv: "" });
    const cat = rows.find((r) => r.word === "cat")!;
    expect(cat.text).toBe("n. any of several large cats typically able to roar\nSynonyms: big cat, feline");
    expect(rows.find((r) => r.word === "large")!.text).toContain("Synonyms: big");
    expect(rows.map((r) => r.word)).toEqual([...rows.map((r) => r.word)].sort());
  });
  it("reads a tar by base name", () => {
    const enc = new TextEncoder();
    const body = enc.encode("hello");
    const head = new Uint8Array(512);
    head.set(enc.encode("dict/data.noun"));
    head.set(enc.encode("0000005\0"), 124);
    head[156] = 48;
    const tar = new Uint8Array(512 * 3);
    tar.set(head);
    tar.set(body, 512);
    expect(new TextDecoder().decode(readTarBuffer(tar).get("data.noun"))).toBe("hello");
  });
});
