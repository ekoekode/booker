/** Turns dropped or picked files, and whole folders from another Booker, into library entries. */
import { normalizePath, Notice } from "obsidian";
import type BookerPlugin from "../main";
import { classify, isSqliteHeader, refineSqlite, type Classified } from "./classify";
import { folderPath, type LibraryFolder } from "./paths";
import { addSource, importBibliography, kindOfFile, type NewSource } from "../sources/library";
import { describeDatabase, mapPath, suggestMapping } from "../sources/dbmap";
import { extractEpub } from "../sources/extract";
import { fileToMarkdown } from "../import/toMarkdown";
import { openDb, tables } from "../scripture/sqlite";
import { parseBibliography } from "../sources/bib";

/** A file on its way in. `rel` is its path inside a dropped folder, or just its name. */
export interface Incoming {
  name: string;
  rel: string;
  data: ArrayBuffer;
}

export interface ImportResult {
  name: string;
  status: "added" | "skipped" | "failed";
  message: string;
}

const titleOf = (name: string) => name.replace(/\.[^.]+$/, "").replace(/\.(bbl|cmt|dct)$/i, "").replace(/_+/g, " ").trim();

/** The frontmatter of a Booker source note, when this is one. */
export function sourceNoteInfo(text: string): { uid: string; file?: string; kind?: string } | null {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1];
  if (!fm || !/^type:\s*"?source"?\s*$/m.test(fm)) return null;
  const uid = /^uid:\s*"?([^"\r\n]+?)"?\s*$/m.exec(fm)?.[1];
  if (!uid) return null;
  return { uid, file: /^file:\s*"?([^"\r\n]+?)"?\s*$/m.exec(fm)?.[1], kind: /^kind:\s*"?([^"\r\n]+?)"?\s*$/m.exec(fm)?.[1] };
}

async function ensureFolder(plugin: BookerPlugin, dir: string) {
  let cur = "";
  for (const p of dir.split("/")) {
    cur = cur ? `${cur}/${p}` : p;
    if (!(await plugin.app.vault.adapter.exists(cur))) await plugin.app.vault.adapter.mkdir(cur);
  }
}

async function classifyFile(f: Incoming): Promise<Classified> {
  const head = new Uint8Array(f.data.slice(0, 4096));
  const c = classify(f.name, head);
  if (c.kind !== "sqlite") return c;
  try {
    const db = await openDb(new Uint8Array(f.data));
    try {
      return refineSqlite(c, tables(db));
    } finally {
      db.close();
    }
  } catch {
    return isSqliteHeader(head) ? c : { kind: "unsupported", label: "Unsupported", folder: null, reason: "That database could not be opened. It may be locked." };
  }
}

/** Citation details worked out from the file itself, so a drop needs no form. */
async function autoMeta(c: Classified, f: Incoming): Promise<NewSource> {
  const base: NewSource = { title: titleOf(f.name), authors: [], type: "book", kind: c.sourceKind ?? "md" };
  if (c.kind === "library" || (c.kind === "lexicon" && c.sourceKind === "db")) {
    try {
      const { readDatabase } = await import("../sources/nlib");
      const d = (await readDatabase(new Uint8Array(f.data), f.name)).meta;
      return { ...base, title: d.title, authors: d.authors, type: d.type, category: d.category, ...(d.year && { year: d.year }), ...(d.publisher && { publisher: d.publisher }), ...(d.place && { place: d.place }), ...(d.edition && { edition: d.edition }), ...(d.container && { container: d.container }), ...(d.volume && { volume: d.volume }), ...(d.url && { url: d.url }) };
    } catch {
      return base;
    }
  }
  if (f.name.toLowerCase().endsWith(".epub")) {
    try {
      const e = await extractEpub(f.data);
      return { ...base, ...(e.title && { title: e.title }), authors: e.author ? [e.author] : [] };
    } catch {
      return base;
    }
  }
  return base;
}

async function importOne(plugin: BookerPlugin, f: Incoming, into?: LibraryFolder, index = true): Promise<ImportResult> {
  const c = await classifyFile(f);
  if (!c.folder) return { name: f.name, status: "failed", message: c.reason ?? "Not supported." };
  try {
    if (c.kind === "bibliography") {
      const items = parseBibliography(f.name, new TextDecoder().decode(f.data));
      if (!items.length) return { name: f.name, status: "failed", message: "No references found in that file." };
      const r = await importBibliography(plugin.app, items);
      return { name: f.name, status: r.added ? "added" : "skipped", message: `${r.added} source${r.added === 1 ? "" : "s"} added${r.skipped ? `, ${r.skipped} already in the library` : ""}.` };
    }
    if (c.module) {
      const existing = (await plugin.modules.list()).some((m) => m.name === f.name);
      if (existing) return { name: f.name, status: "skipped", message: "Already in the library." };
      await plugin.modules.add(f.name, f.data);
      return { name: f.name, status: "added", message: `${c.label}, kept in ${folderPath("Bibles")}.` };
    }
    if (c.kind === "convert") {
      const md = await fileToMarkdown(f.name, { text: async () => new TextDecoder().decode(f.data), bytes: async () => f.data });
      const meta: NewSource = { title: titleOf(f.name), authors: [], type: "book", kind: "md" };
      const s = await addSource(plugin.app, meta, new TextEncoder().encode(md).buffer as ArrayBuffer, "md", into ?? "Documents");
      queueIndex(plugin, s);
      return { name: f.name, status: "added", message: `${c.label} turned into Markdown.` };
    }
    const kind = c.sourceKind ?? kindOfFile(f.name);
    if (!kind) return { name: f.name, status: "failed", message: "Not supported." };
    const meta = await autoMeta(c, f);
    const dup = plugin.sources().find((s) => s.title === meta.title && s.kind === kind && s.authors.join(";") === meta.authors.join(";"));
    if (dup) return { name: f.name, status: "skipped", message: `“${dup.title}” is already in the library.` };
    const ext = f.name.split(".").pop()!.toLowerCase();
    const s = await addSource(plugin.app, { ...meta, kind }, f.data, ext, into ?? c.folder);
    let note = `${c.label}, kept in ${folderPath(into ?? c.folder)}.`;
    if (c.kind === "sqlite") {
      const guess = suggestMapping(await describeDatabase(new Uint8Array(f.data)));
      if (guess) {
        await plugin.app.vault.adapter.write(mapPath(s.file), JSON.stringify(guess, null, 2));
        note += ` Fields guessed (table “${guess.table}”): check them in the three-dot menu.`;
      } else note += " Booker could not guess its fields: choose them in the three-dot menu.";
    }
    if (index) queueIndex(plugin, s);
    return { name: f.name, status: "added", message: note };
  } catch (e) {
    return { name: f.name, status: "failed", message: e instanceof Error ? e.message : String(e) };
  }
}

function queueIndex(plugin: BookerPlugin, s: import("../sources/types").Source) {
  window.setTimeout(() => void plugin.sourceService.index(s).catch(() => undefined), 1500);
}

/**
 * Import what the user dropped. Files inside a folder that holds Booker source notes are copied as they were (the notes carry
 * their citation details and highlights); a folder whose sources are already here is skipped. Anything else is imported file by file.
 */
export async function importIncoming(plugin: BookerPlugin, files: Incoming[], opts: { index?: boolean } = {}): Promise<ImportResult[]> {
  const results: ImportResult[] = [];
  const known = new Set(plugin.sources().map((s) => s.uid));
  const byDir = new Map<string, Incoming[]>();
  for (const f of files) {
    const dir = f.rel.includes("/") ? f.rel.slice(0, f.rel.lastIndexOf("/")) : "";
    byDir.set(dir, [...(byDir.get(dir) ?? []), f]);
  }
  const handled = new Set<Incoming>();
  for (const [dir, list] of byDir) {
    const notes = list.map((f) => ({ f, info: f.name.toLowerCase().endsWith(".md") ? sourceNoteInfo(new TextDecoder().decode(f.data)) : null })).filter((x) => x.info);
    if (!notes.length) continue;
    list.forEach((f) => handled.add(f));
    if (notes.every((n) => known.has(n.info!.uid))) {
      results.push({ name: dir || notes[0].f.name, status: "skipped", message: "Already in the library." });
      continue;
    }
    const isDb = notes.some((n) => n.info!.kind === "db");
    const target = normalizePath(`${folderPath(isDb ? "Databases" : "Documents")}/${dir}`);
    try {
      await ensureFolder(plugin, target);
      for (const f of list) await plugin.app.vault.adapter.writeBinary(`${target}/${f.name}`, f.data);
      results.push({ name: dir || notes[0].f.name, status: "added", message: `Copied with its notes to ${target}.` });
    } catch (e) {
      results.push({ name: dir, status: "failed", message: e instanceof Error ? e.message : String(e) });
    }
  }
  for (const f of files) if (!handled.has(f)) results.push(await importOne(plugin, f, undefined, opts.index ?? files.length <= 20));
  plugin.events.trigger("library");
  return results;
}

/** Read the dropped items, including folders, into memory. */
export async function readDropped(dt: DataTransfer): Promise<Incoming[]> {
  const out: Incoming[] = [];
  const walk = async (entry: any, prefix: string): Promise<void> => {
    if (entry.isFile) {
      const file: File = await new Promise((res, rej) => entry.file(res, rej));
      out.push({ name: file.name, rel: `${prefix}${file.name}`, data: await file.arrayBuffer() });
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      for (;;) {
        const batch: any[] = await new Promise((res, rej) => reader.readEntries(res, rej));
        if (!batch.length) break;
        for (const e of batch) await walk(e, `${prefix}${entry.name}/`);
      }
    }
  };
  const entries = Array.from(dt.items ?? []).map((i) => (i as any).webkitGetAsEntry?.()).filter(Boolean);
  if (entries.length) for (const e of entries) await walk(e, "");
  else for (const f of Array.from(dt.files)) out.push({ name: f.name, rel: f.name, data: await f.arrayBuffer() });
  return out;
}

/** Files picked with an input; a picked folder carries its structure in webkitRelativePath. */
export async function readPicked(files: File[]): Promise<Incoming[]> {
  const out: Incoming[] = [];
  for (const f of files) out.push({ name: f.name, rel: (f as any).webkitRelativePath || f.name, data: await f.arrayBuffer() });
  return out;
}

export function reportImport(results: ImportResult[]) {
  const n = (s: ImportResult["status"]) => results.filter((r) => r.status === s).length;
  new Notice(`Booker: ${n("added")} added${n("skipped") ? `, ${n("skipped")} already there` : ""}${n("failed") ? `, ${n("failed")} could not be added` : ""}.`, 8000);
}
