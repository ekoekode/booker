import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { gzipSync } from "zlib";
import { htmlToLibrary } from "../src/resources/html";
import { LibBuilder } from "../src/resources/libBuilder";
import { parseFordhamHub, parseFordhamTexts, parseTertullianIndex } from "../src/resources/catalogueSources";
import { commentaryLibrary, parseCommentary, passageOf, writingsLibrary } from "../src/resources/hcf";
import { readTarGz } from "../src/resources/tar";

const PAGE = `<html><head><title>Concerning Repentance</title><script>var x = "<p>no</p>";</script></head><body>
<nav>Home | Up</nav><h1>Book 1</h1><h2>Chapter I.</h2><i>Summary.</i><br/><br/>1. First &amp; foremost.<p>Second para.</p>
<h2>Chapter II.</h2><p>More<br>text</p><h3>Aside</h3><p>Deep.</p><h2>Chapter III.</h2><p>End.</p></body></html>`;

describe("htmlToLibrary", () => {
  const w = htmlToLibrary(PAGE);
  it("uses the first heading as the title and nests the rest by rank", () => {
    expect(w.entries.map((e) => [e.id, e.parent, e.title])).toEqual([
      [1, null, "Book 1"],
      [2, 1, "Chapter I."],
      [3, 1, "Chapter II."],
      [4, 3, "Aside"],
      [5, 1, "Chapter III."],
    ]);
  });
  it("keeps paragraphs and drops scripts and navigation", () => {
    const all = w.entries.map((e) => e.text).join("\n");
    expect(all).not.toContain("Home");
    expect(all).not.toContain("no");
    expect(w.entries[1].text).toBe("Summary.\n\n1. First & foremost.\n\nSecond para.");
    expect(w.entries[2].text).toBe("More\ntext");
  });
  it("grafts one library under another", () => {
    const b = new LibBuilder("Work");
    const id = b.graft(1, "Part", w);
    expect(b.entries[id - 1]).toMatchObject({ title: "Part", parent: 1, level: "section" });
    expect(b.entries.filter((e) => e.parent === id).map((e) => e.title)).toEqual(["Chapter I.", "Chapter II.", "Chapter III."]);
  });
});

describe("Tertullian.org index", () => {
  const html = `<h2><a name="A">Aristides the Philosopher</a></h2><p><b><a name="x">The </a></b><a name="x"><b>Apology</b></a></p>
  <ul><li><a href="aristides_01_intro.htm">Introduction</a></li><li><a href="aristides_02_trans.htm">Translation of the Greek and
  Syriac</a></li></ul><h2>Irenaeus</h2><p><b>The Proof</b></p><ul><li><p><a href="irenaeus_02_proof.htm">English translation</a></li></ul><a href="http://x.org/y.htm">no</a>`;
  it("groups pages into works under their author", () => {
    const w = parseTertullianIndex(html);
    expect(w.map((x) => [x.author, x.title, x.pages.map((p) => p.href)])).toEqual([
      ["Aristides the Philosopher", "The Apology", ["aristides_01_intro.htm", "aristides_02_trans.htm"]],
      ["Irenaeus", "The Proof", ["irenaeus_02_proof.htm"]],
    ]);
    expect(w[0].pages[1].title).toBe("Translation of the Greek and Syriac");
  });
});

describe("Fordham pages", () => {
  it("finds the topic pages on the front page and the texts on a topic page", () => {
    const hub = `<a href="/Halsall/sbook1b.asp">End of Rome</a> <a href="/Halsall/sbook1b.asp">again</a> <a href="/Halsall/sbook3.asp">Saints' Lives</a> <a href="/Halsall/search.asp">Search</a>`;
    expect(parseFordhamHub(hub).map((p) => [p.href, p.title])).toEqual([
      ["https://sourcebooks.fordham.edu/sbook1b.asp", "End of Rome"],
      ["https://sourcebooks.fordham.edu/sbook3.asp", "Saints' Lives"],
    ]);
    const page = `<a href="source/leo.asp">Leo to Flavian</a><a href="basis/x.asp">X</a><a href="http://www.newadvent.org/cathen/1.htm">N</a><a href="source/leo.asp">dup</a><a href="/Halsall/sbook1c.asp">Byzantium</a>`;
    expect(parseFordhamTexts(page, "https://sourcebooks.fordham.edu/sbook1e.asp").map((t) => t.href)).toEqual(["https://sourcebooks.fordham.edu/source/leo.asp", "https://sourcebooks.fordham.edu/basis/x.asp"]);
  });
});

describe("Church Fathers repositories", () => {
  it("reads commentary blocks", () => {
    const c = parseCommentary(`[[commentary]]\nquote='''\nFirst quote.\n'''\nsource_title = "On Genesis"\n\n[[commentary]]\nquote='''Second.'''\nappend_to_author_name=' 6:15-20'\n`);
    expect(c).toEqual([{ quote: "First quote.", source: "On Genesis", where: undefined }, { quote: "Second.", source: undefined, where: "6:15-20" }]);
  });
  it("orders passages by Bible book and verse", () => {
    expect(passageOf("Psalms 6_9-10")).toMatchObject({ book: "Psalms", ref: "Psalms 6:9-10", chapter: 6, verse: 9 });
    const lib = commentaryLibrary("Jerome", [
      { name: "John 3_16.toml", text: "[[commentary]]\nquote='''b'''\n" },
      { name: "Genesis 10_2.toml", text: "[[commentary]]\nquote='''a2'''\n" },
      { name: "Genesis 2_24.toml", text: "[[commentary]]\nquote='''a1'''\nsource_title='Letter 22'\n" },
    ])!;
    expect(lib.entries.map((e) => e.title)).toEqual(["Jerome: comments on Scripture", "Genesis", "Genesis 2:24", "Genesis 10:2", "John", "John 3:16"]);
    expect(lib.entries[2].text).toBe("a1\n— Letter 22");
  });
  it("treats a folder named for a Bible book as that book's own quotations", () => {
    const lib = commentaryLibrary("1 Corinthians", [{ name: "Genesis 2_24.toml", text: "[[commentary]]\nquote='''Flee.'''\nappend_to_author_name=' 6:15-20'\n" }])!;
    expect(lib.meta.title).toBe("1 Corinthians: passages it quotes from the Old Testament");
    expect(lib.entries[2].text).toBe("Flee.\n— 1 Corinthians 6:15-20");
    expect(commentaryLibrary("Bede", [{ name: "John 1_1.toml", text: "[[commentary]]\nquote='''x'''\n" }])!.meta.title).toBe("Bede: comments on Scripture");
  });
  it("makes one library of an author's works, folders as sections", () => {
    const lib = writingsLibrary("Ambrose", [
      { path: "Repentance/Book 10.html", html: "<h1>Book 10</h1><p>ten</p>" },
      { path: "Repentance/Book 2.html", html: "<h1>Book 2</h1><p>two</p>" },
      { path: "Luke.html", html: "<h1>Luke</h1><h2>I</h2><p>x</p>" },
    ])!;
    expect(lib.entries.map((e) => e.title)).toEqual(["Ambrose", "Luke", "I", "Repentance", "Book 2", "Book 10"]);
  });
});

function tarOf(files: Record<string, string>): Buffer {
  const parts: Buffer[] = [];
  for (const [name, body] of Object.entries(files)) {
    const h = Buffer.alloc(512);
    h.write(name, 0);
    h.write("0000644", 100);
    h.write(body.length.toString(8).padStart(11, "0"), 124);
    h[156] = 48;
    parts.push(h, Buffer.from(body), Buffer.alloc((512 - (body.length % 512)) % 512));
  }
  parts.push(Buffer.alloc(1024));
  return Buffer.concat(parts);
}

describe("readTarGz", () => {
  it("streams the wanted files without their top folder", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tar-"));
    const file = join(dir, "a.tar.gz");
    writeFileSync(file, gzipSync(tarOf({ "repo-1/A/one.html": "<p>1</p>", "repo-1/A/skip.pdf": "x".repeat(1500), "repo-1/B/two.html": "y".repeat(700) })));
    const got: [string, number][] = [];
    for await (const f of readTarGz(file, (n) => n.endsWith(".html"))) got.push([f.name, f.data.length]);
    expect(got).toEqual([["A/one.html", 8], ["B/two.html", 700]]);
  });
});
