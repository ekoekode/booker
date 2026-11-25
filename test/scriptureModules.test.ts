import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import initSqlJs from "sql.js";
import { configureSql } from "../src/scripture/sqlite";
import { LockedModuleError, entryText, readEswordBible, openLiveCommentary, readEswordCommentary, readEswordDictionary } from "../src/scripture/esword";
import { parseMarkup, plain } from "../src/scripture/module";
import { readXmlBible } from "../src/scripture/xml";

const WASM = new Uint8Array(readFileSync("node_modules/sql.js/dist/sql-wasm.wasm"));
let SQL: Awaited<ReturnType<typeof initSqlJs>>;

beforeAll(async () => {
  configureSql(async () => WASM);
  SQL = await initSqlJs({ wasmBinary: WASM.buffer.slice(WASM.byteOffset, WASM.byteOffset + WASM.byteLength) as ArrayBuffer });
});

const dbBytes = (sqlText: string) => {
  const db = new SQL.Database();
  db.run(sqlText);
  const out = db.export();
  db.close();
  return out;
};

describe("verse markup", () => {
  it("keeps italics and words of Jesus, drops notes, Strong's numbers and titles", () => {
    const segs = parseMarkup("<TS>Heading<Ts>In the <FI>beginning<Fi> God<WH430> said, <FR>Let there be<Fr> light.<RF>a note<Rf><CM>");
    expect(plain(segs)).toBe("In the beginning God said, Let there be light.");
    expect(segs.find((s) => s.t === "beginning")?.i).toBe(true);
    expect(segs.find((s) => /Let there/.test(s.t))?.jesus).toBe(true);
  });
  it("reads the HTML-style markup some MySword modules use", () => {
    const segs = parseMarkup('He said <font color="red">Follow me</font> and <i>went</i> &amp; sat.');
    expect(plain(segs)).toBe("He said Follow me and went & sat.");
    expect(segs.some((s) => s.jesus)).toBe(true);
    expect(segs.some((s) => s.i)).toBe(true);
  });
});

describe("e-Sword and MySword modules", () => {
  const bible = () =>
    dbBytes(`
      create table Details (Description text, Abbreviation text, Comments text, Version text, RightToLeft integer);
      insert into Details values ('Test Version', 'TV', '', '1', 0);
      create table Bible (Book integer, Chapter integer, Verse integer, Scripture text);
      insert into Bible values (43, 3, 16, 'For God so <FI>loved<Fi> the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.');
      insert into Bible values (43, 3, 17, 'For God sent not his Son into the world to condemn the world; but that the world through him might be saved.');
      insert into Bible values (1, 1, 1, 'In the beginning God created the heaven and the earth.');
      insert into Bible values (19, 23, 1, 'The LORD is my shepherd; I shall not want.');
    `);

  it("reads a .bblx Bible", async () => {
    const m = await readEswordBible("test.bblx", bible());
    expect(m.name).toBe("Test Version");
    expect(m.abbr).toBe("TV");
    expect(m.books()).toEqual(["Gen", "Ps", "John"]);
    expect(plain(m.verse("John", 3, 16)!)).toMatch(/^For God so loved the world/);
    expect(m.verse("John", 3, 16)!.some((s) => s.i)).toBe(true);
    expect(m.verseCount("John", 3)).toBe(17);
    expect(m.chapterCount("John")).toBe(3);
    expect(m.verse("John", 9, 9)).toBeNull();
  });
  it("searches by words", async () => {
    const m = await readEswordBible("test.bblx", bible());
    expect(m.search(["god", "world"], 10)).toEqual([{ book: "John", c: 3, v: 16 }, { book: "John", c: 3, v: 17 }]);
    expect(m.search(["shepherd"], 10)).toEqual([{ book: "Ps", c: 23, v: 1 }]);
    expect(m.search(["zzz"], 10)).toEqual([]);
  });
  it("says so plainly when a file is locked or not a database", async () => {
    await expect(readEswordBible("x", new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).rejects.toBeInstanceOf(LockedModuleError);
    await expect(readEswordBible("x", dbBytes("create table Other (a text);"))).rejects.toBeInstanceOf(LockedModuleError);
  });
  it("reads a commentary and a dictionary", async () => {
    const c = await readEswordCommentary(
      "c.cmtx",
      dbBytes(`create table Details (Description text); insert into Details values ('Comm');
        create table Commentary (Book integer, ChapterBegin integer, VerseBegin integer, ChapterEnd integer, VerseEnd integer, Comments text);
        insert into Commentary values (43, 3, 14, 3, 18, '<b>Note</b> on the passage.<br>Second.');`)
    );
    expect(c.name).toBe("Comm");
    expect(c.at("John", 3, 16)).toEqual(["Note on the passage.\n\nSecond."]);
    expect(c.at("John", 4, 1)).toEqual([]);
    const d = await readEswordDictionary(
      "d.dctx",
      dbBytes(`create table Dictionary (Word text, Definition text);
        insert into Dictionary values ('H430', '<i>elohim</i>: God, gods');`)
    );
    expect(d.entries).toEqual([{ word: "H430", text: "<i>elohim</i>: God, gods" }]);
    expect(entryText(d.entries[0].text)).toBe("elohim: God, gods");
  });
});

describe("live commentary", () => {
  it("finds notes whose range covers the verse, including whole-chapter ranges", async () => {
    const c = await openLiveCommentary(
      "c",
      dbBytes(`create table Details (Description text); insert into Details values ('Live');
        create table Commentary (Book integer, ChapterBegin integer, VerseBegin integer, ChapterEnd integer, VerseEnd integer, Comments text);
        insert into Commentary values (43, 3, 14, 3, 18, 'range');
        insert into Commentary values (43, 3, 16, 3, 16, 'single');
        insert into Commentary values (43, 2, 25, 4, 0, 'across chapters');
        insert into Commentary values (43, 5, 1, 5, 2, 'elsewhere');
        insert into Commentary values (44, 3, 16, 3, 16, 'other book');`)
    );
    expect(c.name).toBe("Live");
    expect(c.at("John", 3, 16).sort()).toEqual(["across chapters", "range", "single"]);
    expect(c.at("John", 5, 1)).toEqual(["elsewhere"]);
    expect(c.at("John", 6, 1)).toEqual([]);
    c.close();
  });
});

describe("live commentary as a book", () => {
  it("lists books and chapters and reads a whole chapter in order", async () => {
    const c = await openLiveCommentary(
      "c",
      dbBytes(`create table Commentary (Book integer, ChapterBegin integer, VerseBegin integer, ChapterEnd integer, VerseEnd integer, Comments text);
        insert into Commentary values (43, 3, 16, 3, 16, 'sixteen');
        insert into Commentary values (43, 3, 1, 3, 15, 'start');
        insert into Commentary values (43, 1, 0, 1, 0, 'intro');
        insert into Commentary values (1, 2, 1, 2, 3, 'genesis');`)
    );
    expect(c.books()).toEqual(["Gen", "John"]);
    expect(c.chapters("John")).toEqual([1, 3]);
    expect(c.chapterRows("John", 3).map((r) => [r.from, r.to, r.text])).toEqual([[1, 15, "start"], [16, 16, "sixteen"]]);
    expect(c.chapterRows("John", 2)).toEqual([]);
    c.close();
  });
});

describe("XML Bibles", () => {
  it("reads OSIS with container verses, milestones, notes and words of Jesus", () => {
    const osis = `<?xml version="1.0"?><osis><osisText osisIDWork="T"><header><work osisWork="TST"><title>Test OSIS</title></work></header>
      <div type="book" osisID="John"><chapter osisID="John.3">
        <verse osisID="John.3.16">For God so <transChange type="added">loved</transChange> the world<note>skip me</note>.</verse>
        <verse sID="John.3.17"/>Jesus said, <q who="Jesus">God sent not his Son.</q><verse eID="John.3.17"/>
      </chapter></div>
      <div type="book" osisID="Tob"><chapter osisID="Tob.1"><verse osisID="Tob.1.1">The book of the words of Tobit.</verse></chapter></div>
    </osisText></osis>`;
    const m = readXmlBible("t.osis.xml", osis);
    expect(plain(m.verse("John", 3, 16)!)).toBe("For God so loved the world.");
    expect(m.verse("John", 3, 16)!.some((s) => s.i)).toBe(true);
    expect(plain(m.verse("John", 3, 17)!)).toBe("Jesus said, God sent not his Son.");
    expect(m.verse("John", 3, 17)!.some((s) => s.jesus)).toBe(true);
    expect(plain(m.verse("Tob", 1, 1)!)).toMatch(/Tobit/);
    expect(m.name).toBe("Test OSIS");
    expect(m.abbr).toBe("TST");
  });
  it("reads Zefania", () => {
    const z = `<XMLBIBLE biblename="Zef Test"><INFORMATION><title>Zef Test</title></INFORMATION>
      <BIBLEBOOK bnumber="1" bname="Genesis"><CHAPTER cnumber="1"><VERS vnumber="1">In the beginning <STYLE css="font-style:italic">God</STYLE> created<NOTE>n</NOTE>.</VERS><VERS vnumber="2">And the earth was void.</VERS></CHAPTER></BIBLEBOOK></XMLBIBLE>`;
    const m = readXmlBible("z.xml", z);
    expect(m.name).toBe("Zef Test");
    expect(plain(m.verse("Gen", 1, 1)!)).toBe("In the beginning God created.");
    expect(m.verseCount("Gen", 1)).toBe(2);
  });
  it("reads USFX", () => {
    const u = `<usfx><book id="JHN"><h>John</h><c id="3"/><p><v id="16"/>For God so <add>loved</add> the world<f>skip</f>.<ve/><v id="17"/><wj>God sent not.</wj><ve/></p></book></usfx>`;
    const m = readXmlBible("u.xml", u);
    expect(plain(m.verse("John", 3, 16)!)).toBe("For God so loved the world.");
    expect(m.verse("John", 3, 17)![0].jesus).toBe(true);
  });
  it("refuses an XML file of another kind", () => {
    expect(() => readXmlBible("x", "<html></html>")).toThrow();
  });
  it("names a Bible with no title by its file name, not its vault path", () => {
    const xml = `<usfx><book id="JHN"><c id="3"/><v id="16"/>For God so loved.</book></usfx>`;
    expect(readXmlBible("Booker/Library/Bibles/zz_bible.usfx.xml", xml).name).toBe("zz bible");
  });
});
