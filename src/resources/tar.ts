/** Reading a .tar.gz from disk one file at a time, without holding the archive in memory. Node only (desktop app and the terminal script). */
import { createReadStream } from "fs";
import { createGunzip } from "zlib";

export interface TarFile {
  /** the path inside the archive, without its top folder */
  name: string;
  data: Buffer;
}

const text = (b: Buffer, from: number, len: number) => {
  const s = b.subarray(from, from + len);
  const z = s.indexOf(0);
  return s.subarray(0, z < 0 ? s.length : z).toString("utf8");
};

/** Parse "<len> key=value\n" records of a pax extended header. */
function pax(data: Buffer): Record<string, string> {
  const out: Record<string, string> = {};
  let at = 0;
  while (at < data.length) {
    const sp = data.indexOf(32, at);
    if (sp < 0) break;
    const len = Number(data.subarray(at, sp).toString());
    if (!len) break;
    const rec = data.subarray(sp + 1, at + len - 1).toString("utf8");
    const eq = rec.indexOf("=");
    if (eq > 0) out[rec.slice(0, eq)] = rec.slice(eq + 1);
    at += len;
  }
  return out;
}

/** Each regular file of the archive for which `keep(name)` is true, in archive order. Others are skipped as they stream past. */
export async function* readTarGz(path: string, keep: (name: string) => boolean = () => true, signal?: AbortSignal): AsyncGenerator<TarFile> {
  const stream = createReadStream(path).pipe(createGunzip());
  let buf: Buffer = Buffer.alloc(0);
  let cur: { name: string; remaining: number; pad: number; type: string; keep: boolean; chunks: Buffer[] } | null = null;
  let nextName: string | null = null;
  const strip = (n: string) => n.slice(n.indexOf("/") + 1);
  try {
    for await (const chunk of stream) {
      if (signal?.aborted) throw new Error("Cancelled");
      buf = buf.length ? Buffer.concat([buf, chunk as Buffer]) : (chunk as Buffer);
      for (;;) {
        if (!cur) {
          if (buf.length < 512) break;
          const h = buf.subarray(0, 512);
          buf = buf.subarray(512);
          if (h.every((x) => x === 0)) continue;
          const type = String.fromCharCode(h[156] || 48);
          const size = parseInt(text(h, 124, 12).trim() || "0", 8) || 0;
          const prefix = text(h, 345, 155);
          let name: string = nextName ?? (prefix ? `${prefix}/` : "") + text(h, 0, 100);
          const meta = type === "x" || type === "g" || type === "L";
          if (!meta) nextName = null;
          const isFile = type === "0" || type === "7";
          if (isFile) name = strip(name);
          cur = { name, remaining: size, pad: (512 - (size % 512)) % 512, type, keep: meta || (isFile && keep(name)), chunks: [] };
        }
        if (cur.remaining > 0) {
          if (!buf.length) break;
          const take = Math.min(buf.length, cur.remaining);
          if (cur.keep) cur.chunks.push(buf.subarray(0, take));
          buf = buf.subarray(take);
          cur.remaining -= take;
          if (cur.remaining > 0) break;
        }
        if (cur.pad > 0) {
          if (buf.length < cur.pad) break;
          buf = buf.subarray(cur.pad);
          cur.pad = 0;
        }
        const done: NonNullable<typeof cur> = cur;
        cur = null;
        if (done.type === "x" && done.keep) {
          const p = pax(Buffer.concat(done.chunks));
          if (p.path) nextName = p.path;
        } else if (done.type === "L") nextName = Buffer.concat(done.chunks).toString("utf8").replace(/\0+$/, "");
        else if (done.keep && (done.type === "0" || done.type === "7")) yield { name: done.name, data: Buffer.concat(done.chunks) };
      }
    }
  } finally {
    stream.destroy();
  }
}
