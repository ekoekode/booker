/** Driving a catalogue source: list its items and build libraries from them, paced and within robots.txt. Shared by the app and the terminal script. */
import { allowedByRobots, Cancelled, fetchBytes, loadRobots, type IO, type Pacer, type Robots } from "./fetcher";
import { decodeHtml } from "./html";
import type { CatalogueSource, CatItem, SourceCtx } from "./catalogueSources";
import { buildNlib } from "../sources/nlibWrite";

export interface Run {
  io: IO;
  pacer: Pacer;
  signal?: AbortSignal;
  say?: (detail: string) => void;
}

/** What `source` may fetch: pages on its own site that its robots.txt allows. */
export async function sourceCtx(source: CatalogueSource, run: Run): Promise<SourceCtx> {
  const robots: Robots = await loadRobots(run.io, run.pacer, source.origin, run.signal);
  return {
    say: (d) => run.say?.(d),
    async text(url) {
      const u = new URL(url);
      if (u.origin !== source.origin && u.host !== new URL(source.origin).host) throw new Error(`${u.host} is not part of ${source.title}`);
      if (!allowedByRobots(robots, u.pathname)) throw new Error(`${u.pathname} is not allowed by robots.txt`);
      return decodeHtml(await fetchBytes(run.io, run.pacer, url, { signal: run.signal, max: 40 * 1024 * 1024 }));
    },
  };
}

export const listSource = async (source: CatalogueSource, run: Run): Promise<CatItem[]> => source.list(await sourceCtx(source, run));

export interface BuildHooks {
  /** called with each finished library; throw to count the item as failed */
  onLibrary(item: CatItem, fileName: string, data: Uint8Array): Promise<void>;
  /** before each item: index, count and its title */
  onItem?(i: number, total: number, item: CatItem): void;
  onFail?(item: CatItem, error: string): void;
}

/** Build each item in turn. Stops with `Cancelled` when the signal fires; one item failing does not stop the rest. */
export async function buildItems(source: CatalogueSource, items: CatItem[], run: Run, hooks: BuildHooks): Promise<{ added: number; failed: number }> {
  const ctx = await sourceCtx(source, run);
  let added = 0;
  let failed = 0;
  for (const [i, item] of items.entries()) {
    if (run.signal?.aborted) throw new Cancelled();
    hooks.onItem?.(i, items.length, item);
    try {
      const built = await source.build(ctx, item);
      await hooks.onLibrary(item, item.fileName, await buildNlib(built.meta, built.entries));
      added++;
    } catch (e) {
      if (e instanceof Cancelled || run.signal?.aborted) throw new Cancelled();
      failed++;
      hooks.onFail?.(item, e instanceof Error ? e.message : String(e));
    }
  }
  return { added, failed };
}
