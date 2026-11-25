/** The terminal version of the Resource manager: the same fetcher, pacing and converters, writing to folders on disk. Bundled by scripts/fetch-resources.mjs. */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { Cancelled, downloadFile, installResource, isInstalled, Pacer } from "./fetcher";
import { nodeIO } from "./nodeIO";
import { LIBRARY_RESOURCES, MODEL_RESOURCES, resourceFolder } from "./catalog";
import { formatDuration } from "./ccel";
import { buildItems, listSource } from "./catalogueRun";
import { CATALOGUE_SOURCES, catalogueSource, estimateItems } from "./catalogueSources";
import { convertHcf } from "./hcfArchive";
import { formatSize, totalSize } from "./types";

const HELP = `Booker resource downloader (honours each site's robots.txt and crawl delay)

  node scripts/fetch-resources.mjs list
  node scripts/fetch-resources.mjs models  [--plugin DIR] [--only id,id] [--dry-run]
  node scripts/fetch-resources.mjs site ccel|tertullian|fordham  [--out DIR] [--match TEXT] [--only id,...] [--limit N] [--dry-run]
  node scripts/fetch-resources.mjs ccel    (same as: site ccel)
  node scripts/fetch-resources.mjs archive hcf-writings|hcf-commentaries  [--out DIR] [--keep] [--dry-run]

models   downloads the search and writing models into <plugin>/models and <plugin>/models-gen
         (--plugin is the booker folder, default ./ )
site     fetches a website's items at its own pace (CCEL 10 s between requests, Fordham 2 s, Tertullian.org 1.5 s),
         honouring robots.txt, and makes each a Booker library (.nlib) in --out (default ./<site>-libraries).
         Run it again to carry on: finished files are skipped.
archive  downloads one HistoricalChristianFaith repository from GitHub (one request), makes a library per author or
         Father in --out, and deletes the download unless --keep.
         Add any result to Booker by dropping the folder on the Importer card.
`;

function args(argv: string[]) {
  const flags = new Map<string, string | true>();
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) (flags.set(a.slice(2), next), i++);
      else flags.set(a.slice(2), true);
    } else rest.push(a);
  }
  return { flags, rest };
}

const log = (m: string) => console.log(`${new Date().toISOString().slice(11, 19)}  ${m}`);

async function main() {
  const { flags, rest } = args(process.argv.slice(2));
  const cmd = rest[0];
  const io = nodeIO();
  const pacer = new Pacer(io);
  const abort = new AbortController();
  process.on("SIGINT", () => {
    log("Stopping after the file in progress… (run again to resume)");
    abort.abort();
  });
  const dry = flags.has("dry-run");

  if (cmd === "list") {
    for (const r of MODEL_RESOURCES) console.log(`${r.id.padEnd(24)} ${formatSize(totalSize(r)).padStart(8)}  ${r.title}`);
    for (const x of CATALOGUE_SOURCES) console.log(`site ${x.id}`.padEnd(24) + `  ${x.title} (see: site ${x.id} --dry-run)`);
    for (const r of LIBRARY_RESOURCES.filter((y) => y.archive)) console.log(`archive ${r.id}`.padEnd(24) + `  ${r.title}, ${r.sizeNote}`);
    return;
  }

  if (cmd === "models") {
    const plugin = resolve(String(flags.get("plugin") ?? "."));
    const only = flags.get("only") ? String(flags.get("only")).split(",") : null;
    const picks = MODEL_RESOURCES.filter((r) => !only || only.includes(r.id));
    log(`${picks.length} model(s), ${formatSize(picks.reduce((n, r) => n + totalSize(r), 0))} in all, into ${plugin}`);
    for (const r of picks) {
      const dir = join(plugin, resourceFolder(r), r.id);
      if (await isInstalled(io, r, dir)) {
        log(`${r.id}: already installed`);
        continue;
      }
      if (dry) {
        log(`${r.id}: would download ${formatSize(totalSize(r))}`);
        continue;
      }
      let last = 0;
      await installResource(io, pacer, r, dir, {
        signal: abort.signal,
        onProgress: (done, total) => {
          if (done - last > 5 * 1048576 || done === total) {
            last = done;
            log(`${r.id}: ${formatSize(done)} of ${formatSize(total)}`);
          }
        },
      });
      log(`${r.id}: done`);
    }
    return;
  }

  if (cmd === "ccel" || cmd === "site") {
    const id = cmd === "ccel" ? "ccel" : rest[1];
    const source = id ? catalogueSource(id) : undefined;
    if (!source) throw new Error(`Name a site: ${CATALOGUE_SOURCES.map((x) => x.id).join(", ")}`);
    const out = resolve(String(flags.get("out") ?? `${source.id}-libraries`));
    const run = { io, pacer, signal: abort.signal, say: () => undefined };
    const items = await listSource(source, run);
    log(`${source.title}: ${items.length} items; waiting ${pacer.delayFor(new URL(source.origin).host) / 1000} s between requests`);
    const only = flags.get("only") ? new Set(String(flags.get("only")).split(",")) : null;
    const match = flags.get("match") ? String(flags.get("match")).toLowerCase() : null;
    mkdirSync(out, { recursive: true });
    const have = new Set(readdirSync(out));
    let todo = items.filter((w) => (!only || only.has(w.id)) && (!match || `${w.title} ${w.note}`.toLowerCase().includes(match)) && !have.has(w.fileName));
    const limit = Number(flags.get("limit") ?? 0);
    if (limit > 0) todo = todo.slice(0, limit);
    log(`${todo.length} to fetch into ${out}, about ${formatDuration(estimateItems(todo, pacer.delayFor(new URL(source.origin).host)))}`);
    if (dry) {
      for (const w of todo.slice(0, 40)) console.log(`  ${w.id}  (${w.note})`);
      if (todo.length > 40) console.log(`  … and ${todo.length - 40} more`);
      return;
    }
    const r = await buildItems(source, todo, { ...run, say: (d) => log(`    ${d}`) }, {
      onItem: (i, n, item) => log(`${i + 1}/${n}  ${item.title}`),
      onFail: (item, error) => log(`FAILED ${item.id}: ${error}`),
      onLibrary: async (_item, fileName, data) => writeFileSync(join(out, fileName), data),
    }).catch((e) => {
      if (e instanceof Cancelled) return null;
      throw e;
    });
    log(r ? `finished: ${r.added} made${r.failed ? `, ${r.failed} failed` : ""}` : "stopped early: run again to carry on");
    return;
  }

  if (cmd === "archive") {
    const r = LIBRARY_RESOURCES.find((x) => x.id === rest[1] && x.archive);
    if (!r?.archive) throw new Error("Name an archive: hcf-writings or hcf-commentaries");
    const out = resolve(String(flags.get("out") ?? `${r.id}-libraries`));
    mkdirSync(out, { recursive: true });
    const file = join(out, `${r.id}.tar.gz`);
    log(`${r.title}: ${r.sizeNote}`);
    if (dry) return;
    let last = 0;
    await downloadFile(io, pacer, { url: r.archive.url, to: `${r.id}.tar.gz` }, file, {
      signal: abort.signal,
      onBytes: (n) => {
        last += n;
        if (last % (20 * 1048576) < n) log(`downloaded ${formatSize(last)}`);
      },
    });
    const have = new Set(readdirSync(out));
    let made = 0;
    await convertHcf(
      r.archive.kind,
      file,
      async (lib) => {
        if (have.has(lib.fileName)) return;
        writeFileSync(join(out, lib.fileName), lib.data);
        made++;
        log(`${lib.title}`);
      },
      () => undefined,
      abort.signal
    );
    if (!flags.has("keep")) rmSync(file, { force: true });
    log(`finished: ${made} libraries in ${out}`);
    return;
  }

  console.log(HELP);
  if (cmd && cmd !== "help") process.exitCode = 1;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
