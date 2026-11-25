import { describe, expect, it } from "vitest";
import { readSidebarState } from "../src/views/sidebar";

const base = { open: { search: true, info: true, library: true, importer: true, dictionary: false }, libTab: "bibles" as const };

describe("sidebar saved state", () => {
  it("opens and reveals the card an old tab asked for", () => {
    const s = readSidebarState({ tab: "inspector" }, { ...base, open: { ...base.open, info: false } });
    expect(s.reveal).toBe("info");
    expect(s.open.info).toBe(true);
  });
  it("treats documents and reference as the library", () => {
    expect(readSidebarState({ tab: "documents" }, base).reveal).toBe("library");
    expect(readSidebarState({ tab: "reference" }, base).reveal).toBe("library");
  });
  it("keeps which cards are folded and the library tab, and ignores junk", () => {
    const s = readSidebarState({ open: { search: false, info: "no", bogus: true }, libTab: "documents" }, base);
    expect(s.open).toEqual({ search: false, info: true, library: true, importer: true, dictionary: false });
    expect(s.libTab).toBe("documents");
    expect(s.reveal).toBeNull();
    expect(readSidebarState({ libTab: "nope" }, base).libTab).toBe("bibles");
  });
});
