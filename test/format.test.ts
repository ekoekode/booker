import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  actFolderName,
  codexFm,
  emptySystemFile,
  isProject,
  isScene,
  layoutFor,
  linkList,
  newProjectFm,
  parseNote,
  patchNote,
  actTitle,
  applyStructure,
  buildModel,
  planInsertChapter,
  planMoveChapter,
  readStructure,
  structureFor,
  sameStructure, withoutEmpties,
  applyLabels,
  chapterTitle,
  planMove,
  planSwapActs,
  planSwapChapters,
  readLabels,
  setLabel,
  swapLabels,
  positionInAct,
  scheduleRenames,
  sceneFileName,
  scenePath,
  stringifyNote,
  unwrapLink,
  wrapLink,
  type SceneRef,
} from "../src/project/format";

const FX = join(__dirname, "fixtures/project/Probe");
const read = (p: string) => readFileSync(join(FX, p), "utf8");

describe("StoryLine fixtures (real StoryLine 1.11.3 output)", () => {
  it("reads a scene", () => {
    const { fm, body } = parseNote(read("Scenes/Act 1/01-01 Opening.md"));
    expect(isScene(fm)).toBe(true);
    expect(fm).toMatchObject({ title: "Opening", act: 1, chapter: 1, sequence: 1, status: "draft", conflict: "Storm" });
    expect(linkList(fm.characters)).toEqual(["Mara", "Joss"]);
    expect(unwrapLink(fm.pov)).toBe("Mara");
    expect(body.trim()).toBe("");
  });

  it("reads project and codex notes", () => {
    expect(isProject(parseNote(read("Probe.md")).fm)).toBe(true);
    expect(parseNote(read("Codex/Characters/Mara.md")).fm).toMatchObject({ type: "character", name: "Mara" });
  });

  it("round-trips a scene without losing any key", () => {
    const text = read("Scenes/Act 1/01-01 Opening.md");
    const { fm, body } = parseNote(text);
    expect(parseNote(stringifyNote(fm, body)).fm).toEqual(fm);
  });

  it("matches StoryLine's file naming and folders", () => {
    expect(sceneFileName(1, 1, "Opening")).toBe("01-01 Opening.md");
    expect(scenePath("S/Novel/Scenes", 2, 1, "Third")).toBe("S/Novel/Scenes/Act 2/02-01 Third.md");
    expect(actFolderName(1)).toBe("Act 1");
    expect(sceneFileName(undefined, undefined, "A/B")).toBe("00-00 A-B.md");
  });

  it("matches the System files StoryLine writes", () => {
    for (const f of ["characters.json", "plotlines.json", "custom-sections.json", "stats.json"] as const) {
      expect(emptySystemFile(f)).toEqual(JSON.parse(read(`System/${f}`)));
    }
    expect(emptySystemFile("plotgrid.json")).toEqual({});
  });

  it("lays out a project like StoryLine", () => {
    const l = layoutFor("StoryLine", "Novel");
    expect(l.projectFile).toBe("StoryLine/Novel/Novel.md");
    expect(l.characters).toBe("StoryLine/Novel/Codex/Characters");
    expect(l.system).toBe("StoryLine/Novel/System");
  });
});

describe("frontmatter patching", () => {
  it("changes one key and keeps the rest and the body", () => {
    const text = read("Scenes/Act 1/01-01 Opening.md");
    const out = patchNote(text + "Hello.\n", { status: "final", conflict: undefined });
    const { fm, body } = parseNote(out);
    expect(fm.status).toBe("final");
    expect("conflict" in fm).toBe(false);
    expect(fm.title).toBe("Opening");
    expect(body.trim()).toBe("Hello.");
  });

  it("adds frontmatter to a bare note", () => {
    expect(parseNote(patchNote("Just text\n", { type: "scene" }))).toMatchObject({ fm: { type: "scene" }, body: "Just text\n" });
  });
});

describe("wikilinks", () => {
  it("wraps and unwraps", () => {
    expect(wrapLink("Mara")).toBe("[[Mara]]");
    expect(wrapLink("[[Mara]]")).toBe("[[Mara]]");
    expect(unwrapLink("[[Mara|M]]")).toBe("Mara");
    expect(linkList("Mara, [[Joss]]")).toEqual(["Mara", "Joss"]);
    expect(linkList(undefined)).toEqual([]);
  });
});

describe("project and codex frontmatter", () => {
  it("builds new notes with StoryLine's keys", () => {
    expect(newProjectFm("Novel", "id", "2026-10-26")).toEqual({ type: "storyline", title: "Novel", created: "2026-10-26", language: "en", bookId: "id" });
    expect(codexFm("location", "Harbor", "2026-10-26", { world: "Earth" })).toEqual({ type: "location", name: "Harbor", created: "2026-10-26", modified: "2026-10-26", world: "Earth" });
  });
});

describe("planMove (drag a scene to another act or slot)", () => {
  const root = "P/Scenes";
  const mk = (title: string, act: number, chapter: number, sequence: number): SceneRef => ({ title, act, chapter, sequence, path: scenePath(root, act, sequence, title) });
  const scenes = [mk("A", 1, 1, 1), mk("B", 1, 1, 2), mk("C", 1, 2, 3), mk("D", 2, 3, 1)];

  it("moves across acts, renumbers both, closes the gap", () => {
    const ops = planMove(scenes, scenes[1].path, { act: 2, chapter: 3, position: 1 }, root);
    const by = Object.fromEntries(ops.map((o) => [o.from, o]));
    expect(by[scenes[1].path]).toMatchObject({ to: "P/Scenes/Act 2/02-01 B.md", patch: { act: 2, chapter: 3, sequence: 1 } });
    expect(by[scenes[3].path]).toMatchObject({ to: "P/Scenes/Act 2/02-02 D.md", patch: { sequence: 2 } });
    expect(by[scenes[2].path]).toMatchObject({ to: "P/Scenes/Act 1/01-02 C.md", patch: { sequence: 2 } });
    expect(by[scenes[0].path]).toBeUndefined();
  });

  it("reorders inside an act", () => {
    const ops = planMove(scenes, scenes[2].path, { act: 1, position: 1 }, root);
    const seqs = Object.fromEntries(ops.map((o) => [o.from, o.patch.sequence]));
    expect(seqs[scenes[2].path]).toBe(1);
    expect(seqs[scenes[0].path]).toBe(2);
    expect(seqs[scenes[1].path]).toBe(3);
  });

  it("appends when no position is given and is a no-op when nothing changes", () => {
    const end = planMove(scenes, scenes[0].path, { act: 2 }, root);
    expect(end.find((o) => o.from === scenes[0].path)?.to).toBe("P/Scenes/Act 2/02-02 A.md");
    expect(planMove(scenes, scenes[3].path, { act: 2, position: 1 }, root)).toEqual([]);
    expect(planMove(scenes, "nope", { act: 1 }, root)).toEqual([]);
  });
});

describe("positionInAct", () => {
  const root = "P/Scenes";
  const mk = (title: string, act: number, chapter: number, sequence: number): SceneRef => ({ title, act, chapter, sequence, path: scenePath(root, act, sequence, title) });
  const scenes = [mk("A", 1, 1, 1), mk("B", 1, 1, 2), mk("C", 1, 2, 3), mk("D", 1, 4, 4)];

  it("maps a slot in a chapter column to a position in the act", () => {
    expect(positionInAct(scenes, "x", 1, 1, 0)).toBe(1);
    expect(positionInAct(scenes, "x", 1, 1, 1)).toBe(2);
    expect(positionInAct(scenes, "x", 1, 1, 2)).toBe(3);
    expect(positionInAct(scenes, "x", 1, 2, 0)).toBe(3);
  });

  it("ignores the card being dragged", () => {
    expect(positionInAct(scenes, scenes[0].path, 1, 1, 0)).toBe(1);
    expect(positionInAct(scenes, scenes[0].path, 1, 1, 1)).toBe(2);
  });

  it("places an empty chapter between its neighbours, or at the end", () => {
    expect(positionInAct(scenes, "x", 1, 3, 0)).toBe(4);
    expect(positionInAct(scenes, "x", 1, 9, 0)).toBe(5);
    expect(positionInAct([], "x", 1, 1, 0)).toBe(1);
  });
});

describe("scheduleRenames", () => {
  it("renames in an order that never lands on a live file", () => {
    const steps = scheduleRenames([
      { from: "a", to: "b" },
      { from: "b", to: "c" },
    ]);
    expect(steps).toEqual([
      { from: "b", to: "c" },
      { from: "a", to: "b" },
    ]);
  });

  it("parks one file when two swap places", () => {
    const steps = scheduleRenames([
      { from: "x.md", to: "y.md" },
      { from: "y.md", to: "x.md" },
    ]);
    expect(steps.length).toBe(3);
    const live = new Set(["x.md", "y.md"]);
    for (const s of steps) {
      expect(live.has(s.from)).toBe(true);
      expect(live.has(s.to)).toBe(false);
      live.delete(s.from);
      live.add(s.to);
    }
    expect([...live].sort()).toEqual(["x.md", "y.md"]);
  });

  it("skips no-ops", () => {
    expect(scheduleRenames([{ from: "a", to: "a" }])).toEqual([]);
  });
});

describe("names (labels)", () => {
  it("reads StoryLine's actLabels / chapterLabels", () => {
    const l = readLabels({ actLabels: { "0": "Prologue", "1": " Rising " }, chapterLabels: { "2": "The Storm" } });
    expect(l.acts).toEqual({ "0": "Prologue", "1": "Rising" });
    expect(actTitle(0, l)).toBe("Act 0 · Prologue");
    expect(actTitle(3, l)).toBe("Act 3");
    expect(chapterTitle(2, l)).toBe("Chapter 2 · The Storm");
    expect(chapterTitle(undefined, l)).toBe("No chapter");
  });

  it("sets, clears and writes labels the way StoryLine does", () => {
    let l = setLabel(readLabels({}), "act", 0, "Prologue");
    const fm: Record<string, any> = { type: "storyline", title: "N" };
    applyLabels(fm, l);
    expect(fm.actLabels).toEqual({ "0": "Prologue" });
    expect("chapterLabels" in fm).toBe(false);
    l = setLabel(l, "act", 0, "");
    applyLabels(fm, l);
    expect("actLabels" in fm).toBe(false);
  });

  it("names follow their act or chapter when two swap", () => {
    const l = swapLabels({ acts: { "1": "One" }, chapters: {} }, "act", 1, 2);
    expect(l.acts).toEqual({ "2": "One" });
  });
});

describe("reordering acts and chapters", () => {
  const root = "P/Scenes";
  const mk = (title: string, act: number, chapter: number, sequence: number): SceneRef => ({ title, act, chapter, sequence, path: scenePath(root, act, sequence, title) });

  it("swapping acts renames every scene into the other act's folder", () => {
    const scenes = [mk("A", 1, 1, 1), mk("B", 2, 2, 1), mk("C", 2, 2, 2)];
    const ops = planSwapActs(scenes, 1, 2, root);
    const by = Object.fromEntries(ops.map((o) => [o.from, o]));
    expect(by[scenes[0].path]).toMatchObject({ to: "P/Scenes/Act 2/02-01 A.md", patch: { act: 2 } });
    expect(by[scenes[1].path]).toMatchObject({ to: "P/Scenes/Act 1/01-01 B.md", patch: { act: 1 } });
    expect(by[scenes[2].path].to).toBe("P/Scenes/Act 1/01-02 C.md");
  });

  it("swapping chapters in an act keeps the file prefixes in reading order", () => {
    const scenes = [mk("A", 1, 1, 1), mk("B", 1, 1, 2), mk("C", 1, 2, 3)];
    const ops = planSwapChapters(scenes, 1, 1, 2, root);
    const by = Object.fromEntries(ops.map((o) => [o.from, o]));
    expect(by[scenes[2].path]).toMatchObject({ to: "P/Scenes/Act 1/01-01 C.md", patch: { chapter: 1, sequence: 1 } });
    expect(by[scenes[0].path]).toMatchObject({ to: "P/Scenes/Act 1/01-02 A.md", patch: { chapter: 2, sequence: 2 } });
    expect(by[scenes[1].path]).toMatchObject({ to: "P/Scenes/Act 1/01-03 B.md", patch: { chapter: 2, sequence: 3 } });
  });

  it("act 0 sorts before act 1 in reading order", () => {
    const list = [mk("A", 1, 1, 1), mk("P", 0, 0, 1)].sort((x, y) => (x.act as number) - (y.act as number));
    expect(list[0].title).toBe("P");
    expect(scenePath(root, 0, 1, "P")).toBe("P/Scenes/Act 0/00-01 P.md");
  });
});

describe("chapters that exist without scenes", () => {
  const root = "P/Scenes";
  const mk = (title: string, act: number, chapter: number, sequence: number): SceneRef => ({ title, act, chapter, sequence, path: scenePath(root, act, sequence, title) });
  const scenes = [mk("A", 1, 1, 1), mk("B", 1, 2, 2), mk("C", 2, 3, 1)];
  const noLabels = { acts: {}, chapters: {} };

  it("keeps an empty chapter, in the act it was saved in", () => {
    const st = readStructure({ acts: [1, 2], chapters: [1, 2, 3, 4], chapterActs: { "4": 1 } });
    const m = buildModel(scenes, st);
    expect(m.chapters.map((c) => `${c.act}:${c.num}`)).toEqual(["1:1", "1:2", "1:4", "2:3"]);
    expect(structureFor(scenes, m).chapterActs).toEqual({ "4": 1 });
  });

  it("drops a chapter and act whose files are gone, but keeps ones made on purpose", () => {
    // saved by a current Booker: chapter 4 and act 3 were made empty on purpose; chapter 7 and act 5 are leftovers
    const fm = { acts: [1, 2, 3, 5], chapters: [1, 2, 3, 4, 7], chapterActs: { "4": 1, "7": 5 }, emptyChapters: [4], emptyActs: [3] };
    const m = buildModel(scenes, readStructure(fm));
    expect(m.chapters.map((c) => c.num)).toEqual([1, 2, 4, 3]);
    expect(m.acts).toEqual([1, 2, 3]);
    const st = structureFor(scenes, m);
    expect(st.emptyChapters).toEqual([4]);
    expect(st.emptyActs).toEqual([3]);
    expect(st.chapters).not.toContain(7);
  });

  it("a book saved before empties were recorded keeps what it listed until pruned", () => {
    const m = buildModel(scenes, readStructure({ acts: [1, 2, 4], chapters: [1, 2, 3, 8] }));
    expect(m.acts).toEqual([1, 2, 4]);
    expect(m.chapters.some((c) => c.num === 8)).toBe(true);
    const pruned = buildModel(scenes, withoutEmpties(readStructure({ acts: [1, 2, 4], chapters: [1, 2, 3, 8] })));
    expect(pruned.acts).toEqual([1, 2]);
    expect(pruned.chapters.map((c) => c.num)).toEqual([1, 2, 3]);
  });

  it("guesses the act for an empty chapter with no record", () => {
    const m = buildModel(scenes, readStructure({ chapters: [1, 2, 3, 9] }));
    expect(m.chapters.find((c) => c.num === 9)?.act).toBe(2);
  });

  it("round-trips through the project note and detects changes", () => {
    const st = structureFor(scenes, buildModel(scenes, readStructure({ chapters: [5], chapterActs: { "5": 2 } })));
    const fm: Record<string, any> = {};
    applyStructure(fm, st);
    expect(sameStructure(readStructure(fm), st)).toBe(true);
    applyStructure(fm, { acts: [], chapters: [], chapterActs: {}, emptyChapters: [], emptyActs: [] });
    expect(Object.keys(fm).sort()).toEqual(["emptyActs", "emptyChapters"]);
  });

  it("moves a chapter to another act and renumbers so numbers stay ascending", () => {
    const m = buildModel(scenes, readStructure({}));
    const plan = planMoveChapter(scenes, m, { acts: {}, chapters: { "2": "Storm" } }, 2, 2, null, root)!;
    // chapters in order are now: 1 (act 1), 3 (act 2), 2 (act 2) -> numbers 1,2,3 handed out in that order
    expect(plan.model.chapters.map((c) => `${c.act}:${c.num}`)).toEqual(["1:1", "2:2", "2:3"]);
    expect(plan.renumber.get(2)).toBe(3);
    expect(plan.renumber.get(3)).toBe(2);
    expect(plan.labels.chapters).toEqual({ "3": "Storm" });
    const by = Object.fromEntries(plan.ops.map((o) => [o.from, o]));
    expect(by[scenes[1].path]).toMatchObject({ patch: { act: 2, chapter: 3 } });
    expect(by[scenes[2].path]).toMatchObject({ patch: { chapter: 2 } });
  });

  it("reorders chapters inside an act by dropping one before another", () => {
    const three = [mk("A", 1, 1, 1), mk("B", 1, 2, 2), mk("C", 1, 3, 3)];
    const m = buildModel(three, readStructure({}));
    const plan = planMoveChapter(three, m, noLabels, 3, 1, 1, root)!;
    expect(plan.ops.find((o) => o.from === three[2].path)).toMatchObject({ to: "P/Scenes/Act 1/01-01 C.md", patch: { chapter: 1, sequence: 1 } });
    expect(plan.ops.find((o) => o.from === three[0].path)).toMatchObject({ patch: { chapter: 2, sequence: 2 } });
  });

  it("inserts an empty chapter at the end of a middle act without breaking numbering", () => {
    const m = buildModel(scenes, readStructure({}));
    const ins = planInsertChapter(scenes, m, noLabels, 1, "Interlude", root)!;
    expect(ins.num).toBe(3);
    expect(ins.model.chapters.map((c) => `${c.act}:${c.num}`)).toEqual(["1:1", "1:2", "1:3", "2:4"]);
    expect(ins.labels.chapters).toEqual({ "3": "Interlude" });
    expect(ins.ops.find((o) => o.from === scenes[2].path)?.patch.chapter).toBe(4);
  });

  it("inserts a chapter right after a given chapter, or at the end of the act when that is the last one", () => {
    const m = buildModel(scenes, readStructure({}));
    const mid = planInsertChapter(scenes, m, noLabels, 1, "", root, 1)!;
    expect(mid.num).toBe(2);
    expect(mid.model.chapters.map((c) => `${c.act}:${c.num}`)).toEqual(["1:1", "1:2", "1:3", "2:4"]);
    const last = planInsertChapter(scenes, m, noLabels, 1, "", root, 2)!;
    expect(last.num).toBe(3);
  });
});
