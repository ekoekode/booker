import { describe, expect, it } from "vitest";
import { scenePath, type SceneRef } from "../src/project/format";
import { freePath, planArchive, planRestore } from "../src/project/archive";

const S = "P/Scenes";
const ref = (act: number, seq: number, chapter: number, title: string): SceneRef => ({ path: scenePath(S, act, seq, title), title, act, chapter, sequence: seq });
const book = [ref(1, 1, 1, "A"), ref(1, 2, 1, "B"), ref(1, 3, 2, "C"), ref(2, 1, 3, "D")];

describe("planArchive", () => {
  it("sends the file to Archive and closes the gap in its act only", () => {
    const plan = planArchive(book, book[0].path, S, "P/Archive", () => false)!;
    expect(plan.to).toBe("P/Archive/01-01 A.md");
    expect(plan.ops.map((o) => [o.from, o.to, o.patch.sequence])).toEqual([
      [book[1].path, "P/Scenes/Act 1/01-01 B.md", 1],
      [book[2].path, "P/Scenes/Act 1/01-02 C.md", 2],
    ]);
  });
  it("changes nothing for the last scene of an act", () => {
    expect(planArchive(book, book[2].path, S, "P/Archive", () => false)!.ops).toEqual([]);
  });
  it("does not overwrite a file already in Archive", () => {
    const taken = new Set(["P/Archive/01-01 A.md"]);
    expect(planArchive(book, book[0].path, S, "P/Archive", (p) => taken.has(p))!.to).toBe("P/Archive/01-01 A 2.md");
  });
  it("is null for an unknown scene", () => {
    expect(planArchive(book, "nope.md", S, "P/Archive", () => false)).toBeNull();
  });
});

describe("planRestore", () => {
  it("puts the scene at the end of its chapter and numbers the act", () => {
    const remaining = [book[1], book[2], book[3]].map((s, i) => (s.act === 1 ? { ...s, sequence: i + 1, path: scenePath(S, 1, i + 1, s.title) } : s));
    const archived: SceneRef = { path: "P/Archive/01-01 A.md", title: "A", act: 1, chapter: 1, sequence: 1 };
    const ops = planRestore(remaining, archived, S);
    const mine = ops.find((o) => o.from === archived.path)!;
    expect(mine.to).toBe("P/Scenes/Act 1/01-02 A.md");
    expect(mine.patch.sequence).toBe(2);
    // the later chapter shifts down one
    expect(ops.find((o) => o.from === remaining[1].path)?.patch.sequence).toBe(3);
  });
  it("goes to the end of its act when nothing else is left there", () => {
    const archived: SceneRef = { path: "P/Archive/02-01 Z.md", title: "Z", act: 3, chapter: 5, sequence: 1 };
    const ops = planRestore(book, archived, S);
    expect(ops).toEqual([{ from: archived.path, to: "P/Scenes/Act 3/03-01 Z.md", patch: { sequence: 1, act: 3 } }].map((o) => expect.objectContaining({ to: o.to })));
  });
});

describe("freePath", () => {
  it("counts up", () => {
    const taken = new Set(["F/a.md", "F/a 2.md"]);
    expect(freePath("F", "a.md", (p) => taken.has(p))).toBe("F/a 3.md");
  });
});
