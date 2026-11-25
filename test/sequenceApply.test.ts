import { describe, it, expect } from "vitest";
import { applyDateEdits, itemFromFm, type SeqStore } from "../src/project/sequenceApply";
import { parseNote } from "../src/project/format";
import type { SeqItem } from "../src/project/sequence";

const note = (d: string) => `---\ntype: life\nstoryDate: ${d}\n---\nbody\n`;
function mem(files: Record<string, string>, failOn?: string): SeqStore & { files: Record<string, string> } {
  return {
    files,
    read: async (p) => files[p] ?? null,
    write: async (p, t) => {
      if (p === failOn) throw new Error("disk full");
      files[p] = t;
    },
  };
}
const base = (path: string, when: string, whenEnd = ""): [string, SeqItem] => [path, { path, group: "g", seq: 1, when, whenEnd }];

describe("applyDateEdits", () => {
  it("writes changed dates and keeps the body", async () => {
    const s = mem({ a: note("1342-05-01") });
    const r = await applyDateEdits(s, [{ path: "a", when: "1342-05-13", whenEnd: "1342-05-17" }], new Map([base("a", "1342-05-01")]));
    expect(r.written).toEqual(["a"]);
    expect(parseNote(s.files.a).fm.storyDate).toBe("1342-05-13..1342-05-17");
    expect(parseNote(s.files.a).body).toBe("body\n");
  });
  it("skips notes edited since the edits were computed", async () => {
    const s = mem({ a: note("1999-01-01") });
    const r = await applyDateEdits(s, [{ path: "a", when: "1342-05-13", whenEnd: "" }], new Map([base("a", "1342-05-01")]));
    expect(r.stale).toEqual(["a"]);
    expect(parseNote(s.files.a).fm.storyDate).toBe("1999-01-01");
  });
  it("puts everything back when a write fails", async () => {
    const s = mem({ a: note("1342-05-01"), b: note("1342-06-01") }, "b");
    const orig = { ...s.files };
    const r = await applyDateEdits(
      s,
      [{ path: "a", when: "1400", whenEnd: "" }, { path: "b", when: "1401", whenEnd: "" }],
      new Map([base("a", "1342-05-01"), base("b", "1342-06-01")]),
    );
    expect(r.rolledBack).toBe("disk full");
    expect(r.written).toEqual([]);
    expect(s.files).toEqual(orig);
  });
});

describe("itemFromFm", () => {
  it("reads dates, group, anchor and gap", () => {
    const i = itemFromFm("p", { type: "life", character: "[[Ann]]", number: 2, storyDate: "1342-05-01..1342-05-10", anchor: "[[Scene 1]]", anchorMode: "with", gap: "1w" }, (n) => (n === "Scene 1" ? "s1.md" : undefined));
    expect(i).toMatchObject({ group: "life/Ann", seq: 2, when: "1342-05-01", whenEnd: "1342-05-10", anchor: "s1.md", anchorMode: "with", gap: "1w" });
  });
});
