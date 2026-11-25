import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { configureSql } from "../src/scripture/sqlite";
import { buildNlib } from "../src/sources/nlibWrite";
import { readNlibEntries, readNlibMeta } from "../src/sources/nlib";
import { thmlToLibrary } from "../src/resources/thml";

const require = createRequire(import.meta.url);

describe("buildNlib", () => {
  it("writes a library the reader can read back", async () => {
    configureSql(async () => new Uint8Array(readFileSync(require.resolve("sql.js/dist/sql-wasm.wasm"))));
    const w = thmlToLibrary(`<ThML><ThML.head><DC.Title>T</DC.Title></ThML.head><ThML.body><div1 title="One"><p>Hello.</p></div1><div1 title="Two"><p>World.</p></div1></ThML.body></ThML>`);
    const bytes = await buildNlib({ title: w.meta.title, authors: ["A B"], category: "classics", container: "CCEL" }, w.entries);
    const meta = await readNlibMeta(bytes);
    expect(meta).toMatchObject({ title: "T", authors: ["A B"], category: "classics", container: "CCEL" });
    const rows = await readNlibEntries(bytes);
    expect(rows.map((r) => [r.title, r.text])).toEqual([["T", ""], ["One", "Hello."], ["Two", "World."]]);
  });
});
