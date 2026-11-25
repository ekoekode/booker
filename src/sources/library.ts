/** The sources in the vault: one small note per source (`type: source`) next to the original file. */
import { App, normalizePath, TFile } from "obsidian";
import { citekey, safeFolderName, uid } from "./ids";
import type { BibItem } from "./bib";
import type { Source, SourceKind, SourceType } from "./types";

import { folderPath, type LibraryFolder } from "../library/paths";

/** Where new documents go; sources already in the old Sources folder are still read. */
export const SOURCES_ROOT = folderPath("Documents");

const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String).filter(Boolean) : typeof v === "string" && v.trim() ? [v.trim()] : []);
const str = (v: unknown): string | undefined => (v === null || v === undefined || v === "" ? undefined : String(v));

/** The vault path of a source's file. When the folder has been moved (another Booker, another vault), the file is looked for beside its note. */
function locate(app: App, file: string | undefined, note: TFile): string {
  if (!file) return note.path;
  if (app.vault.getAbstractFileByPath(file)) return file;
  const beside = `${note.parent?.path ?? ""}/${file.slice(file.lastIndexOf("/") + 1)}`.replace(/^\//, "");
  return app.vault.getAbstractFileByPath(beside) ? beside : file;
}

export function readSources(app: App): Source[] {
  const out: Source[] = [];
  for (const f of app.vault.getMarkdownFiles()) {
    const fm = app.metadataCache.getFileCache(f)?.frontmatter;
    if (!fm || fm.type !== "source" || !fm.uid) continue;
    out.push({
      uid: String(fm.uid),
      citekey: str(fm.citekey) ?? String(fm.uid).slice(-6).toLowerCase(),
      title: str(fm.title) ?? f.basename,
      authors: arr(fm.author),
      editors: arr(fm.editor),
      translators: arr(fm.translator),
      year: str(fm.year),
      publisher: str(fm.publisher),
      place: str(fm.place),
      edition: str(fm.edition),
      container: str(fm.container),
      category: str(fm.category),
      volume: str(fm.volume),
      issue: str(fm.issue),
      pages: str(fm.pages),
      url: str(fm.url),
      accessed: str(fm.accessed),
      type: (str(fm.source_type) as SourceType) ?? "book",
      kind: (str(fm.kind) as SourceKind) ?? "md",
      file: locate(app, str(fm.file), f),
      note: f.path,
    });
  }
  return out.sort((a, b) => a.title.localeCompare(b.title));
}

export function kindOfFile(name: string): SourceKind | null {
  const e = name.toLowerCase().split(".").pop() ?? "";
  if (e === "md" || e === "markdown") return "md";
  if (e === "txt") return "txt";
  if (e === "pdf") return "pdf";
  if (e === "epub") return "epub";
  if (e === "html" || e === "htm" || e === "xhtml") return "html";
  if (e === "xml" || e === "thml") return "xml";
  if (e === "nlib" || e === "dctx" || /\.dct\.mybible$/i.test(name)) return "db";
  return null;
}

const q = (s: string) => JSON.stringify(s);
const list = (a: string[] | undefined) => (a?.length ? `[${a.map(q).join(", ")}]` : "");

export function sourceNote(s: Source): string {
  const lines: Array<[string, string | undefined]> = [
    ["type", "source"],
    ["uid", q(s.uid)],
    ["citekey", q(s.citekey)],
    ["title", q(s.title)],
    ["author", list(s.authors)],
    ["editor", list(s.editors)],
    ["translator", list(s.translators)],
    ["year", s.year ? q(s.year) : undefined],
    ["publisher", s.publisher ? q(s.publisher) : undefined],
    ["place", s.place ? q(s.place) : undefined],
    ["edition", s.edition ? q(s.edition) : undefined],
    ["container", s.container ? q(s.container) : undefined],
    ["category", s.category ? q(s.category) : undefined],
    ["volume", s.volume ? q(s.volume) : undefined],
    ["issue", s.issue ? q(s.issue) : undefined],
    ["pages", s.pages ? q(s.pages) : undefined],
    ["url", s.url ? q(s.url) : undefined],
    ["accessed", s.accessed ? q(s.accessed) : undefined],
    ["source_type", s.type],
    ["kind", s.kind],
    ["file", q(s.file)],
  ];
  return `---\n${lines.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join("\n")}\n---\n\nNotes about this source go here. Highlights are kept in [[Highlights]].\n`;
}

export interface NewSource {
  title: string;
  authors: string[];
  year?: string;
  publisher?: string;
  place?: string;
  edition?: string;
  container?: string;
  category?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  url?: string;
  type: SourceType;
  kind: SourceKind;
}

async function ensureFolder(app: App, dir: string) {
  let cur = "";
  for (const p of dir.split("/")) {
    cur = cur ? `${cur}/${p}` : p;
    if (!(await app.vault.adapter.exists(cur))) await app.vault.adapter.mkdir(cur);
  }
}

/** Add the entries of an imported bibliography as details-only sources (no file: the note is the source). Skips ones already in the library. */
export async function importBibliography(app: App, items: BibItem[]): Promise<{ added: number; skipped: number }> {
  const existing = readSources(app);
  const taken = new Set(existing.map((x) => x.citekey));
  const seen = new Set(existing.map((x) => `${x.title}|${x.authors[0] ?? ""}`.toLowerCase()));
  const dir = normalizePath(`${SOURCES_ROOT}/Imported`);
  await ensureFolder(app, dir);
  let added = 0;
  let skipped = 0;
  for (const it of items) {
    const sig = `${it.title}|${it.authors[0] ?? ""}`.toLowerCase();
    if (seen.has(sig)) {
      skipped++;
      continue;
    }
    seen.add(sig);
    const key = it.key && /^[A-Za-z0-9_.:-]+$/.test(it.key) && !taken.has(it.key) ? it.key : citekey(it.authors, it.title, it.year, taken);
    taken.add(key);
    let path = normalizePath(`${dir}/${safeFolderName(it.title).slice(0, 80)}.md`);
    for (let i = 2; await app.vault.adapter.exists(path); i++) path = normalizePath(`${dir}/${safeFolderName(it.title).slice(0, 80)} ${i}.md`);
    const { key: _k, ...rest } = it;
    await app.vault.create(path, sourceNote({ ...rest, uid: uid(), citekey: key, kind: "md", file: path, note: path }));
    added++;
  }
  return { added, skipped };
}

/** Copy the original into `Booker/Library/<Databases or Documents>/<title>/` and write its note. Returns the finished source. */
export async function addSource(app: App, meta: NewSource, original: ArrayBuffer, ext: string, into: LibraryFolder = meta.kind === "db" ? "Databases" : "Documents"): Promise<Source> {
  const existing = readSources(app);
  const root = folderPath(into);
  let name = safeFolderName(meta.title);
  let dir = normalizePath(`${root}/${name}`);
  for (let i = 2; await app.vault.adapter.exists(dir); i++) {
    name = `${safeFolderName(meta.title)} ${i}`;
    dir = normalizePath(`${root}/${name}`);
  }
  await ensureFolder(app, dir);
  const file = `${dir}/${name}.${ext}`;
  await app.vault.adapter.writeBinary(file, original);
  const s: Source = {
    ...meta,
    uid: uid(),
    citekey: citekey(meta.authors, meta.title, meta.year, new Set(existing.map((x) => x.citekey))),
    file,
    note: `${dir}/${name}.md`,
  };
  if (ext === "md") {
    // a Markdown source is its own file: the note IS the text, so keep the description in a sidecar note
    s.note = `${dir}/${name} (source).md`;
  }
  await app.vault.create(s.note!, sourceNote(s));
  await app.vault.create(`${dir}/Highlights.md`, `# Highlights: ${meta.title}\n`);
  return s;
}

export async function saveSourceMeta(app: App, s: Source) {
  const f = s.note ? app.vault.getFileByPath(s.note) : null;
  if (f instanceof TFile) {
    const body = (await app.vault.read(f)).replace(/^---\n[\s\S]*?\n---\n/, "");
    await app.vault.modify(f, sourceNote(s).replace(/\n---\n[\s\S]*$/, "\n---\n") + body);
  }
}
