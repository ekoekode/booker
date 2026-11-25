import { describe, expect, it } from "vitest";
import { clock, finish, isDone, msLeft, pace, sprintWords, startSprint } from "../src/sprint";

describe("sprint", () => {
  const s = startSprint(10, 500, 0);
  it("counts down and ends", () => {
    expect(msLeft(s, 60000)).toBe(540000);
    expect(isDone(s, 599999)).toBe(false);
    expect(isDone(s, 600000)).toBe(true);
  });
  it("counts words from the start total", () => {
    expect(sprintWords(s, 760)).toBe(260);
    expect(sprintWords(s, 400)).toBe(0);
  });
  it("freezes when finished, capped at its natural end", () => {
    const f = finish(s, 900, 900000);
    expect(f.endedAt).toBe(600000);
    expect(sprintWords(f, 5000)).toBe(400);
    expect(pace(f, 5000)).toBe(40);
  });
  it("formats the clock", () => {
    expect(clock(540000)).toBe("9:00");
    expect(clock(61000)).toBe("1:01");
    expect(clock(0)).toBe("0:00");
  });
});

import { clock as clock2, lengthLabel, SPRINT_LENGTHS as LENGTHS } from "../src/sprint";
describe("long sprints", () => {
  it("offers up to two and a half hours and shows hours on the clock", () => {
    expect(Math.max(...LENGTHS)).toBe(150);
    expect(lengthLabel(150)).toBe("2 h 30 min");
    expect(lengthLabel(25)).toBe("25 min");
    expect(clock2(150 * 60000)).toBe("2:30:00");
    expect(clock2(59 * 60000 + 5000)).toBe("59:05");
  });
});
