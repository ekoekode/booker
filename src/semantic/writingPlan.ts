/** Which notes of a writing index need reading again. Pure. */
export interface FileStamp {
  path: string;
  mtime: number;
  size: number;
}

export interface Plan {
  /** paths whose saved pieces are still good */
  keep: string[];
  /** new or changed paths */
  changed: string[];
  /** saved paths that are gone */
  removed: string[];
}

export function planFiles(saved: FileStamp[], now: FileStamp[]): Plan {
  const had = new Map(saved.map((f) => [f.path, f]));
  const keep: string[] = [];
  const changed: string[] = [];
  for (const f of now) {
    const old = had.get(f.path);
    (old && old.mtime === f.mtime && old.size === f.size ? keep : changed).push(f.path);
  }
  const present = new Set(now.map((f) => f.path));
  return { keep, changed, removed: saved.filter((f) => !present.has(f.path)).map((f) => f.path) };
}
