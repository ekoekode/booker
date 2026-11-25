/**
 * A polite downloader. It talks to the network and the disk only through `IO`, so the rules (wait between requests to the same
 * site, follow robots.txt, resume, verify, clean up after a cancel) can be tested with a fake. Used by the app and the terminal script.
 */
import type { Resource, ResourceFile } from "./types";

export interface Reply {
  status: number;
  headers: Record<string, string>;
  body: AsyncIterable<Uint8Array>;
}

export interface Writer {
  write(chunk: Uint8Array): Promise<void>;
  close(): Promise<void>;
}

export interface Hasher {
  update(chunk: Uint8Array): void;
  digest(): string;
}

export interface IO {
  /** GET that follows redirects. */
  get(url: string, signal?: AbortSignal): Promise<Reply>;
  /** The size of a file, or null when there is none. */
  size(path: string): Promise<number | null>;
  mkdirp(path: string): Promise<void>;
  open(path: string): Promise<Writer>;
  rename(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
  writeText(path: string, text: string): Promise<void>;
  hasher(): Hasher;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
  now(): number;
}

export class Cancelled extends Error {
  constructor() {
    super("Cancelled");
  }
}

/** Minimum gap between two requests to one site. CCEL's robots.txt asks for 10 seconds. */
export const HOST_DELAY_MS: Record<string, number> = {
  "ccel.org": 10000,
  "www.ccel.org": 10000,
  "huggingface.co": 300,
  "www.tertullian.org": 1500,
  "sourcebooks.fordham.edu": 2000,
};
const DEFAULT_DELAY_MS = 1000;

export const hostOf = (url: string): string => new URL(url).host.toLowerCase();

export class Pacer {
  private last = new Map<string, number>();
  private extra = new Map<string, number>();

  constructor(private io: IO) {}

  /** A delay a site asked for itself (robots.txt Crawl-delay) wins over the table when it is longer. */
  setDelay(host: string, ms: number) {
    this.extra.set(host, ms);
  }

  delayFor(host: string): number {
    return Math.max(HOST_DELAY_MS[host] ?? DEFAULT_DELAY_MS, this.extra.get(host) ?? 0);
  }

  async wait(host: string, signal?: AbortSignal) {
    const gap = this.delayFor(host);
    const since = this.io.now() - (this.last.get(host) ?? -Infinity);
    if (since < gap) await this.io.sleep(gap - since, signal);
    this.last.set(host, this.io.now());
  }
}

export interface Robots {
  crawlDelayMs: number;
  disallow: string[];
}

/** The rules in a robots.txt that apply to us: the group for `booker`, else for `*`. */
export function parseRobots(text: string, agent = "booker"): Robots {
  const groups: { agents: string[]; delay: number; disallow: string[] }[] = [];
  let cur: { agents: string[]; delay: number; disallow: string[]; open: boolean } | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === "user-agent") {
      if (!cur || !cur.open) {
        cur = { agents: [], delay: 0, disallow: [], open: true };
        groups.push(cur);
      }
      cur.agents.push(val.toLowerCase());
    } else if (cur) {
      cur.open = false;
      if (key === "crawl-delay") cur.delay = Math.max(0, Number(val) || 0) * 1000;
      else if (key === "disallow" && val) cur.disallow.push(val);
    }
  }
  const own = groups.find((g) => g.agents.includes(agent.toLowerCase())) ?? groups.find((g) => g.agents.includes("*"));
  return { crawlDelayMs: own?.delay ?? 0, disallow: own?.disallow ?? [] };
}

export const allowedByRobots = (r: Robots, path: string): boolean => !r.disallow.some((d) => path.startsWith(d));

export interface Progress {
  /** bytes received for the file being fetched */
  bytes: number;
  file: string;
}

export interface DownloadOptions {
  signal?: AbortSignal;
  retries?: number;
  onBytes?: (n: number) => void;
}

const dirOf = (p: string) => p.slice(0, Math.max(0, p.lastIndexOf("/")));

/** Fetch one file to `dest`. Already there at the right size: skipped. Written as dest.part and renamed once verified. */
export async function downloadFile(io: IO, pacer: Pacer, file: ResourceFile, dest: string, opts: DownloadOptions = {}): Promise<"downloaded" | "skipped"> {
  const have = await io.size(dest);
  if (have !== null && (file.size === undefined || have === file.size)) {
    opts.onBytes?.(have);
    return "skipped";
  }
  await io.mkdirp(dirOf(dest));
  const part = `${dest}.part`;
  const retries = opts.retries ?? 3;
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (opts.signal?.aborted) throw new Cancelled();
    let writer: Writer | null = null;
    let counted = 0;
    try {
      await pacer.wait(hostOf(file.url), opts.signal);
      const reply = await io.get(file.url, opts.signal);
      if (reply.status !== 200) {
        const err = new Error(`${file.url} answered ${reply.status}`);
        if (reply.status >= 400 && reply.status < 500 && reply.status !== 429) throw Object.assign(err, { fatal: true });
        throw err;
      }
      writer = await io.open(part);
      const hash = file.sha256 ? io.hasher() : null;
      let received = 0;
      for await (const chunk of reply.body) {
        if (opts.signal?.aborted) throw new Cancelled();
        await writer.write(chunk);
        hash?.update(chunk);
        received += chunk.length;
        counted += chunk.length;
        opts.onBytes?.(chunk.length);
      }
      await writer.close();
      writer = null;
      if (file.size !== undefined && received !== file.size) throw new Error(`${file.to}: got ${received} bytes, expected ${file.size}`);
      if (hash && hash.digest() !== file.sha256) throw new Error(`${file.to}: the download is damaged (checksum differs)`);
      await io.rename(part, dest);
      return "downloaded";
    } catch (e) {
      if (writer) await writer.close().catch(() => undefined);
      await io.remove(part).catch(() => undefined);
      // bytes of a failed attempt are taken back so the progress bar does not overshoot on a retry
      if (counted) opts.onBytes?.(-counted);
      if (e instanceof Cancelled || opts.signal?.aborted) throw new Cancelled();
      if ((e as { fatal?: boolean }).fatal) throw e;
      lastError = e;
      if (attempt < retries) await io.sleep(2000 * 2 ** attempt, opts.signal);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export interface InstallHooks extends DownloadOptions {
  /** total bytes received so far across the resource, and the total expected */
  onProgress?: (done: number, total: number, file: string) => void;
}

/** Download every file of a resource into `dir` and write its model.json. */
export async function installResource(io: IO, pacer: Pacer, res: Resource, dir: string, hooks: InstallHooks = {}): Promise<void> {
  const total = res.files.reduce((n, f) => n + (f.size ?? 0), 0);
  let done = 0;
  for (const f of res.files) {
    await downloadFile(io, pacer, f, `${dir}/${f.to}`, {
      signal: hooks.signal,
      retries: hooks.retries,
      onBytes: (n) => {
        done += n;
        hooks.onProgress?.(done, total, f.to);
      },
    });
  }
  if (res.json) await io.writeText(`${dir}/model.json`, JSON.stringify(res.json, null, 2));
}

/** True when every file of the resource is on disk at its size and (for models) model.json is there. */
export async function isInstalled(io: IO, res: Resource, dir: string): Promise<boolean> {
  for (const f of res.files) {
    const s = await io.size(`${dir}/${f.to}`);
    if (s === null || (f.size !== undefined && s !== f.size)) return false;
  }
  return res.json ? (await io.size(`${dir}/model.json`)) !== null : true;
}

/** Fetch a small resource (a page, a catalogue, one book) into memory, paced and refusing anything bigger than `max` bytes. */
export async function fetchBytes(io: IO, pacer: Pacer, url: string, opts: { signal?: AbortSignal; max?: number; retries?: number } = {}): Promise<Uint8Array> {
  const max = opts.max ?? 80 * 1024 * 1024;
  const retries = opts.retries ?? 2;
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (opts.signal?.aborted) throw new Cancelled();
    try {
      await pacer.wait(hostOf(url), opts.signal);
      const reply = await io.get(url, opts.signal);
      if (reply.status !== 200) {
        const err = new Error(`${url} answered ${reply.status}`);
        if (reply.status >= 400 && reply.status < 500 && reply.status !== 429) throw Object.assign(err, { fatal: true });
        throw err;
      }
      const chunks: Uint8Array[] = [];
      let n = 0;
      for await (const c of reply.body) {
        if (opts.signal?.aborted) throw new Cancelled();
        n += c.length;
        if (n > max) throw Object.assign(new Error(`${url} is larger than ${Math.round(max / 1048576)} MB`), { fatal: true });
        chunks.push(c);
      }
      const out = new Uint8Array(n);
      let at = 0;
      for (const c of chunks) {
        out.set(c, at);
        at += c.length;
      }
      return out;
    } catch (e) {
      if (e instanceof Cancelled || opts.signal?.aborted) throw new Cancelled();
      if ((e as { fatal?: boolean }).fatal) throw e;
      lastError = e;
      if (attempt < retries) await io.sleep(2000 * 2 ** attempt, opts.signal);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/** Read a site's robots.txt, tell the pacer about its Crawl-delay, and return the rules. A missing file means no rules. */
export async function loadRobots(io: IO, pacer: Pacer, origin: string, signal?: AbortSignal): Promise<Robots> {
  try {
    const text = new TextDecoder().decode(await fetchBytes(io, pacer, `${origin}/robots.txt`, { signal, max: 1024 * 1024, retries: 0 }));
    const r = parseRobots(text);
    if (r.crawlDelayMs) pacer.setDelay(new URL(origin).host.toLowerCase(), r.crawlDelayMs);
    return r;
  } catch (e) {
    if (e instanceof Cancelled) throw e;
    return { crawlDelayMs: 0, disallow: [] };
  }
}
