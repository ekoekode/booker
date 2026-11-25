/** Text to token ids, with the model's own tokenizer.json read from disk. No network: the file ships with the model. */
import { Tokenizer } from "@huggingface/tokenizers";

export interface Encoded {
  ids: number[];
  mask: number[];
}

export class TextTokenizer {
  private tk: Tokenizer;
  constructor(tokenizerJson: object, tokenizerConfig: object, private maxTokens: number) {
    this.tk = new Tokenizer(tokenizerJson, tokenizerConfig);
  }

  /** Special tokens added, cut to the model's longest input. The closing token is kept when text is cut. */
  encode(text: string): Encoded {
    const e = this.tk.encode(text);
    let ids = e.ids;
    if (ids.length > this.maxTokens) {
      const last = ids[ids.length - 1];
      ids = [...ids.slice(0, this.maxTokens - 1), last];
    }
    return { ids, mask: ids.map(() => 1) };
  }
}

/** Order texts longest first in batches, so padding is small. Returns the batches as lists of original positions. */
export function batchesByLength(lengths: number[], size: number, maxPadded = 4096): number[][] {
  const order = lengths.map((_, i) => i).sort((a, b) => lengths[b] - lengths[a]);
  const out: number[][] = [];
  let cur: number[] = [];
  for (const i of order) {
    // the first in a batch is the longest, so it sets the padded length
    if (cur.length && (cur.length >= size || lengths[cur[0]] * (cur.length + 1) > maxPadded)) {
      out.push(cur);
      cur = [];
    }
    cur.push(i);
  }
  if (cur.length) out.push(cur);
  return out;
}
