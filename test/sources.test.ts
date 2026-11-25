import { describe, expect, it } from "vitest";
import { bibliographyEntry, fullNote, shortNote } from "../src/citations/chicago";
import { makeCiter, replaceCitations } from "../src/citations/cite";
import { chunkParagraphs, extractEpub, extractHtml, extractPages, extractText, extractXmlText } from "../src/sources/extract";
import { formatHighlight, highlightsFile, locate, parseHighlights, removeHighlight, type Highlight } from "../src/sources/highlights";
import { citekey, lastName, uid } from "../src/sources/ids";
import { buildIndex, search, snippet } from "../src/sources/index";
import type { Source } from "../src/sources/types";
import JSZip from "jszip";

const book: Source = { uid: "1", citekey: "calvin1960", title: "Institutes of the Christian Religion: Volume One", authors: ["John Calvin"], translators: ["Ford Lewis Battles"], editors: ["John T. McNeill"], year: "1960", publisher: "Westminster Press", place: "Philadelphia", type: "book", kind: "pdf", file: "x.pdf" };
const article: Source = { uid: "2", citekey: "smith2001", title: "On Grace", authors: ["Jane Q. Smith", "Bob Jones"], container: "Journal of Theology", volume: "12", issue: "3", year: "2001", pages: "10–20", type: "article", kind: "html", file: "x.html" };

describe("ids", () => {
  it("makes sortable unique ids and citekeys", () => {
    expect(uid(1, () => 0)).toHaveLength(26);
    expect(uid(1000) < uid(2000)).toBe(true);
    expect(lastName("John Calvin Jr.")).toBe("Calvin");
    expect(lastName("Calvin, John")).toBe("Calvin");
    const taken = new Set<string>();
    expect(citekey(["John Calvin"], "x", "1559", taken)).toBe("calvin1559");
    taken.add("calvin1559");
    expect(citekey(["John Calvin"], "x", "1559", taken)).toBe("calvin1559b");
  });
});

describe("Chicago", () => {
  it("writes the full note, short note and bibliography entry of a book", () => {
    expect(fullNote(book, "45")).toBe("John Calvin, *Institutes of the Christian Religion: Volume One*, trans. Ford Lewis Battles, ed. John T. McNeill (Philadelphia: Westminster Press, 1960), 45.");
    expect(shortNote(book, "45")).toBe("Calvin, *Institutes of the Christian*, 45.");
    expect(bibliographyEntry(book)).toBe("Calvin, John. *Institutes of the Christian Religion: Volume One*. Translated by Ford Lewis Battles. Edited by John T. McNeill. Philadelphia: Westminster Press, 1960.");
  });
  it("handles articles with two authors", () => {
    expect(fullNote(article, "12")).toBe("Jane Q. Smith and Bob Jones, “On Grace,” *Journal of Theology* 12, no. 3 (2001): 12.");
    expect(shortNote(article, "12")).toBe("Smith and Jones, “On Grace,” 12.");
    expect(bibliographyEntry(article)).toBe("Smith, Jane Q., and Bob Jones. “On Grace.” *Journal of Theology* 12, no. 3 (2001): 10–20.");
  });
  it("cites in full first, short after, and lists only what was cited", () => {
    const c = makeCiter((k) => [book, article].find((s) => s.citekey === k));
    const out = replaceCitations("a[@calvin1960, 45] b[@calvin1960, 50] c[@nope]", (k, l) => c.note(k, l));
    expect(out).toContain("Philadelphia");
    expect(out).toContain("Calvin, *Institutes of the Christian*, 50.");
    expect(out).toContain("[@nope]");
    expect(c.unknown()).toEqual(["nope"]);
    expect(c.bibliography()).toHaveLength(1);
  });
});

describe("extraction", () => {
  it("chunks markdown by heading", () => {
    const ch = extractText("---\nx: 1\n---\n# One\nFirst para.\n\nSecond para.\n# Two\nOther **bold** text.", true);
    expect(ch.map((c) => c.loc)).toEqual(["One", "Two"]);
    expect(ch[1].text).toBe("Other bold text.");
  });
  it("cleans a saved web page", () => {
    const ch = extractHtml("<html><head><title>T</title><script>x()</script></head><body><nav>menu</nav><article><h1>Grace</h1><p>It is &amp; was free.</p></article><footer>f</footer></body></html>");
    expect(ch[0].loc).toBe("Grace");
    expect(ch[0].text).toContain("It is & was free.");
    expect(ch[0].text).not.toContain("menu");
  });
  it("keeps PDF page numbers", () => {
    const ch = extractPages(["page one text", "page two text"]);
    expect(ch.map((c) => [c.loc, c.page])).toEqual([["p. 1", 1], ["p. 2", 2]]);
  });
  it("reads ThML sections", () => {
    const ch = extractXmlText('<ThML><ThML.body><div1 title="Book I"><p>In the beginning <note>x</note>was.</p></div1><div1 title="Book II"><p>Second.</p></div1></ThML.body></ThML>');
    expect(ch.map((c) => c.loc)).toEqual(["Book I", "Book II"]);
    expect(ch[0].text).toBe("In the beginning was.");
  });
  it("reads an ePub in spine order", async () => {
    const z = new JSZip();
    z.file("META-INF/container.xml", '<container><rootfiles><rootfile full-path="OEBPS/c.opf"/></rootfiles></container>');
    z.file("OEBPS/c.opf", '<package><metadata><dc:title>Book</dc:title><dc:creator>Au</dc:creator></metadata><manifest><item id="a" href="a.xhtml"/><item id="b" href="b.xhtml"/></manifest><spine><itemref idref="b"/><itemref idref="a"/></spine></package>');
    z.file("OEBPS/a.xhtml", "<html><body><h1>Alpha</h1><p>aaa</p></body></html>");
    z.file("OEBPS/b.xhtml", "<html><body><h1>Beta</h1><p>bbb</p></body></html>");
    const r = await extractEpub(await z.generateAsync({ type: "uint8array" }));
    expect(r.title).toBe("Book");
    expect(r.chunks.map((c) => c.loc)).toEqual(["Beta", "Alpha"]);
  });
  it("splits huge paragraphs", () => {
    expect(chunkParagraphs(["word ".repeat(1000)], (n) => `c${n}`).length).toBeGreaterThan(2);
  });
});

describe("search", () => {
  const ix = buildIndex([
    { loc: "p. 1", text: "Predestination and election are taught in Scripture." },
    { loc: "p. 2", text: "Free will, grace and the “free grace” of God." },
    { loc: "p. 3", text: "The Hebrew word בְּרֵאשִׁית means beginning." },
  ]);
  it("finds words, prefixes, phrases and exclusions, ignoring accents and vowel points", () => {
    expect(search(ix, "grace").map((h) => h.chunk)).toEqual([1]);
    expect(search(ix, "predest").map((h) => h.chunk)).toEqual([0]);
    expect(search(ix, '"free grace"').map((h) => h.chunk)).toEqual([1]);
    expect(search(ix, "free -grace")).toEqual([]);
    expect(search(ix, "בראשית").map((h) => h.chunk)).toEqual([2]);
    expect(search(ix, "zzz")).toEqual([]);
    expect(snippet(ix.chunks[1].text, "grace")).toContain("grace");
  });
});

describe("highlights", () => {
  const h: Highlight = { uid: "H1", source: "1", loc: "p. 12", page: 12, text: "the word", prefix: "say ", suffix: " again", color: "yellow", comment: "key -- idea", created: 1 };
  it("writes, reads and removes", () => {
    const md = highlightsFile(highlightsFile("", h), { ...h, uid: "H2", text: "other" });
    expect(md).toContain("> the word\n> — p. 12");
    expect(parseHighlights(md).map((x) => x.uid)).toEqual(["H1", "H2"]);
    expect(parseHighlights(md)[0].comment).toBe("key -- idea");
    expect(parseHighlights(removeHighlight(md, "H1")).map((x) => x.uid)).toEqual(["H2"]);
    expect(formatHighlight(h).split("\n").find((l) => l.startsWith("<!--"))).not.toMatch(/-- idea/);
  });
  it("finds the right occurrence by its surroundings", () => {
    const text = "first the word here. say the word again.";
    expect(locate(text, h)).toBe(text.lastIndexOf("the word"));
    expect(locate("nothing", h)).toBe(-1);
  });
});

import { parseMarkdown, plainText } from "../src/export/model";

describe("citations in export", () => {
  it("turns [@key] into notes, full then short, and expands a footnote that holds one", () => {
    const c = makeCiter((k) => (k === "calvin1960" ? book : undefined));
    const blocks = parseMarkdown("As he says.[@calvin1960, 45] Again[^1].\n\n> Quote.[^2]\n\n[^1]: [@calvin1960, 50]\n[^2]: %%booker-hl:1:H%% see [@calvin1960, 9]", {
      lineBreaksAreParagraphs: false,
      smartQuotes: false,
      cite: (k, l) => c.note(k, l),
    });
    const notes = blocks.flatMap((b) => (b.kind === "rule" ? [] : b.runs.filter((r) => r.note).map((r) => plainText(r.note!))));
    expect(notes[0]).toMatch(/^John Calvin, Institutes of the Christian Religion: Volume One, trans\./);
    expect(notes[1]).toBe("Calvin, Institutes of the Christian, 50.");
    expect(notes[2]).toContain("Calvin, Institutes of the Christian, 9.");
    expect(c.cited()).toHaveLength(1);
  });

  it("writes APA citations in the text and titles the list References", () => {
    const c = makeCiter((k) => (k === "calvin1960" ? book : undefined), "apa");
    expect(c.inline).toBe(true);
    expect(c.bibliographyTitle).toBe("References");
    const blocks = parseMarkdown("As he says.[@calvin1960, 45]", { lineBreaksAreParagraphs: false, smartQuotes: false, cite: (k, l) => c.note(k, l), citeInline: c.inline });
    const b = blocks[0];
    if (b.kind === "rule") throw new Error("expected text");
    expect(b.runs.some((r) => r.note)).toBe(false);
    expect(plainText(b.runs)).toMatch(/^As he says\.\s*\(Calvin, 1960, p\. 45\)/);
  });
});
