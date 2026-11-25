/** Strong's numbers a Bible file carries in its own markup (<WH430> after a word, <WG3056>), as spans of the verse's plain text. Pure. */
import { parseMarkup, plain } from "./module";
import { normStrongs } from "./interlinear";
import type { Span } from "./align";

const TAG = /<W([HG])0*(\d{1,5})[a-z]?>/g;
const OPEN = "";
const CLOSE = "";

/** The verse's plain text and where each tagged word is in it, or null when the verse has no tags. */
export function taggedSpans(raw: string): { text: string; spans: Span[] } | null {
  if (!/<W[HG]\d/.test(raw)) return null;
  const marks: string[] = [];
  const marked = raw.replace(TAG, (_m, l: string, n: string) => `${OPEN}${marks.push(normStrongs(`${l}${n}`)) - 1}${CLOSE}`);
  const withMarks = plain(parseMarkup(marked));
  let text = "";
  const spans: Span[] = [];
  let lastWord: [number, number] | null = null as [number, number] | null;
  let at = 0;
  for (const m of withMarks.matchAll(new RegExp(`${OPEN}(\\d+)${CLOSE}`, "g"))) {
    text += withMarks.slice(at, m.index);
    at = m.index! + m[0].length;
    const str = marks[Number(m[1])];
    // the tag belongs to the word just before it; tags in a row share that word
    const before = /[\p{L}\p{N}'’-]+$/u.exec(text);
    const direct = before && withMarks.slice(0, m.index).endsWith(before[0]) ? [text.length - before[0].length, text.length] as [number, number] : null;
    const range: [number, number] | null = direct ?? (text.length === (lastWord?.[1] ?? -1) ? lastWord : null);
    if (!range) continue;
    lastWord = range;
    spans.push([range[0], range[1], str]);
  }
  text += withMarks.slice(at);
  return { text, spans };
}
