import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const walk = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : n.endsWith(".ts") ? [join(d, n)] : []));

describe("ItemView members", () => {
  it("never shadow open, icon or load (Obsidian calls them, so the view would not open)", () => {
    const bad: string[] = [];
    for (const f of walk("src")) {
      const src = readFileSync(f, "utf8");
      if (!/extends ItemView/.test(src)) continue;
      src.split("\n").forEach((l, i) => {
        if (/^ {2}(?:private |public |protected |readonly )*(open|icon|load)\s*[:=(?]/.test(l)) bad.push(`${f}:${i + 1}: ${l.trim()}`);
      });
    }
    expect(bad).toEqual([]);
  });
});
