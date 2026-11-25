import { describe, expect, it } from "vitest";
import { resolveLayout } from "../src/export/layout";

const ms = { preset: "manuscript" as const, trimSize: "6x9" as const };
const trade = { preset: "trade" as const, trimSize: "6x9" as const };

describe("resolveLayout", () => {
  it("uses the look's defaults when nothing is overridden", () => {
    const m = resolveLayout(ms);
    expect([m.pageW, m.pageH, m.fontSize, m.line, m.indent, m.justify, m.pdfFace]).toEqual([8.5, 11, 12, 2, 0.5, false, "courier"]);
    const t = resolveLayout(trade);
    expect([t.pageW, t.pageH, t.justify, t.pdfFace, t.docxFont]).toEqual([6, 9, true, "embedded", "Georgia"]);
  });

  it("applies page size, custom size and margin overrides", () => {
    expect(resolveLayout({ ...trade, advanced: { pageSize: "a4" } }).pageH).toBe(11.69);
    const c = resolveLayout({ ...trade, advanced: { pageSize: "custom", customWidth: 5, customHeight: 7.5, marginInner: 1.2 } });
    expect([c.pageW, c.pageH, c.inner]).toEqual([5, 7.5, 1.2]);
  });

  it("keeps margins from swallowing the page", () => {
    const l = resolveLayout({ ...trade, advanced: { pageSize: "custom", customWidth: 4, customHeight: 6, marginInner: 3, marginOuter: 3 } });
    expect(l.pageW - l.inner - l.outer).toBeGreaterThanOrEqual(1);
  });

  it("maps font families and cleans a custom font name", () => {
    expect(resolveLayout({ ...trade, advanced: { fontFamily: "sans" } })).toMatchObject({ docxFont: "Arial", pdfFace: "helvetica", fontChosen: true });
    const c = resolveLayout({ ...trade, advanced: { fontFamily: "custom", customFont: 'Bad"; font' } });
    expect(c.docxFont).toBe("Bad font");
    expect(c.pdfFace).toBe("embedded");
    expect(resolveLayout({ ...trade, advanced: { fontFamily: "custom", customFont: "  " } }).fontChosen).toBe(false);
  });

  it("clamps numbers and handles toggles", () => {
    const l = resolveLayout({ ...ms, advanced: { fontSize: 500, lineSpacing: 0.2, justify: "on", pageNumbers: "off", breakBeforeChapter: false } });
    expect([l.fontSize, l.line, l.justify, l.pageNumbers, l.breakBeforeChapter, l.breakBeforeAct]).toEqual([24, 1, true, false, false, true]);
  });
});

import { epubOverrides } from "../src/export/epub";
describe("epubOverrides", () => {
  it("adds only what was changed", () => {
    expect(epubOverrides({ trimSize: "6x9" })).toBe("");
    const css = epubOverrides({ trimSize: "6x9", advanced: { lineSpacing: 1.8, firstLineIndent: 0, justify: "off", fontFamily: "sans" } });
    expect(css).toContain("line-height: 1.8");
    expect(css).toContain("text-indent: 0in");
    expect(css).toContain("text-align: left");
    expect(css).toContain("Arial");
  });
});
