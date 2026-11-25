#!/usr/bin/env node
/**
 * Build one .nlib collection from folders of per-work JSON files (the shape the extraction agents write).
 *   node scripts/build-collection.mjs --out out.nlib --title "Early Christian Writings" [--meta key=value ...]
 *        [--base existing.nlib] [--ordergroups "A,B,C"] dir1/works dir2/works ...
 * Work JSON: { title, author, translator, year, approx_date, license, source_url, group, description,
 *              entries: [ { level, title, locator, text, children: [...] } ] }.
 * Result: collection root, one group per `group`, one work per file (works sharing a slug keep the larger one).
 * With --base the existing library's entries are kept and the new groups are appended after them.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const initSqlJs = require("sql.js");

const args = process.argv.slice(2);
const opt = { meta: {}, dirs: [] };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--out") opt.out = args[++i];
  else if (a === "--title") opt.title = args[++i];
  else if (a === "--base") opt.base = args[++i];
  else if (a === "--ordergroups") opt.order = args[++i].split(",");
  else if (a === "--meta") { const [k, ...v] = args[++i].split("="); opt.meta[k] = v.join("="); }
  else opt.dirs.push(a);
}
if (!opt.out || !opt.title || !opt.dirs.length) { console.error("usage: see header"); process.exit(1); }

const words = (w) => (JSON.stringify(w.entries).match(/"text":"/g) ? JSON.stringify(w.entries).split(/\s+/).length : 0);
const chosen = new Map();
for (const dir of opt.dirs) {
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".json") && n !== "manifest.json")) {
    let w;
    try { w = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); } catch { console.error("skip unreadable", dir, f); continue; }
    if (!w.title || !Array.isArray(w.entries) || !w.entries.length) continue;
    const key = f.replace(/\.json$/, "");
    const size = words(w);
    const had = chosen.get(key);
    if (!had || size > had.size) chosen.set(key, { w, size });
  }
}

const SQL = await initSqlJs();
let db, next = 1, seq = 0;
if (opt.base) {
  db = new SQL.Database(fs.readFileSync(opt.base));
  next = db.exec("select max(id) from entries")[0].values[0][0] + 1;
  seq = db.exec("select max(seq) from entries")[0].values[0][0];
} else {
  db = new SQL.Database();
  db.run(`create table meta (key text primary key, value text);
create table entries (id integer primary key, parent integer, seq integer, level text, locator text, key text, title text, text text);
create index entries_parent on entries(parent);
create index entries_key on entries(key);`);
}
const ins = db.prepare("insert into entries values (?,?,?,?,?,?,?,?)");
const add = (parent, level, title, locator, text, key) => {
  const id = next++;
  ins.run([id, parent, ++seq, level, locator || "", key || "", title || "", text || ""]);
  return id;
};
const addTree = (parent, nodes) => {
  for (const n of nodes) {
    const id = add(parent, n.level || "section", n.title, n.locator, n.text);
    if (n.children?.length) addTree(id, n.children);
  }
};

let root;
if (opt.base) {
  root = db.exec("select id from entries where parent is null order by seq limit 1")[0].values[0][0];
} else {
  root = add(null, "collection", opt.title, "", "");
}
const groups = new Map();
for (const { w } of chosen.values()) {
  const g = w.group || "Other";
  if (!groups.has(g)) groups.set(g, []);
  groups.get(g).push(w);
}
const names = [...groups.keys()].sort((a, b) => {
  const ia = opt.order?.indexOf(a) ?? -1, ib = opt.order?.indexOf(b) ?? -1;
  return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || a.localeCompare(b);
});
let count = 0;
for (const g of names) {
  const gid = add(root, "group", g, "", "");
  for (const w of groups.get(g)) {
    const bits = [w.author && w.author !== "Anonymous" ? w.author : "", w.translator ? `trans. ${w.translator}` : "", w.approx_date ? `c. ${w.approx_date}` : "", w.license, w.source_url].filter(Boolean);
    const wid = add(gid, "work", w.title, "", [w.description, bits.join(" · ")].filter(Boolean).join("\n\n"), w.author || "");
    addTree(wid, w.entries);
    count++;
  }
}
const m = db.prepare("insert or replace into meta values (?, ?)");
for (const [k, v] of Object.entries({ format: "nlib", version: "1", ...(opt.base ? {} : { title: opt.title }), ...opt.meta })) m.run([k, v]);
fs.writeFileSync(opt.out, Buffer.from(db.export()));
console.log(`Wrote ${opt.out}: ${count} works in ${names.length} groups, ${next - 1} entries, ${(fs.statSync(opt.out).size / 1e6).toFixed(1)} MB`);
