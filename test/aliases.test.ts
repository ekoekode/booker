import { describe, expect, it } from "vitest";
import { aliasAt, duplicateOf, type AliasEntry } from "../src/codex/aliases";

const john: AliasEntry = { path: "c/John.md", name: "John", aliases: ["Potato", "Big J"], kind: "characters" };
const mara: AliasEntry = { path: "c/Mara.md", name: "Mara", aliases: [], kind: "characters" };

describe("duplicateOf", () => {
  it("finds another note with the same alias, ignoring case", () => {
    expect(duplicateOf([john, mara], { path: "c/Sam.md", name: "Sam", kind: "characters" }, "potato")).toBe(john);
  });
  it("matches a name too, and never the note itself or another category", () => {
    expect(duplicateOf([john, mara], { path: "c/Sam.md", name: "Sam", kind: "characters" }, "mara")).toBe(mara);
    expect(duplicateOf([john], { path: "c/John.md", name: "John", kind: "characters" }, "Potato")).toBeNull();
    expect(duplicateOf([john], { path: "l/Hill.md", name: "Hill", kind: "locations" }, "Potato")).toBeNull();
  });
});

describe("aliasAt", () => {
  it("finds the alias under or just after the cursor", () => {
    const line = "Then potato ran off.";
    expect(aliasAt([john], line, 11)).toMatchObject({ from: 5, to: 11, name: "John" });
    expect(aliasAt([john], line, 8)).toMatchObject({ name: "John" });
    expect(aliasAt([john], line, 2)).toBeNull();
  });
  it("only counts whole words, and the end of it when typing", () => {
    expect(aliasAt([john], "potatoes", 6)).toBeNull();
    expect(aliasAt([john], "a potato", 4, true)).toBeNull();
    expect(aliasAt([john], "a potato", 8, true)).toMatchObject({ name: "John" });
  });
  it("prefers the longest alias and handles several words", () => {
    expect(aliasAt([john], "Big J laughed", 5)).toMatchObject({ alias: "Big J" });
  });
});

describe("aliasAt plurals", () => {
  const chr: AliasEntry = { path: "c/Christian.md", name: "Christian", aliases: ["believer"], kind: "characters" };
  it("takes the alias in the plural and offers the name in the plural", () => {
    const hit = aliasAt([chr], "The believers sang", 13);
    expect(hit).toMatchObject({ alias: "believers", name: "Christians" });
  });
  it("does not take a longer word", () => {
    expect(aliasAt([chr], "believership", 5)).toBeNull();
  });
});
