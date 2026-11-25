import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { normalize, pool } from "../src/semantic/pool";
import { batchesByLength, TextTokenizer } from "../src/semantic/tokenize";
import { dot, quantize, VectorBlock } from "../src/semantic/vectors";
import { runEncoded, type OrtLike, type SessionLike } from "../src/semantic/session";
import type { ModelInfo } from "../src/semantic/types";

describe("pooling", () => {
  it("averages the real tokens and ignores padding, then makes a unit vector", () => {
    // one text, 3 positions, dim 2; the last position is padding
    const hidden = new Float32Array([1, 0, 3, 0, 99, 99]);
    const [v] = pool(hidden, [1, 1, 0], 1, 3, 2, "mean");
    expect(Array.from(v)).toEqual([1, 0]);
  });
  it("takes the first token for cls pooling", () => {
    const [v] = pool(new Float32Array([0, 2, 5, 5]), [1, 1], 1, 2, 2, "cls");
    expect(Array.from(v)).toEqual([0, 1]);
  });
  it("leaves a zero vector alone", () => {
    expect(Array.from(normalize(new Float32Array(3)))).toEqual([0, 0, 0]);
  });
});

describe("tokenizing", () => {
  const tk = new TextTokenizer(JSON.parse(readFileSync("test/fixtures/semantic/tokenizer.json", "utf8")), JSON.parse(readFileSync("test/fixtures/semantic/tokenizer_config.json", "utf8")), 16);
  it("adds the start and end tokens and lowercases", () => {
    const e = tk.encode("Grace");
    expect(e.ids[0]).toBe(101);
    expect(e.ids[e.ids.length - 1]).toBe(102);
    expect(tk.encode("GRACE").ids).toEqual(e.ids);
    expect(e.mask.every((m) => m === 1)).toBe(true);
  });
  it("cuts long text but keeps the end token", () => {
    const e = tk.encode("word ".repeat(100));
    expect(e.ids.length).toBe(16);
    expect(e.ids[15]).toBe(102);
  });
});

describe("batching", () => {
  it("groups by length, longest first, without losing anyone", () => {
    const b = batchesByLength([5, 50, 7, 49, 6], 2);
    expect(b).toEqual([[1, 3], [2, 4], [0]]);
    expect(b.flat().sort()).toEqual([0, 1, 2, 3, 4]);
  });
  it("limits the padded size of a batch", () => {
    expect(batchesByLength([100, 100, 100], 16, 250)).toEqual([[0, 1], [2]]);
  });
});

describe("vectors", () => {
  const unit = (...x: number[]) => normalize(new Float32Array(x));
  it("quantizing keeps the cosine close", () => {
    const a = unit(1, 2, 3, 4);
    const b = unit(4, 3, 2, 1);
    const exact = a.reduce((s, x, i) => s + x * b[i], 0);
    expect(Math.abs(dot(a, quantize(b)) - exact)).toBeLessThan(0.02);
  });
  it("finds the nearest, best first, and appends blocks", () => {
    const block = VectorBlock.from(3, [unit(1, 0, 0), unit(0, 1, 0), unit(1, 1, 0)]);
    const more = VectorBlock.from(3, [unit(0, 0, 1)]);
    const all = block.append(more);
    expect(all.count).toBe(4);
    expect(all.nearest(unit(1, 0.1, 0), 2).map((h) => h.index)).toEqual([0, 2]);
    expect(all.nearest(unit(0, 0, 1), 1)[0].index).toBe(3);
  });
});

describe("running a session", () => {
  const info: ModelInfo = { id: "t", label: "t", dim: 2, pooling: "mean", maxTokens: 8, queryPrefix: "", file: "m.onnx", license: "x", version: 1 };
  class Tensor {
    constructor(public type: string, public data: BigInt64Array, public dims: number[]) {}
  }
  it("pads each batch, returns vectors in the order given and reports progress", async () => {
    const seen: number[][] = [];
    const session: SessionLike = {
      inputNames: ["input_ids", "attention_mask", "token_type_ids"],
      outputNames: ["last_hidden_state"],
      async run(feeds: any) {
        const [B, L] = feeds.input_ids.dims;
        seen.push([B, L]);
        const data = new Float32Array(B * L * 2);
        // every token of text row r gets the vector [first id, 0]
        for (let r = 0; r < B; r++) for (let t = 0; t < L; t++) data[(r * L + t) * 2] = Number(feeds.input_ids.data[r * L]) || 1;
        return { last_hidden_state: { data, dims: [B, L, 2] } };
      },
    };
    const enc = [{ ids: [5, 6], mask: [1, 1] }, { ids: [7, 8, 9, 10], mask: [1, 1, 1, 1] }, { ids: [3], mask: [1] }];
    const steps: number[] = [];
    const v = await runEncoded({ Tensor } as unknown as OrtLike, session, info, enc, (d) => steps.push(d));
    expect(v).toHaveLength(3);
    expect(v.every((x) => Math.abs(Math.hypot(x[0], x[1]) - 1) < 1e-6)).toBe(true);
    expect(seen[0]).toEqual([3, 4]);
    expect(steps.at(-1)).toBe(3);
  });
});

import { decodeVec, encodeVec, fingerprint, reuse, type VecHeader } from "../src/semantic/vecfile";
import { fuse } from "../src/semantic/hybrid";

describe("vector file", () => {
  const h: VecHeader = { model: "m", version: 1, dim: 2, count: 2, total: 3, fingerprint: "3:abc" };
  it("round trips", () => {
    const back = decodeVec(encodeVec(h, new Int8Array([1, -2, 3, -4])))!;
    expect(back.header).toEqual(h);
    expect(Array.from(back.data)).toEqual([1, -2, 3, -4]);
  });
  it("refuses damaged files", () => {
    expect(decodeVec(new Uint8Array([1, 2]))).toBeNull();
    expect(decodeVec(encodeVec(h, new Int8Array([1, 2, 3])))).toBeNull(); // wrong size for the header
    expect(decodeVec(new Uint8Array([9, 0, 0, 0, 1]))).toBeNull();
  });
  it("notices changed text", () => {
    const a = [{ loc: "1", text: "grace and peace" }];
    expect(fingerprint(a)).toBe(fingerprint([{ loc: "x", text: "grace and peace" }]));
    expect(fingerprint(a)).not.toBe(fingerprint([{ loc: "1", text: "grace and peaces" }]));
  });
  it("decides between using, continuing and starting again", () => {
    const model = { id: "m", version: 1, dim: 2 };
    expect(reuse(null, model, "3:abc", 3)).toBe("restart");
    expect(reuse(h, model, "3:abc", 3)).toBe("continue");
    expect(reuse({ ...h, count: 3 }, model, "3:abc", 3)).toBe("use");
    expect(reuse(h, { ...model, version: 2 }, "3:abc", 3)).toBe("restart");
    expect(reuse(h, model, "3:zzz", 3)).toBe("restart");
  });
});

describe("hybrid ranking", () => {
  it("ranks what both lists like first, and keeps what only one finds", () => {
    const r = fuse([{ items: ["a", "b", "c"] }, { items: ["c", "d", "a"] }], (x) => x).map((x) => x.item);
    expect(r.slice(0, 2).sort()).toEqual(["a", "c"]);
    expect(r).toContain("d");
    expect(r).toHaveLength(4);
  });
  it("lets a weight tip the order", () => {
    const r = fuse([{ items: ["a"], weight: 1 }, { items: ["b"], weight: 3 }], (x) => x).map((x) => x.item);
    expect(r[0]).toBe("b");
  });
});

import { planFiles } from "../src/semantic/writingPlan";
describe("which notes to read again", () => {
  const f = (path: string, mtime: number, size = 10) => ({ path, mtime, size });
  it("keeps unchanged notes, reads new and changed ones, and drops the gone", () => {
    const p = planFiles([f("a", 1), f("b", 1), f("c", 1)], [f("a", 1), f("b", 2), f("d", 1)]);
    expect(p).toEqual({ keep: ["a"], changed: ["b", "d"], removed: ["c"] });
  });
  it("treats a different size as a change", () => {
    expect(planFiles([f("a", 1, 5)], [f("a", 1, 6)]).changed).toEqual(["a"]);
  });
});

import { defaultLength, pickSentences, splitSentences } from "../src/semantic/summary";
describe("splitting sentences", () => {
  it("splits on full stops, keeps abbreviations and drops Markdown", () => {
    const s = splitSentences("---\ntitle: x\n---\n# Heading\n\nDr. Smith arrived late in the evening. **He sat down** and read [[Mara Voss|Mara]] a letter! Was it true? Nobody knew for certain.");
    expect(s).toEqual(["Dr. Smith arrived late in the evening.", "He sat down and read Mara a letter!", "Was it true? Nobody knew for certain."]);
  });
  it("joins a very short sentence to the next", () => {
    expect(splitSentences("No. The council met in the hall and argued until dawn.")).toEqual(["No. The council met in the hall and argued until dawn."]);
  });
  it("keeps spoken words together until the quotation closes", () => {
    expect(splitSentences('The old guard looked up slowly. "Come. Follow me quietly now," he said to her.')).toEqual(['The old guard looked up slowly.', '"Come. Follow me quietly now," he said to her.']);
  });
  it("does not split inside a scripture reference", () => {
    expect(splitSentences("Later that night he read John 3:16 aloud. And then he prayed for the whole village.")).toEqual(["Later that night he read John 3:16 aloud.", "And then he prayed for the whole village."]);
  });
});

describe("choosing sentences", () => {
  const unit = (...x: number[]) => {
    const v = new Float32Array(x);
    const n = Math.hypot(...x) || 1;
    return v.map((a) => a / n);
  };
  it("keeps all when asked for as many as there are, and none for zero", () => {
    expect(pickSentences([unit(1, 0), unit(0, 1)], 5)).toEqual([0, 1]);
    expect(pickSentences([unit(1, 0)], 0)).toEqual([]);
  });
  it("prefers the central sentences and avoids repeating one idea", () => {
    // three near-identical sentences about one thing, one about another, one stray
    const v = [unit(1, 0.05, 0), unit(1, 0.1, 0), unit(1, 0.08, 0), unit(0.1, 1, 0), unit(0.05, 1, 0), unit(0, 0, 1)];
    const picked = pickSentences(v, 2);
    expect(picked.filter((i) => i <= 2)).toHaveLength(1);
    expect(picked.filter((i) => i === 3 || i === 4)).toHaveLength(1);
    expect(picked).not.toContain(5);
  });
  it("returns reading order", () => {
    const v = [unit(0, 1), unit(1, 0), unit(1, 0.1), unit(0.1, 1)];
    const p = pickSentences(v, 3);
    expect([...p].sort((a, b) => a - b)).toEqual(p);
  });
  it("sizes a summary at about a tenth", () => {
    expect([defaultLength(2), defaultLength(20), defaultLength(100), defaultLength(500)]).toEqual([2, 3, 10, 12]);
  });
});
