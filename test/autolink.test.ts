import { describe, expect, it } from "vitest";
import { buildMatcher, findInsertions, applyInsertions, linkDocument, existingTargets } from "../src/autolinkCore";

const entries = [
  { name: "Aria Vale", target: "Aria Vale" },
  { name: "Aria", target: "Aria Vale" },
  { name: "Mount Kess", target: "Mount Kess" },
  { name: "Ari", target: "Ari Other" },
];
const matcher = buildMatcher(entries);

function link(text: string, mode: "every" | "first" = "every", extra: any = {}) {
  return applyInsertions(text, findInsertions(text, matcher, { mode, ...extra }));
}

describe("auto-link", () => {
  it("links every mention, longest name first", () => {
    expect(link("Aria Vale walked. Aria ran.")).toBe("[[Aria Vale]] walked. [[Aria Vale|Aria]] ran.");
  });
  it("does not match inside longer words", () => {
    expect(link("Ariana and Mariam")).toBe("Ariana and Mariam");
    expect(link("Ari ran")).toBe("[[Ari Other|Ari]] ran");
  });
  it("leaves existing links, code and urls alone", () => {
    expect(link("[[Aria Vale|Aria]] and `Aria` and https://x.com/Aria")).toBe(
      "[[Aria Vale|Aria]] and `Aria` and https://x.com/Aria"
    );
  });
  it("handles possessives", () => {
    expect(link("Aria's blade")).toBe("[[Aria Vale|Aria]]'s blade");
  });
  it("first-mention mode links once and respects existing links", () => {
    expect(link("Aria met Aria", "first")).toBe("[[Aria Vale|Aria]] met Aria");
    expect(link("Aria met Aria", "first", { alreadyLinked: new Set(["Aria Vale"]) })).toBe("Aria met Aria");
  });
  it("does not self-link", () => {
    expect(link("Aria Vale", "every", { selfTarget: "Aria Vale" })).toBe("Aria Vale");
  });
  it("avoids the word being typed", () => {
    const text = "Aria and Mount Kess";
    const ins = findInsertions(text, matcher, { mode: "every", avoidFrom: 9, avoidTo: 19 });
    expect(applyInsertions(text, ins)).toBe("[[Aria Vale|Aria]] and Mount Kess");
  });
  it("linkDocument skips frontmatter, headings and code fences", () => {
    const doc = "---\ncharacters: Aria\n---\n# Aria\nAria came.\n```\nAria\n```\nAria left.";
    expect(linkDocument(doc, matcher, { mode: "every" })).toBe(
      "---\ncharacters: Aria\n---\n# Aria\n[[Aria Vale|Aria]] came.\n```\nAria\n```\n[[Aria Vale|Aria]] left."
    );
  });
  it("returns nothing for an empty matcher", () => {
    expect(findInsertions("Aria", buildMatcher([]), { mode: "every" })).toEqual([]);
  });
});

describe("cursor handling", () => {
  it("links a complete name that ends at the cursor, but not one the cursor is inside", () => {
    const m = buildMatcher([{ name: "Mara Voss", target: "Mara Voss" }]);
    const t = "I met Mara Voss";
    const atEnd = findInsertions(t, m, { mode: "every", avoidFrom: t.length, avoidTo: t.length });
    expect(applyInsertions(t, atEnd)).toBe("I met [[Mara Voss]]");
    const inside = findInsertions(t, m, { mode: "every", avoidFrom: 9, avoidTo: 9 });
    expect(inside).toHaveLength(0);
  });
});

describe("case-insensitive matching", () => {
  const ents = [
    { name: "Mara Voss", target: "Mara Voss", own: true },
    { name: "Mara", target: "Mara Voss" },
    { name: "The Ember Keep", target: "The Ember Keep", own: true },
    { name: "the Keep", target: "The Ember Keep" },
    { name: "The Ash Road", target: "The Ash Road", own: true },
    { name: "Harbor of Sel", target: "Harbor of Sel", own: true },
    { name: "Kes", target: "Kest" },
    { name: "Kest", target: "Kest", own: true },
    { name: "Her", target: "Her" },
  ];
  const m = buildMatcher(ents)!;
  const run = (t: string, mode: "every" | "first" = "every", mm = m, extra: any = {}) =>
    applyInsertions(t, findInsertions(t, mm, { mode, ...extra }));

  it("links lowercase and uppercase, preserving typed text", () => {
    expect(run("ember keep burned")).toBe("[[The Ember Keep|ember keep]] burned");
    expect(run("MARA ran")).toBe("[[Mara Voss|MARA]] ran");
    expect(run("mara voss ran")).toBe("[[Mara Voss|mara voss]] ran");
    expect(run("Mara Voss ran")).toBe("[[Mara Voss]] ran");
  });
  it("handles the alias 'the Keep' and article-less names", () => {
    expect(run("at the keep")).toBe("at [[The Ember Keep|the keep]]");
    expect(run("Ember Keep fell")).toBe("[[The Ember Keep|Ember Keep]] fell");
    expect(run("Ash Road")).toBe("[[The Ash Road|Ash Road]]");
    expect(run("the ash road")).toBe("[[The Ash Road|the ash road]]");
    expect(run("Harbor of Sel")).toBe("[[Harbor of Sel]]");
    expect(run("of Sel")).toBe("of Sel");
  });
  it("links the name part of possessives", () => {
    expect(run("Mara's blade")).toBe("[[Mara Voss|Mara]]'s blade");
    expect(run("mara’s blade")).toBe("[[Mara Voss|mara]]’s blade");
  });
  it("respect mode keeps the old behaviour", () => {
    const r = buildMatcher(ents, { matchCase: "respect" })!;
    expect(run("ember keep MARA", "every", r)).toBe("ember keep MARA");
    expect(run("Mara", "every", r)).toBe("[[Mara Voss|Mara]]");
  });
  it("noise guard", () => {
    expect(run("his her and he")).toBe("his her and he");
    expect(run("kes")).toBe("kes");
    expect(run("Kes")).toBe("[[Kest|Kes]]");
    expect(run("kest")).toBe("[[Kest|kest]]");
    expect(run("keep it")).toBe("keep it");
  });
  it("lowercase alias written by the user is intentional", () => {
    const x = buildMatcher([{ name: "mum", target: "Mother" }])!;
    expect(run("my mum", "every", x)).toBe("my [[Mother|mum]]");
  });
  it("first mention with lowercase later mention and existing aliased links", () => {
    expect(run("Mara met mara", "first")).toBe("[[Mara Voss|Mara]] met mara");
    expect(run("mara met Mara", "first", m, { alreadyLinked: existingTargets("[[Mara Voss|mara]]") })).toBe("mara met Mara");
  });
  it("linkDocument works with lowercase", () => {
    expect(linkDocument("mara left the keep.", m, { mode: "every" })).toBe(
      "[[Mara Voss|mara]] left [[The Ember Keep|the keep]]."
    );
  });
});
