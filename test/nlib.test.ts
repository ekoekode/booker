import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import initSqlJs from "sql.js";
import { configureSql } from "../src/scripture/sqlite";
import { nlibChunks, readDatabase, readNlibEntries, readNlibMeta } from "../src/sources/nlib";
import { kindOfFile } from "../src/sources/library";
import { buildIndex, search } from "../src/sources/index";

const WASM = new Uint8Array(readFileSync("node_modules/sql.js/dist/sql-wasm.wasm"));
let SQL: Awaited<ReturnType<typeof initSqlJs>>;
beforeAll(async () => {
  configureSql(async () => WASM);
  SQL = await initSqlJs({ wasmBinary: WASM.buffer.slice(WASM.byteOffset, WASM.byteOffset + WASM.byteLength) as ArrayBuffer });
  FATHERS = make(fathersSql);
});
const make = (sql: string) => {
  const db = new SQL.Database();
  db.run(sql);
  const b = db.export();
  db.close();
  return b;
};

let FATHERS: Uint8Array;
const fathersSql = `
create table meta (key text primary key, value text);
insert into meta values ('format','nlib'),('version','1'),('title','On the Incarnation'),('author','Athanasius of Alexandria'),('category','fathers'),('year','1891'),('container','Nicene and Post-Nicene Fathers, Series 2, Vol. 4');
create table entries (id integer primary key, parent integer, seq integer, level text, locator text, key text, title text, text text);
insert into entries values (1,null,1,'work',null,null,'On the Incarnation',null);
insert into entries values (2,1,2,'chapter',null,null,'Chapter 1','In our former book we dealt with the creation of the world.');
insert into entries values (3,1,3,'chapter','3.1',null,'Chapter 3','The Word took a body capable of death.');
`;

describe("reference libraries (.nlib)", () => {
  it("reads the citation details", async () => {
    const m = await readNlibMeta(FATHERS);
    expect(m.title).toBe("On the Incarnation");
    expect(m.authors).toEqual(["Athanasius of Alexandria"]);
    expect(m.category).toBe("fathers");
    expect(m.container).toContain("Nicene");
  });
  it("makes locators from the tree when none is given", async () => {
    const chunks = nlibChunks(await readNlibEntries(FATHERS));
    expect(chunks.map((c) => c.loc)).toEqual(["On the Incarnation › Chapter 1", "3.1"]);
  });
  it("is searchable", async () => {
    const ix = buildIndex(nlibChunks(await readNlibEntries(FATHERS)));
    expect(search(ix, "creation world").length).toBe(1);
  });
  it("reads an e-Sword dictionary through the same door", async () => {
    const dct = make(`create table Details (Description text); insert into Details values ('Test Strongs');
      create table Dictionary (Word text, Definition text); insert into Dictionary values ('H430','<i>elohiym</i> gods');`);
    const d = await readDatabase(dct, "x");
    expect(d.meta.category).toBe("lexicon");
    expect(nlibChunks(d.entries)[0].text).toContain("gods");
  });
  it("is chosen by its file name", () => {
    expect(kindOfFile("x.nlib")).toBe("db");
    expect(kindOfFile("x.dctx")).toBe("db");
    expect(kindOfFile("x.dct.mybible")).toBe("db");
  });
  it("refuses a database that is neither", async () => {
    await expect(readDatabase(make("create table t (a text)"), "x")).rejects.toThrow();
  });
});
