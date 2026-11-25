import { describe, expect, it } from "vitest";
import { calloutText } from "../src/notes/callout";
import { parseMarkdown } from "../src/export/model";

describe("callouts", () => {
  it("wraps text and leaves a line to type on when empty", () => {
    expect(calloutText("summary", "Grace comes first.")).toBe("> [!summary] Chapter summary\n> Grace comes first.");
    expect(calloutText("epigraph", "")).toBe("> [!epigraph]\n> ");
  });
  it("prints through the export with the title for summaries and none for epigraphs", () => {
    const o = { lineBreaksAreParagraphs: false, smartQuotes: false };
    const s = parseMarkdown(calloutText("summary", "Grace first."), o)[0] as any;
    expect(s.runs.map((r: any) => r.text).join("")).toBe("Chapter summary. Grace first.");
    const e = parseMarkdown(calloutText("epigraph", "By grace alone."), o)[0] as any;
    expect(e.runs.map((r: any) => r.text).join("")).toBe("By grace alone.");
  });
});

import { citationAt } from "../src/editorMenu";
describe("citation under the cursor", () => {
  it("finds the key when the cursor is inside the marker", () => {
    const line = "As said [@stott, 12] here.";
    expect(citationAt(line, 12)?.key).toBe("stott");
    expect(citationAt(line, 2)).toBeNull();
  });
});
