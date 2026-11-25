/** A small JSON file kept in the vault's library folder, so it travels with a copy of the library. */
import { normalizePath } from "obsidian";
import { LIBRARY_ROOT } from "./paths";

export interface FileAdapter {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  write(path: string, data: string): Promise<void>;
  mkdir(path: string): Promise<void>;
}

export class JsonFile<T> {
  private queue: Promise<unknown> = Promise.resolve();
  readonly path: string;

  /** `parse` turns whatever is on disk (possibly damaged) into a good value; it must not throw. */
  constructor(private adapter: FileAdapter, name: string, private parse: (raw: unknown) => T, private empty: () => T) {
    this.path = normalizePath(`${LIBRARY_ROOT}/${name}`);
  }

  async load(): Promise<T> {
    try {
      if (!(await this.adapter.exists(this.path))) return this.empty();
      return this.parse(JSON.parse(await this.adapter.read(this.path)));
    } catch {
      return this.empty();
    }
  }

  /** Writes one after another, so two quick saves cannot cross. */
  save(value: T): Promise<void> {
    const run = async () => {
      if (!(await this.adapter.exists(LIBRARY_ROOT))) await this.mkdirs(LIBRARY_ROOT);
      await this.adapter.write(this.path, JSON.stringify(value, null, 2));
    };
    this.queue = this.queue.then(run, run);
    return this.queue as Promise<void>;
  }

  private async mkdirs(dir: string) {
    let at = "";
    for (const part of dir.split("/")) {
      at = at ? `${at}/${part}` : part;
      if (!(await this.adapter.exists(at))) await this.adapter.mkdir(at);
    }
  }
}

/** Reads a field as a string, a number or a list of strings, whatever the file holds. */
export const asStr = (v: unknown, d = ""): string => (typeof v === "string" ? v : d);
export const asNum = (v: unknown, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : d);
export const asStrs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()).map((x) => x.trim()) : []);

let seq = 0;
export const newId = (now = Date.now()): string => `${now.toString(36)}${(seq++ % 1296).toString(36).padStart(2, "0")}${Math.random().toString(36).slice(2, 5)}`;
