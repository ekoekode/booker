/**
 * Running a backup and restoring one. All disk work goes through two small interfaces (where the files come from, where
 * the backup is kept), so this file has no Obsidian or Node imports and can be tested with files held in memory.
 *
 * Layout inside the backup folder, for a project called "Novel":
 *   Novel/Novel 2026-10-26 093012 full.zip      a whole copy
 *   Novel/incremental/2026-10-27 090000/...      only the files that changed, same paths as in the zip
 *   Novel/incremental/2026-10-27 090000/_removed.txt   one removed path per line
 *   Novel/manifest.json                          what the last run saw
 */
import JSZip from "jszip";
import { diffManifest, isStamp, planRun, prune, restoreChain, stamp, type BackupConfig, type FileInfo, type Manifest } from "./plan";

export interface BackupSource {
  list(): Promise<FileInfo[]>;
  read(path: string): Promise<Uint8Array>;
}

export interface Sink {
  mkdirp(dir: string): Promise<void>;
  write(path: string, data: Uint8Array | string): Promise<void>;
  /** null when it does not exist */
  read(path: string): Promise<Uint8Array | null>;
  list(dir: string): Promise<Array<{ name: string; isDir: boolean }>>;
  remove(path: string): Promise<void>;
}

export interface RunResult {
  kind: "full" | "incremental" | "nothing";
  files: number;
  note: string;
}

const join = (...p: string[]) => p.filter(Boolean).join("/").replace(/\/+/g, "/");
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

async function readManifest(sink: Sink, root: string): Promise<Manifest | null> {
  const raw = await sink.read(join(root, "manifest.json"));
  if (!raw) return null;
  try {
    const m = JSON.parse(dec(raw));
    return m && typeof m.fullStamp === "string" && m.files ? (m as Manifest) : null;
  } catch {
    return null;
  }
}

export async function runBackup(name: string, source: BackupSource, sink: Sink, cfg: Pick<BackupConfig, "mode" | "keep">, now = new Date()): Promise<RunResult> {
  const root = name;
  const files = await source.list();
  const prev = await readManifest(sink, root);
  const plan = planRun(cfg.mode, prev, files);
  if (plan.kind === "nothing") return { kind: "nothing", files: 0, note: "Nothing has changed since the last backup." };
  const at = stamp(now);
  await sink.mkdirp(root);

  if (plan.kind === "full") {
    const zip = new JSZip();
    for (const f of files) zip.file(f.path, await source.read(f.path), { date: new Date(f.mtime) });
    const data = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
    await sink.write(join(root, `${name} ${at} full.zip`), data);
    const manifest: Manifest = { fullStamp: at, runs: 0, files: Object.fromEntries(files.map((f) => [f.path, { size: f.size, mtime: f.mtime }])) };
    await sink.write(join(root, "manifest.json"), JSON.stringify(manifest));
    await tidy(sink, root, name, cfg.keep);
    return { kind: "full", files: files.length, note: `Full backup: ${files.length} files.` };
  }

  const dir = join(root, "incremental", at);
  const changed = [...plan.diff.added, ...plan.diff.changed];
  for (const p of changed) {
    await sink.mkdirp(join(dir, p.slice(0, Math.max(0, p.lastIndexOf("/")))));
    await sink.write(join(dir, p), await source.read(p));
  }
  if (!changed.length) await sink.mkdirp(dir);
  if (plan.diff.removed.length) await sink.write(join(dir, "_removed.txt"), plan.diff.removed.join("\n"));
  const manifest: Manifest = { fullStamp: prev!.fullStamp, runs: prev!.runs + 1, files: Object.fromEntries(files.map((f) => [f.path, { size: f.size, mtime: f.mtime }])) };
  await sink.write(join(root, "manifest.json"), JSON.stringify(manifest));
  await tidy(sink, root, name, cfg.keep);
  return { kind: "incremental", files: changed.length, note: `Incremental backup: ${plan.diff.added.length} new, ${plan.diff.changed.length} changed, ${plan.diff.removed.length} removed.` };
}

async function stamps(sink: Sink, root: string, name: string): Promise<{ fulls: string[]; incs: string[] }> {
  const top = await sink.list(root);
  const fulls = top.filter((e) => !e.isDir && e.name.startsWith(`${name} `) && e.name.endsWith(" full.zip")).map((e) => e.name.slice(name.length + 1, -" full.zip".length)).filter(isStamp);
  const incs = (await sink.list(join(root, "incremental")).catch(() => [])).filter((e) => e.isDir && isStamp(e.name)).map((e) => e.name);
  return { fulls, incs };
}

async function tidy(sink: Sink, root: string, name: string, keep: number) {
  const { fulls, incs } = await stamps(sink, root, name);
  const drop = prune(fulls, incs, keep);
  for (const s of drop.fulls) await sink.remove(join(root, `${name} ${s} full.zip`));
  for (const s of drop.incrementals) await sink.remove(join(root, "incremental", s));
}

/** The moments a project can be restored to, newest last. */
export async function listBackups(sink: Sink, name: string): Promise<Array<{ stamp: string; kind: "full" | "incremental" }>> {
  const { fulls, incs } = await stamps(sink, name, name);
  return [...fulls.map((s) => ({ stamp: s, kind: "full" as const })), ...incs.map((s) => ({ stamp: s, kind: "incremental" as const }))].sort((a, b) => a.stamp.localeCompare(b.stamp));
}

/**
 * Rebuild the project as it was at `upTo` (default: the latest backup) into `out`, which gets every file under the
 * given folder. Returns the number of files written; null when there is no backup to start from.
 */
export async function restoreBackup(sink: Sink, name: string, out: { write(path: string, data: Uint8Array): Promise<void> }, into: string, upTo?: string): Promise<number | null> {
  const { fulls, incs } = await stamps(sink, name, name);
  const chain = restoreChain(fulls, incs, upTo);
  if (!chain) return null;
  const files = new Map<string, Uint8Array>();
  const zipData = await sink.read(join(name, `${name} ${chain.full} full.zip`));
  if (!zipData) return null;
  const zip = await JSZip.loadAsync(zipData);
  for (const [p, e] of Object.entries(zip.files)) if (!e.dir) files.set(p, await e.async("uint8array"));
  for (const s of chain.incrementals) {
    const base = join(name, "incremental", s);
    const walk = async (rel: string) => {
      for (const e of await sink.list(join(base, rel))) {
        const r = join(rel, e.name);
        if (e.isDir) await walk(r);
        else if (r === "_removed.txt") for (const gone of dec((await sink.read(join(base, r)))!).split("\n").filter(Boolean)) files.delete(gone);
        else files.set(r, (await sink.read(join(base, r)))!);
      }
    };
    await walk("");
  }
  for (const [p, data] of files) await out.write(join(into, p.startsWith(`${name}/`) ? p.slice(name.length + 1) : p), data);
  return files.size;
}

export { diffManifest };
