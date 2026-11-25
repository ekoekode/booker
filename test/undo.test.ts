import { describe, expect, it } from "vitest";
import { UndoStack, type UndoVault } from "../src/undo";

const fake = (files: Record<string, string>): UndoVault & { files: Record<string, string> } => ({
  files,
  read: async (p) => (p in files ? files[p] : null),
  write: async (p, t) => void (files[p] = t),
  remove: async (p) => void delete files[p],
  list: (f) => Object.keys(files).filter((p) => p.startsWith(f + "/")),
});

describe("UndoStack", () => {
  it("restores edited notes, brings back deleted ones and removes created ones", async () => {
    const v = fake({ "P/a.md": "A", "P/b.md": "B" });
    const u = new UndoStack(v);
    await u.run("merge", ["P/a.md", "P/b.md"], "P", async () => {
      v.files["P/a.md"] = "AB";
      delete v.files["P/b.md"];
      v.files["P/new.md"] = "N";
    });
    expect(await u.undo()).toBe("merge");
    expect(v.files).toEqual({ "P/a.md": "A", "P/b.md": "B" });
    expect(await u.undo()).toBeUndefined();
  });
  it("undoes the latest action first and keeps a limit", async () => {
    const v = fake({ "P/a.md": "0" });
    const u = new UndoStack(v, 2);
    for (const n of ["1", "2", "3"]) await u.run(`set ${n}`, ["P/a.md"], "P", async () => void (v.files["P/a.md"] = n));
    expect(u.size).toBe(2);
    expect(await u.undo()).toBe("set 3");
    expect(v.files["P/a.md"]).toBe("2");
  });
});
