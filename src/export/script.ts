/** Finding Hebrew in text so exports can set it right to left in a font that has it. Pure. */

const HE = "[\\u0590-\\u05FF\\uFB1D-\\uFB4F]";
const RUN = new RegExp(`${HE}+(?:[\\s\\u05BE.,;:\\u05C3\\u2019'"“”()-]+${HE}+)*`, "g");

export const hasHebrew = (s: string) => new RegExp(HE).test(s);

export interface Seg {
  t: string;
  he: boolean;
}

/** Split text into Hebrew and other stretches. Spaces and punctuation between Hebrew words stay with the Hebrew. */
export function scriptSegments(text: string): Seg[] {
  if (!hasHebrew(text)) return [{ t: text, he: false }];
  const out: Seg[] = [];
  let at = 0;
  for (const m of text.matchAll(RUN)) {
    if (m.index! > at) out.push({ t: text.slice(at, m.index), he: false });
    out.push({ t: m[0], he: true });
    at = m.index! + m[0].length;
  }
  if (at < text.length) out.push({ t: text.slice(at), he: false });
  return out;
}

/** Visual order for left-to-right drawing: reverse by letter, keeping each letter's vowel points and accents with it. */
export function visualHebrew(text: string): string {
  const clusters: string[] = [];
  for (const ch of text) {
    if (/[֑-ׇֽֿׁׂׅׄ]/.test(ch) && clusters.length) clusters[clusters.length - 1] += ch;
    else clusters.push(ch);
  }
  // brackets and quotes mirror when a line is reversed
  const mirror: Record<string, string> = { "(": ")", ")": "(", "[": "]", "]": "[", "“": "”", "”": "“" };
  return clusters.reverse().map((c) => mirror[c] ?? c).join("");
}

/** Remove vowel points and accents, for people who want the bare consonants. */
export const stripPoints = (s: string) => s.replace(/[֑-ׇֽֿׁׂׅׄ]/g, "");
