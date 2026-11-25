/** Where a source is cited: the lines of a note that contain its [@key]. Pure. */
import { CITE } from "../citations/cite";

export interface CitedLine {
  line: number;
  snippet: string;
}

export function citationLines(text: string, key: string): CitedLine[] {
  const out: CitedLine[] = [];
  text.split("\n").forEach((l, i) => {
    for (const m of l.matchAll(CITE)) {
      if (m[1] !== key) continue;
      const before = l.slice(0, m.index).replace(/\s+$/, "");
      out.push({ line: i + 1, snippet: (before.length > 60 ? `…${before.slice(-60)}` : before) || l.trim().slice(0, 60) });
      break;
    }
  });
  return out;
}
