import { describe, expect, it } from "vitest";
import { addTask, hideStep, parseTasks, removeTask, showSteps, toggleTask } from "../src/project/tasks";

describe("tasks", () => {
  it("parses junk safely", () => {
    expect(parseTasks("not json")).toEqual({ tasks: [], hidden: [] });
    expect(parseTasks(null)).toEqual({ tasks: [], hidden: [] });
  });
  it("adds, ticks, removes", () => {
    let f = addTask({ tasks: [], hidden: [] }, "  Fix the ferry timeline ");
    expect(f.tasks[0].text).toBe("Fix the ferry timeline");
    expect(addTask(f, "   ")).toBe(f);
    f = toggleTask(f, f.tasks[0].id);
    expect(f.tasks[0].done).toBe(true);
    expect(removeTask(f, f.tasks[0].id).tasks).toEqual([]);
  });
  it("hides and restores steps", () => {
    const f = hideStep(hideStep({ tasks: [], hidden: [] }, "write"), "write");
    expect(f.hidden).toEqual(["write"]);
    expect(showSteps(f).hidden).toEqual([]);
  });
});
