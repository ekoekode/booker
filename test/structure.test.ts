import { describe, expect, it } from "vitest";
import { hasMiddleLevel, hasTopLevel, inferLevels, levelsFromSlots, levelsToFm, parseLevels, pluralOf } from "../src/profiles/structure";

describe("structure", () => {
  it("makes plurals", () => {
    expect(pluralOf("entry")).toBe("entries");
    expect(pluralOf("day")).toBe("days");
    expect(pluralOf("church")).toBe("churches");
  });
  it("round-trips levels through frontmatter", () => {
    const l = levelsFromSlots(3, ["Part", "Sermon", "Point"]);
    expect(levelsToFm(l)).toEqual(["part", "sermon", "point"]);
    expect(parseLevels(levelsToFm(l))?.map((x) => x.singular)).toEqual(["part", "sermon", "point"]);
  });
  it("builds one, two and three levels", () => {
    const names: [string, string, string] = ["", "", ""];
    expect(levelsFromSlots(1, names).map((x) => x.singular)).toEqual(["chapter"]);
    expect(levelsFromSlots(2, names).map((x) => x.singular)).toEqual(["part", "entry"]);
    expect(levelsFromSlots(3, names).map((x) => x.singular)).toEqual(["act", "chapter", "scene"]);
    expect(hasTopLevel({ levels: levelsFromSlots(1, names) })).toBe(false);
    expect(hasMiddleLevel({ levels: levelsFromSlots(2, names) })).toBe(false);
  });
  it("infers structure for adopted folders", () => {
    expect(inferLevels([])).toBeNull();
    expect(inferLevels([{ act: 1, chapter: 1 }])).toBeNull();
    expect(inferLevels([{ act: 1 }, { act: 1 }])?.map((x) => x.singular)).toEqual(["scene"]);
    expect(inferLevels([{ act: 1 }, { act: 2 }])?.map((x) => x.singular)).toEqual(["act", "scene"]);
  });
});

import { actFolderName, scenePath, setFolderWord } from "../src/project/format";
import { folderWordFor, makeLevel } from "../src/profiles/structure";

describe("folder names", () => {
  it("names act folders after the top level", () => {
    setFolderWord("B/Scenes", folderWordFor([makeLevel("part"), makeLevel("entry")]));
    expect(scenePath("B/Scenes", 2, 1, "Hi")).toBe("B/Scenes/Part 2/02-01 Hi.md");
    setFolderWord("B/Scenes", folderWordFor([makeLevel("chapter")]));
    expect(scenePath("B/Scenes", 1, 3, "Hi")).toBe("B/Scenes/01-03 Hi.md");
    setFolderWord("B/Scenes", undefined);
    expect(scenePath("B/Scenes", 1, 3, "Hi")).toBe("B/Scenes/Act 1/01-03 Hi.md");
    expect(actFolderName(1, "Sermon")).toBe("Sermon 1");
  });
});

import { levelsFromNames, presetNames } from "../src/profiles/structure";
describe("preset level names", () => {
  it("fiction", () => {
    expect([1, 2, 3].map((n) => presetNames("fiction", [], n))).toEqual([["chapter"], ["act", "chapter"], ["act", "chapter", "scene"]]);
  });
  it("sermon", () => {
    expect([1, 2, 3].map((n) => presetNames("sermon", [], n))).toEqual([["sermon"], ["series", "sermon"], ["audience", "series", "sermon"]]);
  });
  it("other kinds keep their names, dropping the middle first", () => {
    const kind = [{ id: "part", singular: "part", plural: "parts" }, { id: "chapter", singular: "chapter", plural: "chapters" }, { id: "section", singular: "section", plural: "sections" }];
    expect(presetNames("x", kind, 2)).toEqual(["part", "section"]);
    expect(levelsFromNames(["a", "b"]).map((l) => l.singular)).toEqual(["a", "b"]);
  });
});
