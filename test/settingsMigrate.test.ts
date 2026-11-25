import { describe, expect, it } from "vitest";
import { migrateSettings } from "../src/settingsMigrate";

describe("migrateSettings", () => {
  it("keeps hideProperties", () => {
    const m = migrateSettings({ settings: { hideProperties: true } as any, settingsVersion: 99 });
    expect(m.settings.hideProperties).toBe(true);
  });
  it("carries the old storylineRoot over to projectRoot", () => {
    const m = migrateSettings({ settings: { storylineRoot: "Books" } as any, settingsVersion: 99 });
    expect(m.settings.projectRoot).toBe("Books");
    expect("storylineRoot" in m.settings).toBe(false);
  });
  it("hides properties for older saves and drops the hub layout setting", () => {
    const m = migrateSettings({ settings: { hideProperties: false, hubLayout: "home" } as any, settingsVersion: 2 });
    expect(m.settings.hideProperties).toBe(true);
    expect("hubLayout" in m.settings).toBe(false);
  });
});
