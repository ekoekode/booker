import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { configureSql } from "../src/scripture/sqlite";
import { commentaryLibrary } from "../src/resources/hcf";
import { buildCommentary } from "../src/sources/commentaryWrite";
import { openLiveCommentary } from "../src/scripture/esword";

const require = createRequire(import.meta.url);
const toml = (quote: string, source: string) => `[[commentary]]\nquote = '''${quote}'''\nsource_title = '${source}'\n`;

describe("Church Fathers commentary module", () => {
  it("turns a Father's passage files into notes on those verses", () => {
    const lib = commentaryLibrary("Augustine of Hippo", [{ name: "John 1_1.toml", text: toml("In the beginning was the Word", "Tractates on John") }])!;
    expect(lib.notes).toEqual([{ book: 43, chapter: 1, verse: 1, text: "Augustine of Hippo, Tractates on John\n\nIn the beginning was the Word" }]);
  });

  it("writes a commentary the Bible references window can read back", async () => {
    configureSql(async () => new Uint8Array(readFileSync(require.resolve("sql.js/dist/sql-wasm.wasm"))));
    const data = await buildCommentary("Church Fathers Commentary", "CFC", "test", [{ book: 43, chapter: 1, verse: 1, text: "Augustine\n\nThe Word" }]);
    const c = await openLiveCommentary("x.cmt.mybible", data);
    expect(c.name).toContain("Church Fathers Commentary");
    expect(c.at("John", 1, 1)).toEqual(["Augustine\n\nThe Word"]);
    expect(c.books()).toEqual(["John"]);
    c.close();
  });
});
