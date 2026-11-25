/** Vectors kept small and compared fast. Pure. */

/** Unit vectors scaled into one byte per number. Cosine against them is within about 1% of the full thing. */
export function quantize(v: Float32Array): Int8Array {
  const q = new Int8Array(v.length);
  for (let i = 0; i < v.length; i++) q[i] = Math.max(-127, Math.min(127, Math.round(v[i] * 127)));
  return q;
}

export function dot(a: Float32Array, q: Int8Array, offset = 0): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * q[offset + i];
  return s / 127;
}

/** Many vectors in one block. */
export class VectorBlock {
  constructor(readonly dim: number, private data: Int8Array = new Int8Array(0)) {}

  get count(): number {
    return this.dim ? this.data.length / this.dim : 0;
  }

  static from(dim: number, vectors: Float32Array[]): VectorBlock {
    const d = new Int8Array(dim * vectors.length);
    vectors.forEach((v, i) => d.set(quantize(v), i * dim));
    return new VectorBlock(dim, d);
  }

  append(other: VectorBlock): VectorBlock {
    const d = new Int8Array(this.data.length + other.data.length);
    d.set(this.data);
    d.set(other.data, this.data.length);
    return new VectorBlock(this.dim, d);
  }

  /** The `k` closest to `query`, best first. */
  nearest(query: Float32Array, k: number): Array<{ index: number; score: number }> {
    const top: Array<{ index: number; score: number }> = [];
    for (let i = 0; i < this.count; i++) {
      const score = dot(query, this.data, i * this.dim);
      if (top.length < k || score > top[top.length - 1].score) {
        let at = top.length;
        while (at > 0 && top[at - 1].score < score) at--;
        top.splice(at, 0, { index: i, score });
        if (top.length > k) top.pop();
      }
    }
    return top;
  }

  bytes(): Int8Array {
    return this.data;
  }
}
