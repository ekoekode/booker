/** Writing a Booker reference library (.nlib): the tables and rows described in docs/REFERENCE-LIBRARY-FORMAT.md. */
import { newDatabase } from "../scripture/sqlite";
import type { LibEntry } from "../resources/thml";

export interface NlibWriteMeta {
  title: string;
  authors?: string[];
  category?: string;
  container?: string;
  year?: string;
  url?: string;
  license?: string;
  description?: string;
  language?: string;
}

export async function buildNlib(meta: NlibWriteMeta, entries: LibEntry[]): Promise<Uint8Array> {
  const db = await newDatabase();
  try {
    db.run(`create table meta (key text primary key, value text);
create table entries (id integer primary key, parent integer, seq integer, level text, locator text, key text, title text, text text);
create index entries_parent on entries(parent);
create index entries_key on entries(key);`);
    const m = db.prepare("insert into meta values (?, ?)");
    const pairs: Record<string, string | undefined> = {
      format: "nlib",
      version: "1",
      title: meta.title,
      author: meta.authors?.join("; "),
      category: meta.category,
      container: meta.container,
      year: meta.year,
      url: meta.url,
      license: meta.license,
      description: meta.description,
      language: meta.language,
    };
    for (const [k, v] of Object.entries(pairs)) if (v) m.run([k, v]);
    m.free();
    const e = db.prepare("insert into entries values (?,?,?,?,?,?,?,?)");
    entries.forEach((x, i) => e.run([x.id, x.parent, i + 1, x.level || null, x.locator || null, x.key || null, x.title || null, x.text || null]));
    e.free();
    return db.export();
  } finally {
    db.close();
  }
}
