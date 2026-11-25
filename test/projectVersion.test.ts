import { describe, expect, it } from "vitest";
import { checkVersion, PROJECT_FORMAT_VERSION } from "../src/project/projectVersion";

const clean = { formatVersion: PROJECT_FORMAT_VERSION, missingSystem: [], structureMissing: false, hasBookId: true, legacyEmpties: 0 };

describe("checkVersion", () => {
  it("is ok for a current, complete book", () => {
    expect(checkVersion(clean)).toMatchObject({ state: "ok", problems: [] });
  });
  it("treats a book with no number as format 1 and lists what to repair", () => {
    const r = checkVersion({ ...clean, formatVersion: undefined, missingSystem: ["board.json"], structureMissing: true, hasBookId: false, legacyEmpties: 2 });
    expect(r.state).toBe("older");
    expect(r.stored).toBe(1);
    expect(r.problems.map((p) => p.id)).toEqual(["version", "system", "structure", "bookId", "empties"]);
  });
  it("reports a book from a newer Booker without offering repairs", () => {
    const r = checkVersion({ ...clean, formatVersion: PROJECT_FORMAT_VERSION + 1, missingSystem: ["board.json"] });
    expect(r.state).toBe("newer");
    expect(r.problems).toEqual([]);
  });
  it("flags a current book that lost a file", () => {
    expect(checkVersion({ ...clean, missingSystem: ["stats.json"] }).state).toBe("older");
  });
});
