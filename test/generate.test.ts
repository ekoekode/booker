import { describe, expect, it } from "vitest";
import { pickToken } from "../src/generate/sample";
import { chatPrompt, combinePrompt, pieceSummaryPrompt, tidy } from "../src/generate/prompt";
import { chunkText, describeDuration, estimateSeconds, planCalls } from "../src/generate/chunk";
import { Cancelled, summarizeLong } from "../src/generate/mapreduce";

describe("choosing a token", () => {
  it("takes the highest and lowers one used just now", () => {
    expect(pickToken([0.1, 0.9, 0.5], [])).toBe(1);
    expect(pickToken([0.1, 0.9, 0.85], [1])).toBe(2);
    expect(pickToken([-1, -0.5, -0.52], [1])).toBe(2); // a negative score is pushed down by multiplying
  });
});

describe("prompts", () => {
  it("uses the Qwen chat format", () => {
    expect(chatPrompt("S", "U")).toBe("<|im_start|>system\nS<|im_end|>\n<|im_start|>user\nU<|im_end|>\n<|im_start|>assistant\n");
    expect(pieceSummaryPrompt("Text.", 2)).toContain("in 2 sentences");
    expect(pieceSummaryPrompt("Text.", 1)).toContain("in one sentence");
    expect(combinePrompt(["a", "b"], 3)).toContain("1. a\n\n2. b");
  });
  it("trims a label and a cut-off end", () => {
    expect(tidy("Summary: She left. He stayed.")).toBe("She left. He stayed.");
    expect(tidy("She left the town. He stayed and wat")).toBe("She left the town.");
    expect(tidy("  A short one.  ")).toBe("A short one.");
  });
});

describe("cutting a text into pieces", () => {
  const sent = (n: number) => `Sentence number ${n} has exactly eight words in it.`;
  const text = Array.from({ length: 100 }, (_, i) => sent(i)).join(" ");
  it("keeps whole sentences and stays near the size asked", () => {
    const parts = chunkText(text, 80);
    expect(parts.length).toBeGreaterThan(8);
    for (const p of parts) {
      expect(p.split(/\s+/).length).toBeLessThanOrEqual(88);
      expect(p.endsWith(".")).toBe(true);
    }
    expect(parts.join(" ")).toBe(text);
  });
  it("gives one piece for a short text and none for an empty one", () => {
    expect(chunkText("A short text that says very little at all.")).toHaveLength(1);
    expect(chunkText("")).toEqual([]);
  });
});

describe("the size of a job", () => {
  it("counts the calls: a piece each, then rounds of joining", () => {
    expect(planCalls(0)).toEqual({ piece: 0, combine: 0 });
    expect(planCalls(1)).toEqual({ piece: 1, combine: 0 });
    expect(planCalls(8)).toEqual({ piece: 8, combine: 1 });
    expect(planCalls(9)).toEqual({ piece: 9, combine: 3 }); // two groups, then their join
    expect(planCalls(64)).toEqual({ piece: 64, combine: 8 + 1 });
  });
  it("estimates seconds from the speed", () => {
    const rate = { promptTokensPerSec: 200, outputTokensPerSec: 20 };
    const piece = Array.from({ length: 450 }, () => "word").join(" ");
    const one = estimateSeconds([piece], rate);
    expect(one).toBeGreaterThan(4);
    expect(one).toBeLessThan(10);
    expect(estimateSeconds(Array(20).fill(piece), rate)).toBeGreaterThan(one * 18);
  });
  it("says it in plain words", () => {
    expect(describeDuration(12)).toBe("about 10 seconds");
    expect(describeDuration(200)).toBe("about 3 minutes");
    expect(describeDuration(4800)).toBe("about 1 hour 20 minutes");
  });
});

describe("summarising piece by piece", () => {
  const text = Array.from({ length: 90 }, (_, i) => `Sentence number ${i} has exactly eight words in it.`).join(" ");
  const fake = () => {
    const calls: string[] = [];
    return { calls, write: async (p: string) => (calls.push(p), `Summary ${calls.length}.`) };
  };
  it("summarises each piece and joins the results", async () => {
    const f = fake();
    const progress: string[] = [];
    const out = await summarizeLong(text, { sentences: 3, write: f.write, chunkWords: 120, onProgress: (p) => progress.push(`${p.done}/${p.total}`) });
    expect(out).toMatch(/^Summary \d+\.$/);
    expect(f.calls.length).toBeGreaterThan(3);
    expect(f.calls.at(-1)).toContain("Combine them");
    expect(progress.at(-1)).toBe(`${f.calls.length}/${f.calls.length}`);
  });
  it("makes one call for a short text", async () => {
    const f = fake();
    await summarizeLong("This short text says almost nothing but it does say it.", { sentences: 2, write: f.write });
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]).toContain("in 2 sentences");
  });
  it("stops when cancelled, without more calls", async () => {
    const f = fake();
    let stop = false;
    const run = summarizeLong(text, { sentences: 3, write: async (p, n) => ((stop = true), f.write(p)), chunkWords: 120, cancelled: () => stop });
    await expect(run).rejects.toBeInstanceOf(Cancelled);
    expect(f.calls).toHaveLength(1);
  });
  it("returns nothing for an empty text", async () => {
    expect(await summarizeLong("", { sentences: 3, write: async () => "x" })).toBe("");
  });
});

import { parseGenInfo } from "../src/generate/registry";
describe("reading a writing model's folder", () => {
  const model = { id: "qwen2.5-0.5b-instruct", label: "Qwen", file: "model_q4.onnx", license: "Apache-2.0", promptTokensPerSec: 200, outputTokensPerSec: 18 };
  const config = { num_hidden_layers: 24, num_attention_heads: 14, num_key_value_heads: 2, hidden_size: 896 };
  it("joins the notes with the model's own numbers", () => {
    expect(parseGenInfo(model, config, { eos_token_id: [151645, 151643] })).toMatchObject({ layers: 24, kvHeads: 2, headDim: 64, eos: [151645, 151643], chunkWords: 450, promptTokensPerSec: 200 });
  });
  it("falls back to the config's end token and to all heads for the cache", () => {
    const i = parseGenInfo(model, { ...config, num_key_value_heads: undefined, eos_token_id: 7 })!;
    expect(i.eos).toEqual([7]);
    expect(i.kvHeads).toBe(14);
  });
  it("refuses folders that cannot be run", () => {
    expect(parseGenInfo(null, config)).toBeNull();
    expect(parseGenInfo({ ...model, id: "a/b" }, config, { eos_token_id: 1 })).toBeNull();
    expect(parseGenInfo({ ...model, file: "../x" }, config, { eos_token_id: 1 })).toBeNull();
    expect(parseGenInfo(model, { hidden_size: 8 }, { eos_token_id: 1 })).toBeNull();
    expect(parseGenInfo(model, config, {})).toBeNull();
  });
});

import { clampSentences } from "../src/generate/prompt";
describe("clampSentences", () => {
  it("keeps the first n sentences", () => {
    expect(clampSentences("One. Two! Three? Four.", 2)).toBe("One. Two!");
    expect(clampSentences("Only one", 3)).toBe("Only one");
    expect(clampSentences('She said "Go." Then left. Done.', 2)).toBe('She said "Go." Then left.');
  });
});

import { withoutSummaries } from "../src/semantic/summary";
describe("withoutSummaries", () => {
  it("drops summary callouts and keeps the text", () => {
    const note = '> [!summary] Summary\n> - "One."\n> - Two.\n\nThe real text.\n\n> [!quote] Keep\n> this';
    expect(withoutSummaries(note)).toBe("\nThe real text.\n\n> [!quote] Keep\n> this");
  });
});

import { namesHint, pieceSummaryPrompt } from "../src/generate/prompt";
describe("namesHint", () => {
  it("names the people and places once each", () => {
    const h = namesHint(["Mara Voss", "Kest", "Mara Voss", "", "Harbor of Sel"]);
    expect(h).toContain("Mara Voss, Kest and Harbor of Sel");
    expect(h.match(/Mara Voss/g)).toHaveLength(1);
    expect(namesHint([])).toBe("");
  });
  it("puts the hint in the prompt", () => {
    expect(pieceSummaryPrompt("Text.", 3, namesHint(["Mara"]))).toContain("Mara");
  });
});
