import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import initSqlJs from "sql.js";
import { configureSql } from "../src/scripture/sqlite";
import { classify, isSqliteHeader, refineSqlite, SUPPORTED_KINDS } from "../src/library/classify";
import { applyNav, describeDatabase, parseMap, readMappedEntries, suggestMapping } from "../src/sources/dbmap";
import { inLibrary, LIB_BIBLES, LIB_DATABASES, LIB_DOCUMENTS } from "../src/library/paths";

const WASM = new Uint8Array(readFileSync("node_modules/sql.js/dist/sql-wasm.wasm"));
let SQL: Awaited<ReturnType<typeof initSqlJs>>;
beforeAll(async () => {
  configureSql(async () => WASM);
  SQL = await initSqlJs({ wasmBinary: WASM.buffer.slice(WASM.byteOffset, WASM.byteOffset + WASM.byteLength) as ArrayBuffer });
});
const make = (sql: string) => {
  const db = new SQL.Database();
  db.run(sql);
  const b = db.export();
  db.close();
  return b;
};
const enc = (s: string) => new TextEncoder().encode(s);

describe("classify", () => {
  it("sorts Bibles, commentaries and libraries by their extension", () => {
    expect(classify("BSB.bbl.mybible")).toMatchObject({ kind: "bible", folder: "Bibles", module: true });
    expect(classify("Matthew Henry.cmtx")).toMatchObject({ kind: "commentary", folder: "Bibles" });
    expect(classify("Fathers.nlib")).toMatchObject({ kind: "library", folder: "Databases", sourceKind: "db" });
    expect(classify("Strongs.dct.mybible")).toMatchObject({ kind: "lexicon", folder: "Databases", sourceKind: "db" });
    expect(classify("kjv.usfx")).toMatchObject({ kind: "bible" });
  });
  it("tells a Bible XML file from a TEI one by what is inside", () => {
    expect(classify("a.xml", enc('<?xml version="1.0"?><osis xmlns="x">')).kind).toBe("bible");
    expect(classify("a.xml", enc("<XMLBIBLE biblename='x'>")).kind).toBe("bible");
    expect(classify("a.xml", enc("<TEI><text/></TEI>"))).toMatchObject({ kind: "document", sourceKind: "xml" });
  });
  it("sends documents to Documents and Word to conversion", () => {
    for (const n of ["a.pdf", "a.epub", "a.html", "a.md", "a.txt"]) expect(classify(n)).toMatchObject({ kind: "document", folder: "Documents" });
    expect(classify("a.docx")).toMatchObject({ kind: "convert", folder: "Documents", sourceKind: "md" });
  });
  it("recognises an unnamed SQLite file by its header and refuses the rest", () => {
    const head = enc("SQLite format 3\0........");
    expect(isSqliteHeader(head)).toBe(true);
    expect(classify("mystery.bin", head).kind).toBe("sqlite");
    expect(classify("a.exe")).toMatchObject({ kind: "unsupported", folder: null });
    expect(classify("refs.bib")).toMatchObject({ kind: "bibliography" });
    expect(classify("refs.ris")).toMatchObject({ kind: "bibliography" });
  });
  it("lets the tables settle what a SQLite file is", () => {
    const c = classify("x.mybible", enc("SQLite format 3\0"));
    expect(refineSqlite(c, ["Bible", "Details"]).kind).toBe("bible");
    expect(refineSqlite(c, ["entries", "meta"]).kind).toBe("library");
    expect(refineSqlite(c, ["Commentary"]).kind).toBe("commentary");
    expect(refineSqlite(c, ["Dictionary"]).kind).toBe("lexicon");
    expect(refineSqlite(c, ["recipes"]).kind).toBe("sqlite");
  });
  it("lists where every supported kind is kept", () => {
    expect(SUPPORTED_KINDS.map((k) => k.keptIn)).toEqual(expect.arrayContaining(["Bibles", "Databases", "Documents"]));
    expect(inLibrary(`${LIB_BIBLES}/a.bblx`) && inLibrary(`${LIB_DATABASES}/x`) && inLibrary(`${LIB_DOCUMENTS}/y`)).toBe(true);
    expect(inLibrary("Sources/Old/old.pdf") && inLibrary("Booker/Bibles/b.bblx")).toBe(true);
    expect(inLibrary("Projects/Book/scene.md")).toBe(false);
  });
});

describe("database field mapping", () => {
  const odd = () =>
    make(`create table topics (rowid_ integer primary key, heading text, body text, parent_id integer, sortorder integer);
      insert into topics values (1,'Grace','<p>Unmerited favour.</p>',null,1),(2,'Mercy','Not getting what we deserve.',1,2);
      create table notes (n integer, memo text);`);

  it("guesses the table and columns from their names", async () => {
    const guess = suggestMapping(await describeDatabase(odd()));
    expect(guess?.table).toBe("topics");
    expect(guess?.columns).toMatchObject({ title: "heading", text: "body", parent: "parent_id", order: "sortorder" });
  });
  it("reads entries through a mapping, with markup stripped and the tree kept", async () => {
    const guess = suggestMapping(await describeDatabase(odd()))!;
    const e = await readMappedEntries(odd(), guess);
    expect(e.map((x) => [x.id, x.parent, x.title, x.text])).toEqual([[1, null, "Grace", "Unmerited favour."], [2, 1, "Mercy", "Not getting what we deserve."]]);
  });
  it("only uses columns that exist, so a bad mapping cannot reach the query", async () => {
    const e = await readMappedEntries(odd(), { table: "topics", columns: { title: "heading; drop table topics", text: "body" }, nav: { title: true, key: true, locator: true } });
    expect(e[0].title).toBe("");
    expect(e[0].text).toBe("Unmerited favour.");
    await expect(readMappedEntries(odd(), { table: "missing", columns: { text: "x" }, nav: { title: true, key: true, locator: true } })).rejects.toThrow();
  });
  it("switches fields off for browsing but never all of them", () => {
    const entries = [{ id: 1, parent: null, level: "entry", locator: "1.1", key: "k", title: "T", text: "x" }];
    expect(applyNav(entries, { title: false, key: true, locator: false })[0]).toMatchObject({ title: "", key: "k", locator: "" });
    expect(applyNav(entries, { title: false, key: false, locator: false })).toBe(entries);
  });
  it("reads a saved map and falls back to defaults for what is missing", () => {
    expect(parseMap('{"table":"t","columns":{"text":"c","bogus":"z"},"nav":{"key":false}}')).toEqual({ table: "t", columns: { text: "c" }, nav: { title: true, key: false, locator: true } });
    expect(parseMap("not json")).toBeNull();
  });
});

import { sourceNoteInfo } from "../src/library/importer";
describe("source notes in a dropped folder", () => {
  it("reads the uid, file and kind of a Booker source note", () => {
    const note = '---\ntype: source\nuid: "01ABC"\ncitekey: "x"\nkind: db\nfile: "Sources/Old/Old.nlib"\n---\n\nNotes.';
    expect(sourceNoteInfo(note)).toEqual({ uid: "01ABC", file: "Sources/Old/Old.nlib", kind: "db" });
    expect(sourceNoteInfo("---\ntype: scene\n---\n")).toBeNull();
    expect(sourceNoteInfo("no frontmatter")).toBeNull();
  });
});

import { planSourceMoves } from "../src/library/migrate";
describe("moving the old library", () => {
  it("sends database folders to Databases and the rest to Documents", () => {
    const m = planSourceMoves(["Sources/Fathers", "Sources/Paper", "Sources/Imported"], new Set(["Sources/Fathers"]));
    expect(m).toEqual([
      { from: "Sources/Fathers", to: "Booker/Library/Databases/Fathers" },
      { from: "Sources/Paper", to: "Booker/Library/Documents/Paper" },
      { from: "Sources/Imported", to: "Booker/Library/Documents/Imported" },
    ]);
  });
});

import { importIncoming } from "../src/library/importer";
describe("dropping a folder from another Booker", () => {
  const note = (uid: string) => new TextEncoder().encode(`---\ntype: source\nuid: "${uid}"\nkind: db\nfile: "Sources/Other/Other.nlib"\n---\n\nNotes.`).buffer as ArrayBuffer;
  const fake = (known: string[]) => {
    const written: string[] = [];
    const dirs = new Set<string>();
    const plugin: any = {
      sources: () => known.map((uid) => ({ uid })),
      events: { trigger: () => undefined },
      app: { vault: { adapter: { exists: async (p: string) => dirs.has(p), mkdir: async (p: string) => void dirs.add(p), writeBinary: async (p: string) => void written.push(p) } } },
    };
    return { plugin, written };
  };
  const dropped = (uid: string) => [
    { name: "Other.md", rel: "Other/Other.md", data: note(uid) },
    { name: "Other.nlib", rel: "Other/Other.nlib", data: new ArrayBuffer(8) },
  ];
  it("copies the folder with its notes when the source is new", async () => {
    const { plugin, written } = fake([]);
    const r = await importIncoming(plugin, dropped("NEW1"));
    expect(r).toEqual([{ name: "Other", status: "added", message: "Copied with its notes to Booker/Library/Databases/Other." }]);
    expect(written.sort()).toEqual(["Booker/Library/Databases/Other/Other.md", "Booker/Library/Databases/Other/Other.nlib"]);
  });
  it("skips a folder whose source is already in the library", async () => {
    const { plugin, written } = fake(["OLD1"]);
    const r = await importIncoming(plugin, dropped("OLD1"));
    expect(r[0]).toMatchObject({ status: "skipped" });
    expect(written).toEqual([]);
  });
});
