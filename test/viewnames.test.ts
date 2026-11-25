import { expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

// A view method named like one of Obsidian's own (open, load, icon...) silently breaks the view: the pane stays empty.
it("no view defines a method that clashes with Obsidian's View", () => {
  const dir = path.resolve(__dirname, "../src/views");
  const bad: string[] = [];
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".ts"))) {
    const src = readFileSync(path.join(dir, f), "utf8");
    if (!/extends (ItemView|View)/.test(src)) continue;
    for (const m of src.matchAll(/^  (?:private |protected |public )?(?:async )?(open|load|icon|close|unload|onload|containerEl|contentEl)\(/gm)) bad.push(`${f}: ${m[1]}`);
  }
  expect(bad).toEqual([]);
});
