/** Running one batch through an ONNX session, whichever runtime made it. */
import { pool } from "./pool";
import { batchesByLength, type Encoded } from "./tokenize";
import type { ModelInfo } from "./types";

/** The little of onnxruntime this code uses. */
export interface OrtLike {
  Tensor: new (type: "int64", data: BigInt64Array, dims: number[]) => unknown;
}
export interface SessionLike {
  inputNames: readonly string[];
  outputNames: readonly string[];
  run(feeds: Record<string, unknown>): Promise<Record<string, { data: Float32Array | ArrayLike<number>; dims: readonly number[] }>>;
}

const BATCH = 16;

/** Embed already-tokenized texts. Vectors come back in the order of `encoded`. */
export async function runEncoded(ort: OrtLike, session: SessionLike, info: ModelInfo, encoded: Encoded[], progress?: (done: number, total: number) => void): Promise<Float32Array[]> {
  const out = new Array<Float32Array>(encoded.length);
  let done = 0;
  for (const batch of batchesByLength(encoded.map((e) => e.ids.length), BATCH)) {
    const L = encoded[batch[0]].ids.length;
    const B = batch.length;
    const ids = new BigInt64Array(B * L);
    const mask = new BigInt64Array(B * L);
    batch.forEach((pos, row) => {
      const e = encoded[pos];
      for (let t = 0; t < e.ids.length; t++) {
        ids[row * L + t] = BigInt(e.ids[t]);
        mask[row * L + t] = 1n;
      }
    });
    const feeds: Record<string, unknown> = { input_ids: new ort.Tensor("int64", ids, [B, L]), attention_mask: new ort.Tensor("int64", mask, [B, L]) };
    if (session.inputNames.includes("token_type_ids")) feeds.token_type_ids = new ort.Tensor("int64", new BigInt64Array(B * L), [B, L]);
    const res = await session.run(feeds);
    const hidden = res[session.outputNames[0]] ?? Object.values(res)[0];
    const vecs = pool(hidden.data as Float32Array, mask, B, L, info.dim, info.pooling);
    batch.forEach((pos, row) => (out[pos] = vecs[row]));
    done += B;
    progress?.(done, encoded.length);
    await new Promise((r) => setTimeout(r, 0)); // let the window breathe between batches
  }
  return out;
}
