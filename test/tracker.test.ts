import { describe, expect, it } from "vitest";
import { TaskTracker } from "../src/tasks/tracker";

describe("TaskTracker", () => {
  it("counts queued and running tasks as active", () => {
    const t = new TaskTracker();
    const a = t.add("A");
    const b = t.add("B", { state: "running" });
    expect(t.active()).toBe(2);
    t.finish(a, "done");
    t.finish(b, "failed", "oops");
    expect(t.active()).toBe(0);
    expect(t.tasks().map((x) => x.state)).toEqual(["done", "failed"]);
    expect(b.detail).toBe("oops");
  });
  it("tells listeners and stops after unsubscribing", () => {
    const t = new TaskTracker();
    let n = 0;
    const off = t.subscribe(() => n++);
    const a = t.add("A");
    t.start(a);
    t.update(a, { done: 1, total: 4 });
    off();
    t.finish(a, "done");
    expect(n).toBe(3);
  });
  it("clears finished tasks only, and keeps the last twenty", () => {
    const t = new TaskTracker();
    const live = t.add("live", { state: "running" });
    for (let i = 0; i < 30; i++) t.finish(t.add(`x${i}`), "done");
    expect(t.tasks().filter((x) => x !== live).length).toBe(20);
    t.clearFinished();
    expect(t.tasks()).toEqual([live]);
  });
  it("removes a task that never started", () => {
    const t = new TaskTracker();
    const a = t.add("A");
    t.remove(a);
    expect(t.tasks()).toEqual([]);
  });
});
