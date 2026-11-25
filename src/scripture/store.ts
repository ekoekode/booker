/** Finds the Bible modules in the modules folder and opens them when they are first needed. */
import { App, normalizePath } from "obsidian";
import { openLiveCommentary, readEswordTitle, readEswordBible, readEswordDictionary, type DictionaryModule, type LiveCommentary } from "./esword";
import type { BibleModule } from "./module";
import { readXmlBible, sniffXml } from "./xml";

import { LEGACY_BIBLES, LIB_BIBLES } from "../library/paths";

/** Modules are kept here; the folder in settings and the older Booker/Bibles are read as well. */
export const DEFAULT_FOLDER = LIB_BIBLES;

export type ModuleKind = "bible" | "commentary" | "dictionary" | "xml" | "other";

export interface ModuleFile {
  /** vault path, also the module's id */
  path: string;
  name: string;
  kind: ModuleKind;
}

/** What a file is, from its name. e-Sword uses .bblx/.cmtx/.dctx; MySword uses .bbl.mybible and friends. */
/** A module's file name as a title: no extension, and no .bbl/.cmt/.dct kind marker. */
export const moduleLabel = (name: string): string => name.replace(/\.(bbl|cmt|dct)\.mybible$/i, "").replace(/\.(bblx|cmtx|dctx|lexx|mybible|xml|osis|zefania|usfx)$/i, "");

export function kindOf(name: string): ModuleKind {
  const n = name.toLowerCase();
  if (/\.bblx$|\.bbl\.mybible$/.test(n)) return "bible";
  if (/\.cmtx$|\.cmt\.mybible$/.test(n)) return "commentary";
  if (/\.dctx$|\.dct\.mybible$|\.lexx$/.test(n)) return "dictionary";
  if (/\.(xml|osis|zefania|usfx)$/.test(n)) return "xml";
  return "other";
}

export const MODULE_EXTENSIONS = ["bblx", "mybible", "cmtx", "dctx", "xml", "osis", "zefania", "usfx"];

export class ModuleStore {
  private open = new Map<string, Promise<BibleModule>>();

  constructor(private app: App, private folder: () => string) {}

  /** Every folder modules are read from, without repeats and without one inside another. */
  private roots(): string[] {
    const all = [...new Set([this.folder() || DEFAULT_FOLDER, DEFAULT_FOLDER, LEGACY_BIBLES].map((d) => normalizePath(d)))];
    return all.filter((d) => !all.some((o) => o !== d && d.startsWith(`${o}/`)));
  }

  async list(): Promise<ModuleFile[]> {
    const out: ModuleFile[] = [];
    const walk = async (dir: string) => {
      if (!(await this.app.vault.adapter.exists(dir))) return;
      const l = await this.app.vault.adapter.list(dir);
      for (const f of l.files) {
        const kind = kindOf(f);
        if (kind !== "other") out.push({ path: f, name: f.slice(f.lastIndexOf("/") + 1), kind });
      }
      for (const d of l.folders) await walk(d);
    };
    for (const dir of this.roots()) await walk(dir);
    const seen = new Set<string>();
    return out.filter((m) => !seen.has(m.path) && !!seen.add(m.path)).sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Bibles only (e-Sword, MySword and the XML formats). */
  async bibles(): Promise<ModuleFile[]> {
    return (await this.list()).filter((m) => m.kind === "bible" || m.kind === "xml");
  }

  /** Open a Bible, keeping the last two in memory. */
  load(file: ModuleFile): Promise<BibleModule> {
    let p = this.open.get(file.path);
    if (!p) {
      p = (async () => {
        if (file.kind === "xml") return readXmlBible(file.path, new TextDecoder("utf-8").decode(await this.app.vault.adapter.readBinary(file.path)));
        return readEswordBible(file.path, new Uint8Array(await this.app.vault.adapter.readBinary(file.path)));
      })();
      p.catch(() => this.open.delete(file.path));
      this.open.set(file.path, p);
      while (this.open.size > 2) this.open.delete(this.open.keys().next().value!);
    }
    return p;
  }

  private titled = new Map<string, Promise<string>>();

  /** The name a module gives itself (e.g. "Berean Standard Bible"), or its file name when it gives none. */
  title(file: ModuleFile): Promise<string> {
    let p = this.titled.get(file.path);
    if (!p) {
      p = (async () => {
        try {
          if (file.kind === "xml") return (await this.load(file)).name || moduleLabel(file.name);
          const t = await readEswordTitle(new Uint8Array(await this.app.vault.adapter.readBinary(file.path)));
          return t || moduleLabel(file.name);
        } catch {
          return moduleLabel(file.name);
        }
      })();
      this.titled.set(file.path, p);
    }
    return p;
  }

  private comms = new Map<string, Promise<LiveCommentary>>();

  async commentaries(): Promise<ModuleFile[]> {
    return (await this.list()).filter((m) => m.kind === "commentary");
  }

  loadCommentary(file: ModuleFile): Promise<LiveCommentary> {
    let p = this.comms.get(file.path);
    if (!p) {
      p = (async () => openLiveCommentary(file.path, new Uint8Array(await this.app.vault.adapter.readBinary(file.path))))();
      p.catch(() => this.comms.delete(file.path));
      this.comms.set(file.path, p);
      while (this.comms.size > 2) {
        const k = this.comms.keys().next().value!;
        void this.comms.get(k)?.then((c) => c.close()).catch(() => undefined);
        this.comms.delete(k);
      }
    }
    return p;
  }

  private dicts = new Map<string, Promise<DictionaryModule>>();

  async dictionaries(): Promise<ModuleFile[]> {
    return (await this.list()).filter((m) => m.kind === "dictionary");
  }

  loadDictionary(file: ModuleFile): Promise<DictionaryModule> {
    let p = this.dicts.get(file.path);
    if (!p) {
      p = (async () => readEswordDictionary(file.path, new Uint8Array(await this.app.vault.adapter.readBinary(file.path))))();
      p.catch(() => this.dicts.delete(file.path));
      this.dicts.set(file.path, p);
      while (this.dicts.size > 2) this.dicts.delete(this.dicts.keys().next().value!);
    }
    return p;
  }

  forget(path?: string) {
    if (path) this.open.delete(path);
    else this.open.clear();
  }

  /** Copy a file the user picked into the library's Bibles folder. */
  async add(name: string, data: ArrayBuffer): Promise<string> {
    // an XML file that is not a Bible is refused now, not when it is first opened
    if (/\.(xml|osis|zefania|usfx)$/i.test(name) && !sniffXml(new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(data, 0, Math.min(data.byteLength, 4000))))) {
      throw new Error("This XML file is not OSIS, Zefania or USFX.");
    }
    const dir = normalizePath(DEFAULT_FOLDER);
    let cur = "";
    for (const part of dir.split("/")) {
      cur = cur ? `${cur}/${part}` : part;
      if (!(await this.app.vault.adapter.exists(cur))) await this.app.vault.adapter.mkdir(cur);
    }
    const path = `${dir}/${name.replace(/[\\/:*?"<>|]/g, "_")}`;
    await this.app.vault.adapter.writeBinary(path, data);
    this.forget(path);
    return path;
  }

  async remove(path: string) {
    this.forget(path);
    await this.app.vault.adapter.remove(path);
  }
}

/** Ask for files with the system picker (works on desktop and on phones and tablets). */
export function pickFiles(accept: string[]): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = accept.map((e) => "." + e).join(",");
    input.onchange = () => resolve(Array.from(input.files ?? []));
    input.oncancel = () => resolve([]);
    input.click();
  });
}
