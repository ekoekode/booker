import { describe, expect, it } from "vitest";
import { classifyLines, EM_SPACE, indentLine, outdentLine } from "../src/writing/lines";

describe("classifyLines", () => {
  const run = (s: string) => classifyLines(s.split("\n"));

  it("skips properties and code, and finds the first paragraph", () => {
    const k = run("---\ntype: scene\n---\nThe door opened.\n\nShe left.\n```\ncode\n```\nBack.");
    expect(k.map((x) => x.kind)).toEqual(["skip", "skip", "skip", "text", "blank", "text", "skip", "skip", "skip", "text"]);
    expect(k[3].first).toBe(true);
    expect(k[5].first).toBe(false);
    expect(k[9].first).toBe(false);
  });

  it("restarts 'first' after a heading or scene break", () => {
    const k = run("One.\nTwo.\n* * *\nThree.\n# Chapter\nFour.");
    expect(k.map((x) => x.first)).toEqual([true, false, false, true, false, true]);
    expect(k[2].kind).toBe("skip");
  });

  it("recognises dialogue by quote marks and dashes", () => {
    const k = run('"Go," she said.\n“Why?”\n— No.\nShe went.');
    expect(k.map((x) => x.dialogue)).toEqual([true, true, true, false]);
  });

  it("does not treat markdown structure as prose", () => {
    const k = run("> quote\n- item\n1. one\n| a | b |\n![[img.png]]\nProse.");
    expect(k.map((x) => x.kind)).toEqual(["skip", "skip", "skip", "skip", "skip", "text"]);
  });

  it("indents and outdents by one level", () => {
    expect(indentLine("Hi")).toBe(EM_SPACE + "Hi");
    expect(outdentLine(EM_SPACE + "Hi")).toBe("Hi");
    expect(outdentLine("    Hi")).toBe("Hi");
    expect(outdentLine("Hi")).toBe("Hi");
  });
});
