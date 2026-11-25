import { describe, expect, it } from "vitest";
import { layoutFor, parseNote } from "../src/project/format";
import { diffCounts, diffLines, noteName, parseSnapshotName, projectNotePath, projectNoteText, snapshotPath } from "../src/project/notes";

const l = layoutFor("StoryLine", "Novel");

describe("project notes", () => {
  it("writes a project note", () => {
    const n = parseNote(projectNoteText("Themes", "2026-10-26"));
    expect(n.fm).toEqual({ type: "note", title: "Themes", created: "2026-10-26" });
    expect(projectNotePath(l, "Themes")).toBe("StoryLine/Novel/Notes/Themes.md");
  });
  it("cleans names", () => {
    expect(noteName("  ..a/b\\c  ")).toBe("abc");
  });
});

describe("snapshots", () => {
  const when = new Date(2026, 9, 26, 9, 5, 7);
  it("is stored under System, away from the scenes", () => {
    expect(snapshotPath(l, "Cold Lamp", when)).toBe("StoryLine/Novel/System/snapshots/Cold Lamp/2026-10-26 090507.md");
    expect(snapshotPath(l, "Cold Lamp", when, "before edit")).toBe("StoryLine/Novel/System/snapshots/Cold Lamp/2026-10-26 090507 before edit.md");
  });
  it("reads the time and label back", () => {
    expect(parseSnapshotName("2026-10-26 090507 before edit")).toEqual({ when, label: "before edit" });
    expect(parseSnapshotName("2026-10-26 090507")?.label).toBe("");
    expect(parseSnapshotName("notes")).toBeNull();
  });
});

describe("diffLines", () => {
  it("marks added and removed lines", () => {
    const d = diffLines("a\nb\nc", "a\nx\nc\nd");
    expect(d.map((x) => `${x.kind}:${x.text}`)).toEqual(["same:a", "del:b", "add:x", "same:c", "add:d"]);
    expect(diffCounts(d)).toEqual({ added: 2, removed: 1 });
  });
  it("is all same for equal text", () => {
    expect(diffCounts(diffLines("a\nb", "a\nb"))).toEqual({ added: 0, removed: 0 });
  });
});
