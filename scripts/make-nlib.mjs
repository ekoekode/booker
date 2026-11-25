#!/usr/bin/env node
/**
 * Build a Booker reference library (.nlib) from a JSON file, so a converter only has to write JSON.
 *   node scripts/make-nlib.mjs input.json output.nlib
 * input.json: { "meta": { "title": "...", "author": "A; B", "category": "fathers", ... },
 *               "entries": [ { "id": 1, "parent": null, "level": "work", "title": "...", "locator": "", "key": "", "text": "" }, ... ] }
 * Entries are kept in the order given. `id` and `parent` are optional (parents may be written as the id of an earlier entry).
 * See docs/REFERENCE-LIBRARY-FORMAT.md.
 */
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const initSqlJs = require("sql.js");
const [, , inFile, outFile] = process.argv;
if (!inFile || !outFile) {
  console.error("usage: node scripts/make-nlib.mjs input.json output.nlib");
  process.exit(1);
}
const src = JSON.parse(fs.readFileSync(inFile, "utf8"));
if (!src.meta?.title) throw new Error("meta.title is required");
const SQL = await initSqlJs();
const db = new SQL.Database();
db.run(`create table meta (key text primary key, value text);
create table entries (id integer primary key, parent integer, seq integer, level text, locator text, key text, title text, text text);
create index entries_parent on entries(parent);
create index entries_key on entries(key);`);
const m = db.prepare("insert into meta values (?, ?)");
for (const [k, v] of Object.entries({ format: "nlib", version: "1", ...src.meta })) m.run([k, Array.isArray(v) ? v.join("; ") : String(v)]);
const e = db.prepare("insert into entries values (?,?,?,?,?,?,?,?)");
src.entries.forEach((x, i) => e.run([x.id ?? i + 1, x.parent ?? null, i + 1, x.level ?? null, x.locator ?? null, x.key ?? null, x.title ?? null, x.text ?? null]));
fs.writeFileSync(outFile, Buffer.from(db.export()));
console.log(`Wrote ${outFile}: ${src.entries.length} entries`);
