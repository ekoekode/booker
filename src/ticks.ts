import { scaleLinear } from "d3-scale";
import { daysInMonth, formatTime, tOfDate } from "./dates";

export interface Tick {
  t: number;
  label: string;
  major: boolean;
}

/**
 * Axis ticks for a visible time range [t0, t1] (astronomical years).
 * Works from days up to millions of years.
 */
export function makeTicks(t0: number, t1: number, count = 8): Tick[] {
  const span = t1 - t0;
  if (!(span > 0)) return [];
  const rough = scaleLinear().domain([t0, t1]).ticks(count);
  const step = rough.length > 1 ? rough[1] - rough[0] : span;

  if (step >= 1) {
    return rough
      .filter((t) => Number.isInteger(t))
      .map((t) => ({ t, label: formatTime(t, 1), major: true }));
  }

  const out: Tick[] = [];
  const firstYear = Math.floor(t0);
  const lastYear = Math.floor(t1);

  if (span > 0.3) {
    // months (every month, or every few if crowded)
    const everyN = span / (1 / 12) > count * 2 ? Math.ceil(span / (1 / 12) / count) : 1;
    let i = 0;
    for (let a = firstYear; a <= lastYear; a++) {
      for (let m = 1; m <= 12; m++) {
        const t = tOfDate(a, m, 1);
        if (t < t0 || t > t1) continue;
        if (i++ % everyN !== 0) continue;
        out.push({ t, label: m === 1 ? formatTime(t, 1) : formatTime(t, 1 / 12), major: m === 1 });
      }
    }
    return out;
  }

  // days
  const days = span * 365;
  const candidates = [1, 2, 5, 7, 14];
  const stepDays = candidates.find((c) => days / c <= count * 1.6) ?? 14;
  for (let a = firstYear; a <= lastYear; a++) {
    for (let m = 1; m <= 12; m++) {
      const n = daysInMonth(a, m);
      for (let d = 1; d <= n; d += stepDays) {
        const t = tOfDate(a, m, d);
        if (t < t0 || t > t1) continue;
        out.push({ t, label: formatTime(t, 1 / 365), major: d === 1 });
      }
    }
  }
  return out;
}
