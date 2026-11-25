import { FileSystemAdapter, type App } from "obsidian";
import { Tokenizer } from "@huggingface/tokenizers";
import { loadNativeOrt, nativeRuntimeDir } from "../semantic/native";
import { GEN_DIR } from "./registry";
import { pickToken } from "./sample";
import { Cancelled } from "./mapreduce";
import type { GenInfo } from "./types";

export interface Generator {
  info: GenInfo;
  /** Writes text after the prompt, up to `maxTokens`. Throws Cancelled when `cancelled()` turns true. */
  write(prompt: string, maxTokens: number, cancelled?: () => boolean): Promise<string>;
  dispose(): Promise<void>;
}

const MAX_PROMPT_TOKENS = 3000;

/** A small language model run with onnxruntime-node on this computer: feed the prompt, then one token at a time, carrying the model's memory (key/value cache) along. */
export async function createGenerator(app: App, pluginDir: string, info: GenInfo): Promise<Generator> {
  const a = app.vault.adapter;
  if (!(a instanceof FileSystemAdapter)) throw new Error("The writing model needs the desktop app.");
  const root = a.getBasePath();
  const ort = loadNativeOrt(`${root}/${nativeRuntimeDir(pluginDir)}`) as any;
  const dir = `${pluginDir}/${GEN_DIR}/${info.id}`;
  const tk = new Tokenizer(JSON.parse(await a.read(`${dir}/tokenizer.json`)), JSON.parse(await a.read(`${dir}/tokenizer_config.json`)));
  const session = await ort.InferenceSession.create(`${root}/${dir}/${info.file}`, { executionProviders: ["cpu"], graphOptimizationLevel: "all" });
  const eos = new Set(info.eos);
  const i64 = (xs: number[], dims: number[]) => new ort.Tensor("int64", BigInt64Array.from(xs.map(BigInt)), dims);

  return {
    info,
    async write(prompt, maxTokens, cancelled) {
      let ids = tk.encode(prompt).ids;
      if (ids.length > MAX_PROMPT_TOKENS) ids = ids.slice(-MAX_PROMPT_TOKENS);
      const past: Record<string, unknown> = {};
      for (let l = 0; l < info.layers; l++) for (const k of ["key", "value"]) past[`past_key_values.${l}.${k}`] = new ort.Tensor("float32", new Float32Array(0), [1, info.kvHeads, 0, info.headDim]);
      let total = 0;
      const out: number[] = [];
      const step = async (tokens: number[], first: number) => {
        const n = tokens.length;
        total += n;
        const r = await session.run({ input_ids: i64(tokens, [1, n]), attention_mask: i64(new Array(total).fill(1), [1, total]), position_ids: i64(tokens.map((_, i) => first + i), [1, n]), ...past });
        for (let l = 0; l < info.layers; l++) for (const k of ["key", "value"]) past[`past_key_values.${l}.${k}`] = r[`present.${l}.${k}`];
        const logits = r.logits;
        const v = logits.dims[2] as number;
        return pickToken((logits.data as Float32Array).subarray((n - 1) * v, n * v), out.slice(-64));
      };
      if (cancelled?.()) throw new Cancelled();
      let next = await step(ids, 0);
      while (out.length < maxTokens && !eos.has(next)) {
        if (cancelled?.()) throw new Cancelled();
        out.push(next);
        next = await step([next], ids.length + out.length - 1);
      }
      return tk.decode(out);
    },
    dispose: async () => void (await session.release?.()),
  };
}
