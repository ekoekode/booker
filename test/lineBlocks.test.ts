import { describe, expect, it } from "vitest";
import { classifyLines } from "../src/writing/lines";

describe("list and quote lines", () => {
  it("are marked so they keep the book font, without being typeset as prose", () => {
    const info = classifyLines(["Prose here.", "", "- one", "1. two", "> quoted", "| a | b |", "# Heading"]);
    expect(info[0].kind).toBe("text");
    expect([info[2], info[3], info[4]].map((i) => [i.kind, i.block])).toEqual([["skip", true], ["skip", true], ["skip", true]]);
    expect(info[5].block).toBeUndefined();
    expect(info[6].block).toBeUndefined();
  });
});
