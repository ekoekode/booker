/** Turning a model's output into one unit vector per text. Pure. */
import type { Pooling } from "./types";

/** `hidden` is [batch, length, dim] flattened; `mask` is [batch, length] of 0/1. */
export function pool(hidden: Float32Array, mask: BigInt64Array | Int32Array | number[], batch: number, length: number, dim: number, how: Pooling): Float32Array[] {
  const out: Float32Array[] = [];
  for (let b = 0; b < batch; b++) {
    const v = new Float32Array(dim);
    if (how === "cls") {
      v.set(hidden.subarray(b * length * dim, b * length * dim + dim));
    } else {
      let n = 0;
      for (let t = 0; t < length; t++) {
        if (Number(mask[b * length + t]) === 0) continue;
        n++;
        const at = (b * length + t) * dim;
        for (let d = 0; d < dim; d++) v[d] += hidden[at + d];
      }
      if (n) for (let d = 0; d < dim; d++) v[d] /= n;
    }
    out.push(normalize(v));
  }
  return out;
}

export function normalize(v: Float32Array): Float32Array {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  const n = Math.sqrt(s) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= n;
  return v;
}
