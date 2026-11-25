/** The file of vectors kept beside a library or document so it travels with it. Pure.
 *  Layout: 4 bytes (little endian) header length, the JSON header, then count × dim signed bytes. */
import type { Chunk } from "../sources/types";

export interface VecHeader {
  model: string;
  /** the model's version when these were made */
  version: number;
  dim: number;
  /** vectors held so far; fewer than `total` means the job was stopped and can go on */
  count: number;
  /** pieces the source has */
  total: number;
  /** identifies the pieces, so changed text is noticed */
  fingerprint: string;
}

export function encodeVec(h: VecHeader, data: Int8Array): Uint8Array {
  const head = new TextEncoder().encode(JSON.stringify(h));
  const out = new Uint8Array(4 + head.length + data.length);
  new DataView(out.buffer).setUint32(0, head.length, true);
  out.set(head, 4);
  out.set(new Uint8Array(data.buffer, data.byteOffset, data.length), 4 + head.length);
  return out;
}

/** Null for anything that is not a good vector file. */
export function decodeVec(bytes: Uint8Array): { header: VecHeader; data: Int8Array } | null {
  try {
    if (bytes.length < 4) return null;
    const n = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true);
    if (n <= 0 || 4 + n > bytes.length) return null;
    const h = JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + n))) as VecHeader;
    if (!h || typeof h.model !== "string" || !(h.dim > 0) || !(h.count >= 0) || !(h.total >= h.count) || typeof h.fingerprint !== "string") return null;
    const body = bytes.subarray(4 + n);
    if (body.length !== h.count * h.dim) return null;
    return { header: h, data: new Int8Array(body.buffer.slice(body.byteOffset, body.byteOffset + body.length)) };
  } catch {
    return null;
  }
}

/** A short code for a list of pieces: how many, and a hash of their text. */
export function fingerprint(chunks: Chunk[]): string {
  let h = 2166136261;
  for (const c of chunks) {
    const t = c.text;
    h = Math.imul(h ^ t.length, 16777619);
    for (let i = 0; i < t.length; i += Math.max(1, t.length >> 4)) h = Math.imul(h ^ t.charCodeAt(i), 16777619);
  }
  return `${chunks.length}:${(h >>> 0).toString(36)}`;
}

/** What to do with a saved file for the pieces and model now: use it, carry on from it, or start again. */
export function reuse(h: VecHeader | null, model: { id: string; version: number; dim: number }, fp: string, total: number): "use" | "continue" | "restart" {
  if (!h || h.model !== model.id || h.version !== model.version || h.dim !== model.dim || h.fingerprint !== fp || h.total !== total) return "restart";
  return h.count === total ? "use" : "continue";
}
