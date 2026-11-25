import { describe, expect, it } from "vitest";
import { allowedByRobots, Cancelled, downloadFile, installResource, isInstalled, Pacer, parseRobots, type IO } from "../src/resources/fetcher";
import type { Resource } from "../src/resources/types";
import { createHash } from "node:crypto";

function fake(files: Record<string, { status?: number; body?: Uint8Array }> = {}) {
  const disk = new Map<string, Uint8Array>();
  const log: string[] = [];
  let clock = 0;
  const io: IO = {
    async get(url) {
      log.push(`get ${url} @${clock}`);
      const f = files[url] ?? { status: 404 };
      const body = f.body ?? new Uint8Array();
      return { status: f.status ?? 200, headers: {}, body: (async function* () { yield body.slice(0, Math.ceil(body.length / 2)); yield body.slice(Math.ceil(body.length / 2)); })() };
    },
    size: async (p) => (disk.has(p) ? disk.get(p)!.length : null),
    mkdirp: async () => undefined,
    open: async (p) => {
      const chunks: Uint8Array[] = [];
      return {
        write: async (c) => void chunks.push(c),
        close: async () => void disk.set(p, Uint8Array.from(chunks.flatMap((c) => [...c]))),
      };
    },
    rename: async (a, b) => void (disk.set(b, disk.get(a)!), disk.delete(a)),
    remove: async (p) => void disk.delete(p),
    writeText: async (p, t) => void disk.set(p, new TextEncoder().encode(t)),
    hasher: () => {
      const h = createHash("sha256");
      return { update: (c) => void h.update(c), digest: () => h.digest("hex") };
    },
    sleep: async (ms) => void (clock += ms),
    now: () => clock,
  };
  return { io, disk, log, tick: (ms: number) => (clock += ms) };
}

const bytes = (s: string) => new TextEncoder().encode(s);

describe("parseRobots", () => {
  it("reads the crawl delay and disallows of the * group", () => {
    const r = parseRobots("User-agent: Applebot\nCrawl-delay: 20\n\nUser-agent: *\nCrawl-delay: 10\nDisallow: /private\n");
    expect(r.crawlDelayMs).toBe(10000);
    expect(allowedByRobots(r, "/ccel/x")).toBe(true);
    expect(allowedByRobots(r, "/private/a")).toBe(false);
  });
  it("prefers a group that names us", () => {
    expect(parseRobots("User-agent: booker\nCrawl-delay: 3\nUser-agent: *\nCrawl-delay: 9").crawlDelayMs).toBe(3000);
  });
});

describe("Pacer", () => {
  it("waits the site's gap between requests but not for another site", async () => {
    const { io } = fake();
    const p = new Pacer(io);
    await p.wait("ccel.org");
    const t0 = io.now();
    await p.wait("ccel.org");
    expect(io.now() - t0).toBe(10000);
    const t1 = io.now();
    await p.wait("example.org");
    expect(io.now() - t1).toBe(0);
  });
  it("uses a longer delay the site asked for", () => {
    const p = new Pacer(fake().io);
    p.setDelay("a.org", 5000);
    expect(p.delayFor("a.org")).toBe(5000);
    p.setDelay("ccel.org", 2000);
    expect(p.delayFor("ccel.org")).toBe(10000);
  });
});

describe("downloadFile", () => {
  const url = "https://example.org/a.bin";
  const data = bytes("hello world");
  const sha = createHash("sha256").update(data).digest("hex");

  it("saves, verifies and renames", async () => {
    const f = fake({ [url]: { body: data } });
    expect(await downloadFile(f.io, new Pacer(f.io), { url, to: "a.bin", size: data.length, sha256: sha }, "/d/a.bin")).toBe("downloaded");
    expect(f.disk.get("/d/a.bin")).toEqual(data);
    expect(f.disk.has("/d/a.bin.part")).toBe(false);
  });
  it("skips a file already there at the right size", async () => {
    const f = fake({ [url]: { body: data } });
    f.disk.set("/d/a.bin", data);
    expect(await downloadFile(f.io, new Pacer(f.io), { url, to: "a.bin", size: data.length }, "/d/a.bin")).toBe("skipped");
    expect(f.log).toHaveLength(0);
  });
  it("rejects a damaged download and leaves nothing behind", async () => {
    const f = fake({ [url]: { body: bytes("hello WORLD") } });
    await expect(downloadFile(f.io, new Pacer(f.io), { url, to: "a.bin", size: data.length, sha256: sha }, "/d/a.bin", { retries: 0 })).rejects.toThrow(/damaged/);
    expect(f.disk.size).toBe(0);
  });
  it("retries a server error", async () => {
    const f = fake({ [url]: { body: data } });
    const real = f.io.get;
    let n = 0;
    f.io.get = async (u, s) => (++n === 1 ? { status: 503, headers: {}, body: (async function* () {})() } : real(u, s));
    expect(await downloadFile(f.io, new Pacer(f.io), { url, to: "a.bin", size: data.length }, "/d/a.bin")).toBe("downloaded");
    expect(n).toBe(2);
  });
  it("does not retry a missing file", async () => {
    const g = fake({ [url]: { status: 404 } });
    await expect(downloadFile(g.io, new Pacer(g.io), { url, to: "a.bin" }, "/d/a.bin")).rejects.toThrow(/404/);
    expect(g.log).toHaveLength(1);
  });
  it("cancels and removes the partial file", async () => {
    const f = fake({ [url]: { body: data } });
    const ctl = new AbortController();
    let seen = 0;
    await expect(downloadFile(f.io, new Pacer(f.io), { url, to: "a.bin" }, "/d/a.bin", { signal: ctl.signal, onBytes: () => (++seen === 1 ? ctl.abort() : undefined) })).rejects.toBeInstanceOf(Cancelled);
    expect(f.disk.size).toBe(0);
  });
});

describe("installResource", () => {
  const data = bytes("model bytes");
  const res: Resource = {
    id: "m",
    group: "g",
    title: "m",
    note: "",
    license: "MIT",
    kind: "model",
    files: [{ url: "https://example.org/m.onnx", to: "m.onnx", size: data.length }],
    json: { id: "m", file: "m.onnx" },
  };
  it("downloads every file, writes model.json, and reports progress", async () => {
    const f = fake({ "https://example.org/m.onnx": { body: data } });
    const seen: number[] = [];
    expect(await isInstalled(f.io, res, "/p/models/m")).toBe(false);
    await installResource(f.io, new Pacer(f.io), res, "/p/models/m", { onProgress: (d) => seen.push(d) });
    expect(seen.at(-1)).toBe(data.length);
    expect(await isInstalled(f.io, res, "/p/models/m")).toBe(true);
    expect(JSON.parse(new TextDecoder().decode(f.disk.get("/p/models/m/model.json")))).toMatchObject({ id: "m" });
  });
});
