import { describe, expect, it } from "vitest";
import { reorderMatterNames } from "../src/project/matter";

const names = ["01 Title.md", "02 Foreword.md", "03 Preface.md"];

describe("reorderMatterNames", () => {
  it("moves the last page to the top, keeping the numbers in place", () => {
    const r = reorderMatterNames(names, 2, 0)!;
    expect(Object.fromEntries(r.map((x) => [x.from, x.to]))).toEqual({ "03 Preface.md": "01 Preface.md", "01 Title.md": "02 Title.md", "02 Foreword.md": "03 Foreword.md" });
  });
  it("moves the first page to the end", () => {
    const r = reorderMatterNames(names, 0, 2)!;
    expect(Object.fromEntries(r.map((x) => [x.from, x.to]))).toEqual({ "01 Title.md": "03 Title.md", "02 Foreword.md": "01 Foreword.md", "03 Preface.md": "02 Preface.md" });
  });
  it("does nothing for the same place", () => {
    expect(reorderMatterNames(names, 1, 1)).toEqual([]);
  });
  it("gives null when a name has no number", () => {
    expect(reorderMatterNames(["01 A.md", "B.md"], 0, 1)).toBeNull();
  });
});
