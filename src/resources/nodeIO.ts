/** The real network and disk for the downloader, on desktop (Node inside Obsidian, or Node itself in the terminal script). The only place that talks to the network. */
import { createHash } from "crypto";
import { createWriteStream, promises as fs } from "fs";
import https from "https";
import type { IO, Reply } from "./fetcher";
import { Cancelled } from "./fetcher";

const USER_AGENT = "Booker/1.0 (Obsidian plugin; polite downloader; respects robots.txt)";
const MAX_REDIRECTS = 6;
const IDLE_MS = 60000;

function get(url: string, signal?: AbortSignal, hops = 0): Promise<Reply> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Cancelled());
    const u = new URL(url);
    if (u.protocol !== "https:") return reject(new Error(`Only https downloads are allowed (${url})`));
    const req = https.get(u, { headers: { "User-Agent": USER_AGENT, Accept: "*/*" } }, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        if (hops >= MAX_REDIRECTS) return reject(new Error("Too many redirects"));
        return get(new URL(res.headers.location, url).toString(), signal, hops + 1).then(resolve, reject);
      }
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(res.headers)) if (typeof v === "string") headers[k] = v;
      resolve({ status, headers, body: res as unknown as AsyncIterable<Uint8Array> });
    });
    req.setTimeout(IDLE_MS, () => req.destroy(new Error("The connection timed out")));
    req.on("error", reject);
    signal?.addEventListener("abort", () => req.destroy(new Cancelled()), { once: true });
  });
}

export function nodeIO(): IO {
  return {
    get,
    size: async (p) => {
      try {
        const s = await fs.stat(p);
        return s.isFile() ? s.size : null;
      } catch {
        return null;
      }
    },
    mkdirp: async (p) => void (await fs.mkdir(p, { recursive: true })),
    open: async (p) => {
      const out = createWriteStream(p);
      const failed = new Promise<never>((_, rej) => out.on("error", rej));
      failed.catch(() => undefined);
      return {
        write: (chunk) =>
          Promise.race([
            new Promise<void>((res) => (out.write(chunk) ? res() : out.once("drain", () => res()))),
            failed,
          ]),
        close: () => new Promise<void>((res, rej) => out.end((e?: Error | null) => (e ? rej(e) : res()))),
      };
    },
    rename: (a, b) => fs.rename(a, b),
    remove: async (p) => {
      await fs.rm(p, { recursive: true, force: true });
    },
    writeText: (p, text) => fs.writeFile(p, text, "utf8"),
    hasher: () => {
      const h = createHash("sha256");
      return { update: (c) => void h.update(c), digest: () => h.digest("hex") };
    },
    sleep: (ms, signal) =>
      new Promise<void>((res, rej) => {
        if (signal?.aborted) return rej(new Cancelled());
        const t = setTimeout(res, ms);
        signal?.addEventListener("abort", () => (clearTimeout(t), rej(new Cancelled())), { once: true });
      }),
    now: () => Date.now(),
  };
}
