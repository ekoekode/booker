/** Extractive summaries: the sentences that best stand for a text, in the order they were written. Pure.
 *  Nothing is generated, so nothing is invented: every sentence is the author's own. */

const ABBREV = /\b(?:Mr|Mrs|Ms|Dr|Prof|St|Mt|vs|etc|e\.g|i\.e|cf|ch|chs|vol|no|nos|pp|p|Fr|Rev|Gen|Ex|Lev|Num|Dt|Jn|Rom|Cor|Gal|Eph|Phil|Col|Heb|Jas|Pet)\.$/i;

/** True when a quotation is opened and not yet closed, so the sentence goes on. */
const openQuote = (t: string) => (t.match(/"/g)?.length ?? 0) % 2 === 1 || (t.match(/“/g)?.length ?? 0) > (t.match(/”/g)?.length ?? 0);

/** Plain sentences from text with Markdown, headings and front matter removed. */
export function splitSentences(text: string, minWords = 5): string[] {
  const body = text
    .replace(/^---\n[\s\S]*?\n---\n?/, "")
    .replace(/%%[\s\S]*?%%/g, "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^#{1,6}\s.*$/gm, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[\[([^\]|]*)\|?([^\]]*)\]\]/g, (_, a, b) => b || a)
    .replace(/\[\^[^\]]+\]/g, "")
    .replace(/[*_`>]+/g, "")
    .replace(/^\s*[-+]\s+/gm, "");
  const out: string[] = [];
  for (const para of body.split(/\n{2,}/)) {
    const flat = para.replace(/\s+/g, " ").trim();
    if (!flat) continue;
    let start = 0;
    const re = /[.!?…]+["'”’)\]]*\s+(?=[A-Z“"‘'(\[0-9])/g;
    for (let m = re.exec(flat); m; m = re.exec(flat)) {
      const cut = m.index + m[0].trimEnd().length;
      const piece = flat.slice(start, cut);
      if (ABBREV.test(piece.trim())) continue;
      out.push(piece.trim());
      start = m.index + m[0].length;
    }
    if (start < flat.length) out.push(flat.slice(start).trim());
  }
  // a very short sentence belongs with the next one
  const merged: string[] = [];
  let carry = "";
  for (const s of out) {
    const t = carry ? `${carry} ${s}` : s;
    if (t.split(/\s+/).length < minWords || openQuote(t)) carry = t;
    else {
      merged.push(t);
      carry = "";
    }
  }
  if (carry && merged.length) merged[merged.length - 1] += ` ${carry}`;
  return merged;
}

const dot = (a: Float32Array, b: Float32Array) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};

/** Indexes of the `k` sentences to keep, in reading order. Maximal marginal relevance: close to the centre of the text, far from each other. */
export function pickSentences(vectors: Float32Array[], k: number, lambda = 0.55): number[] {
  const n = vectors.length;
  if (n === 0 || k <= 0) return [];
  if (k >= n) return vectors.map((_, i) => i);
  const dim = vectors[0].length;
  const centre = new Float32Array(dim);
  for (const v of vectors) for (let d = 0; d < dim; d++) centre[d] += v[d];
  let len = Math.sqrt(dot(centre, centre)) || 1;
  for (let d = 0; d < dim; d++) centre[d] /= len;
  const relevance = vectors.map((v) => dot(v, centre));
  const chosen: number[] = [];
  const left = new Set(vectors.map((_, i) => i));
  while (chosen.length < k && left.size) {
    let best = -1;
    let bestScore = -Infinity;
    for (const i of left) {
      const redundancy = chosen.length ? Math.max(...chosen.map((j) => dot(vectors[i], vectors[j]))) : 0;
      const score = lambda * relevance[i] - (1 - lambda) * redundancy;
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    chosen.push(best);
    left.delete(best);
  }
  return chosen.sort((a, b) => a - b);
}

/** How many sentences a summary of this many should have: about a tenth, between 3 and 12, or all when the text is short. */
export function defaultLength(sentences: number): number {
  return Math.min(sentences, Math.max(3, Math.min(12, Math.round(sentences / 10))));
}

/** A note without its earlier `[!summary]` callouts, so a new summary is made from the text and not from an old summary. */
export function withoutSummaries(note: string): string {
  return note.replace(/^> \[!summary\][^\n]*(?:\n>[^\n]*)*\n?/gim, "").replace(/\n{3,}/g, "\n\n");
}
