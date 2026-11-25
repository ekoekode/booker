import { describe, expect, it } from "vitest";
import { addToProperties, analyze, bodyOf, detect, findNames } from "../src/project/detect";

const chars = [{ name: "Ana Vale", aliases: ["Ana"] }, { name: "Bo" }, { name: "Marcus Reed", aliases: ["the captain"] }];
const places = [{ name: "Harbor" }, { name: "The Ember Keep" }];

describe("name detection", () => {
  it("finds names and aliases once, in order, reporting the codex name", () => {
    expect(findNames("Ana walked. Later Marcus Reed met Ana Vale again.", chars)).toEqual(["Ana Vale", "Marcus Reed"]);
    expect(findNames("The captain nodded.", chars)).toEqual(["Marcus Reed"]);
  });

  it("ignores names inside links, code and comments, and inside longer words", () => {
    expect(findNames("See [[Ana Vale]] and `Marcus Reed` and %%Harbor%%. Bobcat.", [...chars, ...places])).toEqual([]);
  });

  it("skips the properties block", () => {
    const doc = "---\ntitle: Ana Vale returns\n---\nShe arrived at the Harbor.";
    expect(bodyOf(doc)).toContain("Harbor");
    expect(detect(doc, chars, places)).toEqual({ characters: [], locations: ["Harbor"], ask: [] });
  });

  it("matches the article-less form of a place", () => {
    expect(findNames("They reached Ember Keep at dusk.", places)).toEqual(["The Ember Keep"]);
  });

  it("asks instead of guessing when a first name fits two notes", () => {
    const mikes = [{ name: "Mike Anderson" }, { name: "Mike Johnson" }, { name: "Dana Cole" }];
    const a = analyze("Mike waved at Dana.", mikes);
    expect(a.names).toEqual(["Dana Cole"]);
    expect(a.ask).toEqual([{ text: "Mike", kind: "characters", options: ["Mike Anderson", "Mike Johnson"] }]);
  });

  it("does not ask about a first name that is part of a full name in the text", () => {
    const mikes = [{ name: "Mike Anderson" }, { name: "Mike Johnson" }];
    const a = analyze("Mike Johnson sat down. Then Mike Anderson did.", mikes);
    expect(a.names).toEqual(["Mike Johnson", "Mike Anderson"]);
    expect(a.ask).toEqual([]);
  });

  it("treats the question as answered once one of the notes is already in the properties", () => {
    const mikes = [{ name: "Mike Anderson" }, { name: "Mike Johnson" }];
    expect(analyze("Mike waved.", mikes, "ignore", ["mike anderson"]).ask).toEqual([]);
  });

  it("takes a first name as that person when only one note has it", () => {
    expect(analyze("Mike waved.", [{ name: "Mike Anderson" }, { name: "Dana Cole" }]).names).toEqual(["Mike Anderson"]);
  });

  it("asks about places too", () => {
    const r = detect("They met at Fort.", [], [{ name: "Fort Ash" }, { name: "Fort Dale" }]);
    expect(r.ask).toEqual([{ text: "Fort", kind: "locations", options: ["Fort Ash", "Fort Dale"] }]);
  });

  it("adds new characters without touching existing ones or the POV", () => {
    const fm: Record<string, any> = { pov: "[[Ana Vale]]", characters: ["[[Bo]]"] };
    expect(addToProperties(fm, { characters: ["Ana Vale", "bo", "Marcus Reed"], locations: [] })).toBe(true);
    expect(fm.characters).toEqual(["[[Bo]]", "[[Marcus Reed]]"]);
    expect(addToProperties(fm, { characters: ["Marcus Reed"], locations: [] })).toBe(false);
  });

  it("fills an empty location but never replaces one", () => {
    const fm: Record<string, any> = {};
    expect(addToProperties(fm, { characters: [], locations: ["Harbor", "Ship"] })).toBe(true);
    expect(fm.location).toBe("[[Harbor]]");
    expect(addToProperties(fm, { characters: [], locations: ["Ship"] })).toBe(false);
    expect(fm.location).toBe("[[Harbor]]");
  });
});
