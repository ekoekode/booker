import { describe, expect, it } from "vitest";
import { diffManifest, FULL_EVERY, isDue, planRun, prune, restoreChain, stamp, type FileInfo, type Manifest } from "../src/backup/plan";

const f = (path: string, size = 1, mtime = 1): FileInfo => ({ path, size, mtime });
const man = (files: FileInfo[], runs = 0): Manifest => ({ fullStamp: "2026-10-01 000000", runs, files: Object.fromEntries(files.map((x) => [x.path, { size: x.size, mtime: x.mtime }])) });

describe("backup plan", () => {
  it("finds added, changed and removed files", () => {
    const prev = man([f("P/a"), f("P/b"), f("P/c")]).files;
    const d = diffManifest(prev, [f("P/a"), f("P/b", 2), f("P/d")]);
    expect(d).toEqual({ added: ["P/d"], changed: ["P/b"], removed: ["P/c"] });
  });
  it("is due by schedule", () => {
    const now = Date.UTC(2026, 9, 26, 12);
    expect(isDue({ schedule: "manual", dir: "x" }, now)).toBe(false);
    expect(isDue({ schedule: "daily", dir: "" }, now)).toBe(false);
    expect(isDue({ schedule: "daily", dir: "x" }, now)).toBe(true);
    expect(isDue({ schedule: "daily", dir: "x", lastAt: now - 3600_000 }, now)).toBe(false);
    expect(isDue({ schedule: "hourly", dir: "x", lastAt: now - 3600_000 }, now)).toBe(true);
    expect(isDue({ schedule: "weekly", dir: "x", lastAt: now - 6 * 86_400_000 }, now)).toBe(false);
  });
  it("stamps sort as time sorts", () => {
    expect(stamp(new Date(2026, 9, 6, 9, 5, 7))).toBe("2026-10-06 090507");
  });
  it("starts with a full copy, then increments, then starts afresh", () => {
    const files = [f("P/a")];
    expect(planRun("incremental", null, files)).toEqual({ kind: "full" });
    expect(planRun("incremental", man(files), files)).toEqual({ kind: "nothing" });
    expect(planRun("incremental", man(files), [f("P/a", 5)])).toMatchObject({ kind: "incremental" });
    expect(planRun("incremental", man(files, FULL_EVERY), [f("P/a", 5)])).toEqual({ kind: "full" });
    expect(planRun("full", man(files), files)).toEqual({ kind: "nothing" });
    expect(planRun("full", man(files), [f("P/a", 5)])).toEqual({ kind: "full" });
  });
  it("prunes old chains", () => {
    const fulls = ["2026-10-01 000000", "2026-10-10 000000", "2026-10-20 000000"];
    const incs = ["2026-10-02 000000", "2026-10-11 000000", "2026-10-21 000000"];
    expect(prune(fulls, incs, 2)).toEqual({ fulls: ["2026-10-01 000000"], incrementals: ["2026-10-02 000000"] });
    expect(prune(fulls, incs, 5)).toEqual({ fulls: [], incrementals: [] });
    expect(prune(fulls, incs, 1).fulls).toHaveLength(2);
  });
  it("picks what to replay to restore", () => {
    const fulls = ["2026-10-01 000000", "2026-10-10 000000"];
    const incs = ["2026-10-02 000000", "2026-10-11 000000", "2026-10-12 000000"];
    expect(restoreChain(fulls, incs)).toEqual({ full: "2026-10-10 000000", incrementals: ["2026-10-11 000000", "2026-10-12 000000"] });
    expect(restoreChain(fulls, incs, "2026-10-05 000000")).toEqual({ full: "2026-10-01 000000", incrementals: ["2026-10-02 000000"] });
    expect(restoreChain(fulls, incs, "2026-09-01 000000")).toBeNull();
  });
});
