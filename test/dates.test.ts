import { describe, expect, it } from "vitest";
import { formatTime, fromAstro, overlaps, parseStoryDate, resizeStoryDate, shiftStoryDate, timelineAnchor, toAstro } from "../src/dates";

describe("astronomical conversion", () => {
  it("has no year zero in historical numbering", () => {
    expect(toAstro(1)).toBe(1);
    expect(toAstro(-1)).toBe(0);
    expect(toAstro(-450)).toBe(-449);
    expect(fromAstro(0)).toBe(-1);
    expect(fromAstro(-449)).toBe(-450);
  });
});

describe("parseStoryDate", () => {
  it("parses a plain year", () => {
    const d = parseStoryDate("1847")!;
    expect(d.start).toBe(1847);
    expect(d.end).toBe(1848);
    expect(d.precision).toBe("year");
    expect(d.approx).toBe(false);
  });

  it("accepts YAML numbers", () => {
    expect(parseStoryDate(1847)!.start).toBe(1847);
    expect(parseStoryDate(-450)!.start).toBe(-449);
  });

  it("parses an exact day inside its year", () => {
    const d = parseStoryDate("1847-03-02")!;
    expect(d.precision).toBe("day");
    expect(d.start).toBeGreaterThan(1847.15);
    expect(d.start).toBeLessThan(1847.2);
    expect(d.end - d.start).toBeCloseTo(1 / 365, 5);
  });

  it("parses a month", () => {
    const d = parseStoryDate("1847-02")!;
    expect(d.precision).toBe("month");
    expect(d.end - d.start).toBeCloseTo(28 / 365, 3);
  });

  it("rejects impossible dates", () => {
    expect(parseStoryDate("1847-02-30")).toBeNull();
    expect(parseStoryDate("1847-13-01")).toBeNull();
    expect(parseStoryDate("not a date")).toBeNull();
    expect(parseStoryDate("")).toBeNull();
    expect(parseStoryDate(null)).toBeNull();
  });

  it("handles leap days", () => {
    expect(parseStoryDate("1904-02-29")).not.toBeNull();
    expect(parseStoryDate("1900-02-29")).toBeNull();
    expect(parseStoryDate("2000-02-29")).not.toBeNull();
  });

  it("treats 1800s as 1800 to 1899", () => {
    const d = parseStoryDate("1800s")!;
    expect(d.start).toBe(1800);
    expect(d.end).toBe(1900);
    expect(d.precision).toBe("century");
  });

  it("treats 1840s as a decade", () => {
    const d = parseStoryDate("1840s")!;
    expect(d.start).toBe(1840);
    expect(d.end).toBe(1850);
    expect(d.precision).toBe("decade");
  });

  it("marks circa dates as approximate with fuzz", () => {
    for (const s of ["c.1850", "c. 1850", "ca. 1850", "circa 1850", "~1850"]) {
      const d = parseStoryDate(s)!;
      expect(d.approx).toBe(true);
      expect(d.start).toBe(1850);
      expect(d.fuzz).toBeGreaterThan(0);
      expect(d.display).toBe("c. 1850");
    }
  });

  it("parses ranges", () => {
    const d = parseStoryDate("1800..1850")!;
    expect(d.start).toBe(1800);
    expect(d.end).toBe(1851);
    expect(d.precision).toBe("range");
    expect(parseStoryDate("1800 to 1850")!.end).toBe(1851);
    expect(parseStoryDate("1800–1850")!.end).toBe(1851);
  });

  it("parses BCE years in several spellings", () => {
    for (const s of ["-0450", "-450", "450 BCE", "450 BC", "450 bce"]) {
      const d = parseStoryDate(s)!;
      expect(d.start).toBe(-449);
      expect(d.display).toBe("450 BCE");
    }
  });

  it("parses ranges that cross the BCE/CE boundary", () => {
    const d = parseStoryDate("50 BCE..50 CE")!;
    expect(d.start).toBe(-49);
    expect(d.end).toBe(51);
    // 1 BCE and 1 CE are adjacent: 1 BCE ends at t=1
    expect(parseStoryDate("1 BCE")!.end).toBe(1);
  });

  it("parses BCE decades, running backwards in time", () => {
    const d = parseStoryDate("540s BCE")!;
    // 540s BCE = 549 BCE .. 540 BCE inclusive
    expect(fromAstro(d.start)).toBe(-549);
    expect(d.end - d.start).toBe(10);
    expect(d.precision).toBe("decade");
  });

  it("parses centuries", () => {
    const d = parseStoryDate("19th century")!;
    expect(d.start).toBe(1801);
    expect(d.end).toBe(1901);
    const b = parseStoryDate("5th century BCE")!;
    expect(fromAstro(b.start)).toBe(-500);
    expect(b.end - b.start).toBe(100);
  });

  it("copes with deep time", () => {
    const d = parseStoryDate("12000 BCE")!;
    expect(d.start).toBe(-11999);
    const far = parseStoryDate("250000")!;
    expect(far.start).toBe(250000);
  });

  it("rejects year zero", () => {
    expect(parseStoryDate("0")).toBeNull();
  });
});

describe("overlaps", () => {
  it("is false for adjacent spans", () => {
    expect(overlaps({ start: 0, end: 1 }, { start: 1, end: 2 })).toBe(false);
    expect(overlaps({ start: 0, end: 2 }, { start: 1, end: 3 })).toBe(true);
  });
});

describe("formatTime", () => {
  it("formats years with BCE and grouping", () => {
    expect(formatTime(1847)).toBe("1847");
    expect(formatTime(-449)).toBe("450 BCE");
    expect(formatTime(-11999)).toBe("12,000 BCE");
  });
  it("formats months and days at fine resolution", () => {
    expect(formatTime(1847.5, 1 / 12)).toMatch(/Jul 1847|Jun 1847/);
    expect(formatTime(1847.0, 1 / 365)).toBe("1 Jan 1847");
  });
});

describe("shiftStoryDate / resizeStoryDate", () => {
  const rt = (r: { when: string; when_end: string }) => ({ s: parseStoryDate(r.when)!, e: r.when_end ? parseStoryDate(r.when_end)! : null });

  it("keeps an exact day exact", () => {
    const r = shiftStoryDate("1847-03-02", "", 400 / 365);
    expect(r.when_end).toBe("");
    expect(parseStoryDate(r.when)!.precision).toBe("day");
    expect(r.when).toBe("1848-04-05");
  });
  it("keeps a month a month", () => {
    expect(shiftStoryDate("1847-03", "", 1 / 12)).toEqual({ when: "1847-04", when_end: "" });
  });
  it("keeps a year a year", () => {
    expect(shiftStoryDate("1847", "", 3)).toEqual({ when: "1850", when_end: "" });
  });
  it("turns a century into a range of the same size", () => {
    expect(shiftStoryDate("1800s", "", 10)).toEqual({ when: "1810", when_end: "1909" });
    const { s, e } = rt(shiftStoryDate("1800s", "", 10));
    expect(e!.end - s.start).toBe(100);
  });
  it("shifts a range", () => {
    expect(shiftStoryDate("1800", "1850", -5)).toEqual({ when: "1795", when_end: "1845" });
  });
  it("crosses BCE to CE without a year zero", () => {
    expect(shiftStoryDate("5 BCE", "", 5)).toEqual({ when: "1", when_end: "" });
    expect(shiftStoryDate("2 BCE", "", 1)).toEqual({ when: "1 BCE", when_end: "" });
    const r = shiftStoryDate("10 BCE", "1 BCE", 5);
    expect(r).toEqual({ when: "5 BCE", when_end: "5" });
    expect(r.when).not.toMatch(/-0|^0/);
  });
  it("writes BCE days that parse back", () => {
    const r = shiftStoryDate("450 BCE", "", -2);
    expect(r.when).toBe("452 BCE");
    expect(shiftStoryDate("-450-03-02", "", 0).when).toBe("-450-03-02");
  });
  it("leaves unparseable input alone", () => {
    expect(shiftStoryDate("soon", "", 1)).toEqual({ when: "soon", when_end: "" });
  });
  it("resizes one edge only", () => {
    expect(resizeStoryDate("1800", "1850", "end", 10)).toEqual({ when: "1800", when_end: "1860" });
    expect(resizeStoryDate("1800", "1850", "start", -10)).toEqual({ when: "1790", when_end: "1850" });
    expect(resizeStoryDate("1800s", "", "end", 20)).toEqual({ when: "1800", when_end: "1919" });
  });
  it("does not let an edge cross the other", () => {
    expect(resizeStoryDate("1800", "1850", "start", 500)).toEqual({ when: "1850", when_end: "" });
  });
});

describe("slash and month-name dates", () => {
  const iso = (s: string) => parseStoryDate(s)?.display;
  it("reads month-first slash dates, and day-first when the first number is not a month", () => {
    expect(iso("10/2/2016")).toBe("2016-10-02");
    expect(iso("2/10/2000")).toBe("2000-02-10");
    expect(iso("25/12/1999")).toBe("1999-12-25");
    expect(iso("13/13/2000")).toBeUndefined();
  });
  it("reads month names", () => {
    expect(iso("Oct 2, 2016")).toBe("2016-10-02");
    expect(iso("2 October 2016")).toBe("2016-10-02");
    expect(iso("March 1850")).toBe("1850-03");
    expect(iso("Foo 2016")).toBeUndefined();
  });
});

describe("days, weeks and years counted from the timeline start", () => {
  const a = timelineAnchor("2031-04-02")!;
  const shown = (s: string) => {
    const d = parseStoryDate(s, a);
    return d ? [formatTime(d.start, 1 / 366), d.precision] : null;
  };
  it("needs a start date", () => {
    expect(parseStoryDate("Day 3")).toBeNull();
    expect(timelineAnchor("nonsense")).toBeUndefined();
  });
  it("counts Day 1 as the start day", () => {
    expect(parseStoryDate("Day 1", a)!.start).toBeCloseTo(a, 9);
    expect(parseStoryDate("Day 3", a)!.start).toBeCloseTo(parseStoryDate("2031-04-04")!.start, 9);
    expect(parseStoryDate("day 30", a)!.start).toBeCloseTo(parseStoryDate("2031-05-01")!.start, 9);
    expect(parseStoryDate("Day 0", a)).toBeNull();
  });
  it("counts weeks as seven-day spans", () => {
    const w = parseStoryDate("Week 2", a)!;
    expect(w.start).toBeCloseTo(parseStoryDate("2031-04-09")!.start, 9);
    expect(w.end).toBeCloseTo(parseStoryDate("2031-04-16")!.start, 9);
  });
  it("counts months and years from the same day", () => {
    expect(parseStoryDate("Month 2", a)!.start).toBeCloseTo(parseStoryDate("2031-05-02")!.start, 9);
    expect(parseStoryDate("Year 2", a)!.start).toBeCloseTo(parseStoryDate("2032-04-02")!.start, 9);
    expect(parseStoryDate("Year 2", a)!.end).toBeCloseTo(parseStoryDate("2033-04-02")!.start, 9);
    expect(parseStoryDate("Year 1", a)!.start).toBeCloseTo(a, 9);
  });
  it("rolls over a year and keeps month ends", () => {
    const b = timelineAnchor("2030-12-30")!;
    expect(parseStoryDate("Day 4", b)!.start).toBeCloseTo(parseStoryDate("2031-01-02")!.start, 9);
    const c = timelineAnchor("2031-01-31")!;
    expect(parseStoryDate("Month 2", c)!.start).toBeCloseTo(parseStoryDate("2031-02-28")!.start, 9);
  });
  it("works in ranges", () => {
    expect(parseStoryDate("Day 2..Day 5", a)!.precision).toBe("range");
  });
  void shown;
});

import { shiftStoryDate as shiftRel, timelineAnchor as anchorOf } from "../src/dates";
describe("dragging relative dates", () => {
  it("shifts Day N from the timeline start and writes an absolute date", () => {
    const a = anchorOf("2031-04-02");
    const r = shiftRel("Day 30", "", 5 / 365.25, a);
    expect(r.when).toBe("2031-05-06");
    expect(shiftRel("Day 30", "", 5 / 365.25).when).toBe("Day 30"); // no start date: left alone
  });
});
