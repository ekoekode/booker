/**
 * Story-date grammar. Handles exact dates, loose dates (decades, centuries),
 * ranges, "circa", and BCE years, without using JavaScript's Date (which
 * can't represent most of what a long-running fiction timeline needs).
 *
 * Internally every moment is a number `t`: astronomical years with a
 * fractional part. Year 1 CE begins at t=1, 1 BCE begins at t=0,
 * 2 BCE at t=-1, and so on. Historical years are what users type; the
 * conversion lives in `toAstro` / `fromAstro`.
 */

export type Precision = "day" | "month" | "year" | "decade" | "century" | "range";

export interface StoryDate {
  /** start of the span, inclusive */
  start: number;
  /** end of the span, exclusive */
  end: number;
  precision: Precision;
  approx: boolean;
  /** how far (in years) the true date might lie outside [start,end] */
  fuzz: number;
  /** normalised display text */
  display: string;
}

export function toAstro(historical: number): number {
  return historical > 0 ? historical : historical + 1;
}

export function fromAstro(astro: number): number {
  return astro >= 1 ? astro : astro - 1;
}

function isLeap(astroYear: number): boolean {
  return astroYear % 4 === 0 && (astroYear % 100 !== 0 || astroYear % 400 === 0);
}

const CUM_DAYS = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];

function dayOfYear(astroYear: number, month: number, day: number): number {
  let d = CUM_DAYS[month - 1] + day;
  if (month > 2 && isLeap(astroYear)) d += 1;
  return d;
}

function daysIn(astroYear: number): number {
  return isLeap(astroYear) ? 366 : 365;
}

function monthLength(astroYear: number, month: number): number {
  const lens = [31, isLeap(astroYear) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return lens[month - 1];
}

const FUZZ: Record<Precision, number> = {
  day: 1 / 12,
  month: 0.25,
  year: 5,
  decade: 10,
  century: 50,
  range: 0,
};

const APPROX_PREFIX = /^(?:circa|about|approx\.?|ca\.?|c\.?|~)\s*/i;

function yearLabel(historical: number): string {
  if (historical < 0) return `${Math.abs(historical)} BCE`;
  return String(historical);
}

function parseHistoricalYear(raw: string): number | null {
  const s = raw.trim();
  let m = /^(\d{1,7})\s*(BCE|BC|B\.C\.E?\.?)$/i.exec(s);
  if (m) return -parseInt(m[1], 10);
  m = /^(\d{1,7})\s*(CE|AD|A\.D\.|C\.E\.)$/i.exec(s);
  if (m) return parseInt(m[1], 10);
  m = /^(-?)(\d{1,7})$/.exec(s);
  if (m) {
    const n = parseInt(m[2], 10);
    return m[1] ? -n : n;
  }
  return null;
}

/** Move an astronomical time forward (or back) by whole days. */
function addDays(t: number, n: number): number {
  let y = Math.floor(t + 1e-9);
  let d = Math.round((t - y) * daysIn(y)) + n;
  while (d >= daysIn(y)) {
    d -= daysIn(y);
    y++;
  }
  while (d < 0) {
    y--;
    d += daysIn(y);
  }
  return y + d / daysIn(y);
}

/** Move by whole months, keeping the day of the month (or the month's last day when it is shorter). */
function addMonths(t: number, k: number): number {
  const y = Math.floor(t + 1e-9);
  const doy = Math.round((t - y) * daysIn(y)) + 1;
  let month = 12;
  while (month > 1 && dayOfYear(y, month, 1) > doy) month--;
  const day = doy - (dayOfYear(y, month, 1) - 1);
  const idx = y * 12 + (month - 1) + k;
  const ny = Math.floor(idx / 12);
  const nm = idx - ny * 12 + 1;
  return ny + (dayOfYear(ny, nm, Math.min(day, monthLength(ny, nm))) - 1) / daysIn(ny);
}

/** The start of a book's timeline, from what was typed (a date such as 2031-04-02), as a time to count Day 1, Week 1 and Year 2 from. */
export function timelineAnchor(text: unknown): number | undefined {
  const d = parseStoryDate(text);
  return d ? d.start : undefined;
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

function single(input: string, anchor?: number): StoryDate | null {
  let s = input.trim();
  if (!s) return null;
  let approx = false;
  const ap = APPROX_PREFIX.exec(s);
  if (ap) {
    approx = true;
    s = s.slice(ap[0].length).trim();
  }

  // Day 3, Week 2, Month 4, Year 2: counted from the book's timeline start (Day 1 is the start day itself)
  const rel = /^(day|week|month|year)\s*(\d{1,6})$/i.exec(s);
  if (rel) {
    if (anchor === undefined || !Number.isFinite(anchor)) return null;
    const n = parseInt(rel[2], 10);
    if (n < 1) return null;
    const unit = rel[1].toLowerCase();
    const label = `${unit[0].toUpperCase()}${unit.slice(1)} ${n}`;
    const span = (start: number, end: number, precision: Precision): StoryDate => ({ start, end, precision, approx, fuzz: approx ? FUZZ[precision] : 0, display: `${approx ? "c. " : ""}${label}` });
    if (unit === "day") return span(addDays(anchor, n - 1), addDays(anchor, n), "day");
    if (unit === "week") return span(addDays(anchor, 7 * (n - 1)), addDays(anchor, 7 * n), "range");
    if (unit === "month") return span(addMonths(anchor, n - 1), addMonths(anchor, n), "month");
    return span(addMonths(anchor, 12 * (n - 1)), addMonths(anchor, 12 * n), "year");
  }

  // 10/2/2016 (month first, as a date is usually typed; day first when the first number cannot be a month)
  let m: RegExpExecArray | null = /^(\d{1,2})\/(\d{1,2})\/(\d{1,7})$/.exec(s);
  if (m) {
    let mo = parseInt(m[1], 10);
    let d = parseInt(m[2], 10);
    if (mo > 12 && d <= 12) [mo, d] = [d, mo];
    return single(`${approx ? "c. " : ""}${m[3]}-${mo}-${d}`);
  }
  // Oct 2, 2016 / 2 Oct 2016 / October 2016
  m = /^(?:(\d{1,2})(?:st|nd|rd|th)?\s+)?([A-Za-z]{3,9})\.?\s*(?:(\d{1,2})(?:st|nd|rd|th)?,?\s+)?(\d{3,7})$/.exec(s);
  if (m) {
    const mo = MONTHS.findIndex((n) => n.startsWith(m![2].toLowerCase().slice(0, 3)) && m![2].length <= n.length && n.startsWith(m![2].toLowerCase())) + 1;
    const day = m[1] ?? m[3];
    if (mo > 0) return single(`${approx ? "c. " : ""}${m[4]}-${mo}${day ? `-${day}` : ""}`);
  }

  // YYYY-MM-DD / YYYY-MM  (leading minus = BCE)
  m = /^(-?)(\d{1,7})-(\d{1,2})(?:-(\d{1,2}))?$/.exec(s);
  if (m) {
    const hist = (m[1] ? -1 : 1) * parseInt(m[2], 10);
    const a = toAstro(hist);
    const month = parseInt(m[3], 10);
    if (month < 1 || month > 12) return null;
    if (m[4] !== undefined) {
      const day = parseInt(m[4], 10);
      if (day < 1 || day > monthLength(a, month)) return null;
      const start = a + (dayOfYear(a, month, day) - 1) / daysIn(a);
      const end = a + dayOfYear(a, month, day) / daysIn(a);
      return {
        start,
        end,
        precision: "day",
        approx,
        fuzz: approx ? FUZZ.day : 0,
        display: `${approx ? "c. " : ""}${yearLabel(hist)}-${pad(month)}-${pad(day)}`,
      };
    }
    const start = a + (dayOfYear(a, month, 1) - 1) / daysIn(a);
    const end = a + (dayOfYear(a, month, monthLength(a, month)) ) / daysIn(a);
    return {
      start,
      end,
      precision: "month",
      approx,
      fuzz: approx ? FUZZ.month : 0,
      display: `${approx ? "c. " : ""}${yearLabel(hist)}-${pad(month)}`,
    };
  }

  // decade / century by "1800s", "500s BCE"
  m = /^(\d{1,7})s\s*(BCE|BC|CE|AD)?$/i.exec(s);
  if (m) {
    const n = parseInt(m[1], 10);
    const bce = !!m[2] && /^b/i.test(m[2]);
    const isCentury = n % 100 === 0;
    const span = isCentury ? 100 : 10;
    // "1800s" => 1800..1899. BCE decades run backwards: "500s BCE" => 509..500 BCE
    if (!bce) {
      const a = toAstro(n);
      return {
        start: a,
        end: a + span,
        precision: isCentury ? "century" : "decade",
        approx,
        fuzz: approx ? FUZZ[isCentury ? "century" : "decade"] : 0,
        display: `${approx ? "c. " : ""}${n}s`,
      };
    }
    const startHist = -(n + span - 1);
    const a = toAstro(startHist);
    return {
      start: a,
      end: a + span,
      precision: isCentury ? "century" : "decade",
      approx,
      fuzz: approx ? FUZZ[isCentury ? "century" : "decade"] : 0,
      display: `${approx ? "c. " : ""}${n}s BCE`,
    };
  }

  // "19th century", "5th century BCE"
  m = /^(\d{1,4})(?:st|nd|rd|th)\s+century\s*(BCE|BC|CE|AD)?$/i.exec(s);
  if (m) {
    const n = parseInt(m[1], 10);
    const bce = !!m[2] && /^b/i.test(m[2]);
    if (n < 1) return null;
    const startHist = bce ? -(n * 100) : (n - 1) * 100 + 1;
    const a = toAstro(startHist);
    return {
      start: a,
      end: a + 100,
      precision: "century",
      approx,
      fuzz: approx ? FUZZ.century : 0,
      display: `${approx ? "c. " : ""}${ordinal(n)} century${bce ? " BCE" : ""}`,
    };
  }

  const hist = parseHistoricalYear(s);
  if (hist !== null && hist !== 0) {
    const a = toAstro(hist);
    return {
      start: a,
      end: a + 1,
      precision: "year",
      approx,
      fuzz: approx ? FUZZ.year : 0,
      display: `${approx ? "c. " : ""}${yearLabel(hist)}`,
    };
  }
  return null;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function ordinal(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/**
 * Parse a story date. Accepts strings or numbers (YAML may hand us a number).
 * Returns null for empty or unparseable input.
 */
export function parseStoryDate(input: unknown, anchor?: number): StoryDate | null {
  if (input === null || input === undefined) return null;
  const text = typeof input === "number" ? String(input) : String(input).trim();
  if (!text) return null;

  // ranges: "1800..1850", "1800 - 1850" is ambiguous with BCE minus so only
  // "..", "–", "—", or " to " are range separators.
  const rangeSplit = /\s*(?:\.\.|–|—|\bto\b)\s*/i.exec(text);
  if (rangeSplit && rangeSplit.index > 0) {
    const a = single(text.slice(0, rangeSplit.index), anchor);
    const b = single(text.slice(rangeSplit.index + rangeSplit[0].length), anchor);
    if (a && b) {
      const start = Math.min(a.start, b.start);
      const end = Math.max(a.end, b.end);
      return {
        start,
        end,
        precision: "range",
        approx: a.approx || b.approx,
        fuzz: Math.max(a.fuzz, b.fuzz),
        display: `${a.display}–${b.display}`,
      };
    }
    return null;
  }
  return single(text, anchor);
}

/** Midpoint of a span, used when a single position is needed. */
export function midpoint(d: StoryDate): number {
  return (d.start + d.end) / 2;
}

/** Format an astronomical time as a human label at roughly the given resolution (years per tick). */
export function formatTime(t: number, resolution = 1): string {
  const hist = fromAstro(Math.floor(t + 1e-9));
  const yr = hist < 0 ? `${group(Math.abs(hist))} BCE` : group(hist);
  if (resolution >= 1) return yr;
  const frac = t - Math.floor(t + 1e-9);
  const a = Math.floor(t + 1e-9);
  const doy = Math.min(daysIn(a), Math.floor(frac * daysIn(a) + 1e-6) + 1);
  let month = 1;
  let rem = doy;
  while (month < 12 && rem > monthLength(a, month)) {
    rem -= monthLength(a, month);
    month++;
  }
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  if (resolution >= 1 / 12) return `${MONTHS[month - 1]} ${yr}`;
  return `${rem} ${MONTHS[month - 1]} ${yr}`;
}

function group(n: number): string {
  const r = Math.round(n);
  // ordinary years read better ungrouped: 1847, but 12,000 BCE
  if (r < 10000) return String(r);
  return r.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Time value of a calendar date given as an astronomical year, month 1-12 and day 1-31. */
export function tOfDate(astroYear: number, month: number, day: number): number {
  return astroYear + (dayOfYear(astroYear, month, day) - 1) / daysIn(astroYear);
}

export function daysInMonth(astroYear: number, month: number): number {
  return monthLength(astroYear, month);
}

/** Overlap test on two spans. */
export function overlaps(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  return a.start < b.end && b.start < a.end;
}

// ------------------------------------------------------------------
// Editing dates by dragging
// ------------------------------------------------------------------

export interface WhenPair {
  when: string;
  when_end: string;
}

type EditPrecision = "day" | "month" | "year";

function editPrecision(p: Precision): EditPrecision {
  return p === "day" || p === "month" ? p : "year";
}

/** half of one unit of the precision, in years */
function halfUnit(p: EditPrecision, astroYear: number): number {
  if (p === "day") return 0.5 / daysIn(astroYear);
  if (p === "month") return 1 / 24;
  return 0.5;
}

/** Text for the calendar unit (day, month or year) that contains instant t. */
function formatAt(t: number, p: EditPrecision): string {
  const a = Math.floor(t + 1e-9);
  const hist = fromAstro(a);
  if (p === "year") return hist < 0 ? `${-hist} BCE` : String(hist);
  const ys = hist < 0 ? `-${-hist}` : String(hist);
  const dim = daysIn(a);
  let rem = Math.min(dim, Math.floor((t - a) * dim + 1e-6) + 1);
  let month = 1;
  while (month < 12 && rem > monthLength(a, month)) {
    rem -= monthLength(a, month);
    month++;
  }
  return p === "month" ? `${ys}-${pad(month)}` : `${ys}-${pad(month)}-${pad(rem)}`;
}

interface Edges {
  start: number;
  /** exclusive */
  end: number;
  startP: EditPrecision;
  endP: EditPrecision;
  point: boolean;
  approx: boolean;
}

function readEdges(whenText: unknown, whenEndText: unknown, anchor?: number): Edges | null {
  const s = parseStoryDate(whenText, anchor);
  if (!s) return null;
  const hasEnd = whenEndText !== null && whenEndText !== undefined && String(whenEndText).trim() !== "";
  const e = hasEnd ? parseStoryDate(whenEndText, anchor) : null;
  if (hasEnd && !e) return null;
  const point = !e && (s.precision === "day" || s.precision === "month" || s.precision === "year");
  return {
    start: s.start,
    end: e ? Math.max(s.end, e.end) : s.end,
    startP: editPrecision(s.precision),
    endP: e ? editPrecision(e.precision) : editPrecision(s.precision),
    point,
    approx: s.approx,
  };
}

function build(ed: Edges, start: number, end: number, asPoint: boolean): WhenPair {
  const prefix = ed.approx ? "c. " : "";
  const when = prefix + formatAt(start + halfUnit(ed.startP, Math.floor(start)), ed.startP);
  if (asPoint) return { when, when_end: "" };
  const endText = formatAt(end - halfUnit(ed.endP, Math.floor(end - 1e-9)), ed.endP);
  return { when, when_end: endText === when.replace(prefix, "") ? "" : endText };
}

/**
 * Move a date (or range) by deltaT years without changing its size.
 * Points keep their precision. Decades, centuries and ranges become an
 * explicit range (years, or days/months if that is what the edges used).
 * Unparseable input is returned unchanged.
 */
export function shiftStoryDate(whenText: unknown, whenEndText: unknown, deltaT: number, anchor?: number): WhenPair {
  const ed = readEdges(whenText, whenEndText, anchor);
  if (!ed) return { when: whenText == null ? "" : String(whenText), when_end: whenEndText == null ? "" : String(whenEndText) };
  return build(ed, ed.start + deltaT, ed.end + deltaT, ed.point);
}

/**
 * Move one edge of a span, keeping the other where it is. The result is a
 * range (it collapses to a point only if both edges land on the same unit).
 * The edge cannot cross the other edge.
 */
export function resizeStoryDate(whenText: unknown, whenEndText: unknown, edge: "start" | "end", deltaT: number, anchor?: number): WhenPair {
  const ed = readEdges(whenText, whenEndText, anchor);
  if (!ed) return { when: whenText == null ? "" : String(whenText), when_end: whenEndText == null ? "" : String(whenEndText) };
  let { start, end } = ed;
  if (edge === "start") {
    const unitEnd = 2 * halfUnit(ed.endP, Math.floor(end - 1e-9));
    start = Math.min(start + deltaT, end - unitEnd);
  } else {
    const unitEnd = 2 * halfUnit(ed.endP, Math.floor(end - 1e-9));
    end = Math.max(end + deltaT, start + unitEnd);
  }
  return build(ed, start, end, false);
}
