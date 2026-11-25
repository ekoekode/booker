import { describe, expect, it } from "vitest";
import { listBackups, restoreBackup, runBackup, type BackupSource, type Sink } from "../src/backup/run";

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

class Mem implements Sink {
  files = new Map<string, Uint8Array>();
  async mkdirp() {}
  async write(p: string, d: Uint8Array | string) {
    this.files.set(p, typeof d === "string" ? enc(d) : d);
  }
  async read(p: string) {
    return this.files.get(p) ?? null;
  }
  async list(dir: string) {
    const out = new Map<string, boolean>();
    for (const p of this.files.keys()) if (p.startsWith(dir + "/")) {
      const rest = p.slice(dir.length + 1);
      const i = rest.indexOf("/");
      out.set(i < 0 ? rest : rest.slice(0, i), i >= 0);
    }
    return [...out].map(([name, isDir]) => ({ name, isDir }));
  }
  async remove(p: string) {
    for (const k of [...this.files.keys()]) if (k === p || k.startsWith(p + "/")) this.files.delete(k);
  }
}

class Vault implements BackupSource {
  files = new Map<string, { text: string; mtime: number }>();
  set(p: string, text: string, mtime = 1) {
    this.files.set(p, { text, mtime });
  }
  async list() {
    return [...this.files].map(([path, f]) => ({ path, size: f.text.length, mtime: f.mtime }));
  }
  async read(p: string) {
    return enc(this.files.get(p)!.text);
  }
}

const at = (d: number) => new Date(2026, 9, d, 9, 0, 0);

describe("backup run and restore", () => {
  it("makes a full zip first, then only what changed, then restores any point", async () => {
    const v = new Vault();
    const sink = new Mem();
    v.set("Novel/Novel.md", "project");
    v.set("Novel/Scenes/a.md", "one");
    v.set("Novel/Scenes/b.md", "two");
    const cfg = { mode: "incremental" as const, keep: 5 };

    const r1 = await runBackup("Novel", v, sink, cfg, at(1));
    expect(r1.kind).toBe("full");
    expect([...sink.files.keys()].some((k) => k.endsWith(" full.zip"))).toBe(true);
    expect((await runBackup("Novel", v, sink, cfg, at(1))).kind).toBe("nothing");

    v.set("Novel/Scenes/a.md", "one changed", 2);
    v.set("Novel/Scenes/c.md", "three", 2);
    v.files.delete("Novel/Scenes/b.md");
    const r2 = await runBackup("Novel", v, sink, cfg, at(2));
    expect(r2.kind).toBe("incremental");
    expect(r2.files).toBe(2);
    expect(dec(sink.files.get("Novel/incremental/2026-10-02 090000/Novel/Scenes/a.md")!)).toBe("one changed");
    expect(dec(sink.files.get("Novel/incremental/2026-10-02 090000/_removed.txt")!)).toBe("Novel/Scenes/b.md");

    expect((await listBackups(sink, "Novel")).map((b) => b.kind)).toEqual(["full", "incremental"]);

    const latest = new Mem();
    expect(await restoreBackup(sink, "Novel", latest, "Novel restored")).toBe(3);
    expect(dec(latest.files.get("Novel restored/Scenes/a.md")!)).toBe("one changed");
    expect(latest.files.has("Novel restored/Scenes/b.md")).toBe(false);
    expect(latest.files.has("Novel restored/Scenes/c.md")).toBe(true);

    const early = new Mem();
    await restoreBackup(sink, "Novel", early, "Old", "2026-10-01 235959");
    expect(dec(early.files.get("Old/Scenes/a.md")!)).toBe("one");
    expect(early.files.has("Old/Scenes/b.md")).toBe(true);
  });

  it("keeps only the newest full backups", async () => {
    const v = new Vault();
    const sink = new Mem();
    v.set("P/a.md", "x");
    for (let d = 1; d <= 4; d++) {
      v.set("P/a.md", "x" + d, d);
      await runBackup("P", v, sink, { mode: "full", keep: 2 }, at(d));
    }
    expect((await listBackups(sink, "P")).map((b) => b.stamp)).toEqual(["2026-10-03 090000", "2026-10-04 090000"]);
  });

  it("restores nothing when there is no backup", async () => {
    expect(await restoreBackup(new Mem(), "P", new Mem(), "x")).toBeNull();
  });
});
