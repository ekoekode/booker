// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import path from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { MockVault, mockApp, Events } from "./mocks/obsidian";
import { DEFAULT_SETTINGS } from "../src/types";
import { dayKey } from "../src/stats";
import { InspectorPanel } from "../src/views/inspector";
import { StatsView } from "../src/views/stats";

if (typeof (globalThis as any).ResizeObserver === "undefined") {
  (globalThis as any).ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
}

const ROOT = path.resolve(__dirname, "..");
const tmp = () => mkdtempSync(path.join(tmpdir(), "booker-"));

function makePlugin(dir: string, days: Record<string, { net: number; added: number }> = {}) {
  const app = mockApp(new MockVault(dir));
  return { app, settings: { ...DEFAULT_SETTINGS }, data: { days, settings: DEFAULT_SETTINGS, wordCounts: {} }, events: new Events() } as any;
}

const wait = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const vaults: [string, () => string][] = [
  ["Ember Chronicles", () => path.join(ROOT, "TestVault/The Ember Chronicles")],
  ["empty vault", tmp],
];

describe("writing stats view", () => {
  it("draws today's words, the streak and the 30-day chart", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const view: any = new StatsView({} as any, makePlugin(tmp(), { [dayKey()]: { net: 420, added: 450 } }));
    await view.onOpen();
    const text = view.contentEl.textContent as string;
    expect(text).toContain("450");
    expect(text).toContain("Streak");
    expect(text).toContain("Last 30 days");
    expect(view.contentEl.querySelectorAll("rect.booker-bar").length).toBe(30);
    expect(err).not.toHaveBeenCalled();
    err.mockRestore();
  });
  it("draws with no history", async () => {
    const view: any = new StatsView({} as any, makePlugin(tmp()));
    await view.onOpen();
    expect(view.contentEl.textContent).toContain("Today");
  });
});

describe.each(vaults)("inspector on %s", (_n, dir) => {
  it("opens without throwing and draws", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const plugin = makePlugin(dir());
    const host: any = new StatsView({} as any, plugin);
    const panel = new InspectorPanel(plugin, host.contentEl, () => ({}) as any);
    await panel.render();
    await wait();
    expect(err).not.toHaveBeenCalled();
    expect(host.contentEl.textContent).toContain("Open a note");
    err.mockRestore();
  });
});
