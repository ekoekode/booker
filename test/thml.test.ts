import { describe, expect, it } from "vitest";
import { thmlToLibrary } from "../src/resources/thml";
import { ccelFileName, ccelXmlUrl, estimateSeconds, formatDuration, parseCcelList } from "../src/resources/ccel";

const XML = `<?xml version="1.0"?>
<ThML><ThML.head>
<generalInfo><description>A <i>short</i> book.<br />CCEL Staff</description><firstPublished>1945</firstPublished></generalInfo>
<DC><DC.Title>Hymns &amp; Songs</DC.Title><DC.Creator sub="Author" scheme="file-as">Aaberg, J. C.</DC.Creator><DC.Creator sub="Editor">Someone</DC.Creator></DC>
</ThML.head>
<ThML.body>
<div1 title="Foreword" id="f"><p>First <i>para</i> of the &ldquo;foreword&rdquo;.</p><p>Second para.<note id="n1">A footnote.</note></p></div1>
<div1 title="Part One" id="p1"><div2 title="Chapter A" id="a"><p>Chapter text<br/>with a line break.</p></div2><div2 title="Chapter B" id="b"><p>More &#8212; text.</p></div2></div1>
</ThML.body></ThML>`;

describe("thmlToLibrary", () => {
  const w = thmlToLibrary(XML);
  it("reads the title, authors, year and description", () => {
    expect(w.meta.title).toBe("Hymns & Songs");
    expect(w.meta.authors).toEqual(["Aaberg, J. C."]);
    expect(w.meta.year).toBe("1945");
    expect(w.meta.description).toContain("short book.");
  });
  it("builds a tree of sections from the numbered divs", () => {
    expect(w.entries.map((e) => [e.id, e.parent, e.title])).toEqual([
      [1, null, "Hymns & Songs"],
      [2, 1, "Foreword"],
      [3, 1, "Part One"],
      [4, 3, "Chapter A"],
      [5, 3, "Chapter B"],
    ]);
  });
  it("keeps paragraphs, line breaks, entities and footnotes as plain text", () => {
    expect(w.entries[1].text).toBe("First para of the “foreword”.\n\nSecond para. [A footnote.]");
    expect(w.entries[3].text).toBe("Chapter text\nwith a line break.");
    expect(w.entries[4].text).toBe("More — text.");
    expect(w.entries[2].text).toBe("");
  });
  it("falls back to the given title and one block of text when there are no divs", () => {
    const x = thmlToLibrary("<ThML><ThML.body><p>Only text.</p></ThML.body></ThML>", "Fallback");
    expect(x.meta.title).toBe("Fallback");
    expect(x.entries).toHaveLength(1);
    expect(x.entries[0].text).toBe("Only text.");
  });
});

describe("ccel catalogue", () => {
  const html = `<ul><p class="List2"><a href="/ccel/aaberg/hymnsdenmark.html">Hymns and Hymnwriters of Denmark
 </a><span class="authorName">(<a href="/ccel/aaberg">J. C. Aaberg</a>)</span></p>
 <p class="List2"><a href="/ccel/abelard/misfortunes.html">Historia Calamitatum</a><span class="authorName">(<a href="/ccel/abelard">Peter Abelard</a>)</span></p>
 <p><a href="/ccel/aaberg/hymnsdenmark.html">again</a></p></ul>`;
  const works = parseCcelList(html);
  it("lists each work once with its author", () => {
    expect(works).toEqual([
      { author: "aaberg", work: "hymnsdenmark", title: "Hymns and Hymnwriters of Denmark", authorName: "J. C. Aaberg" },
      { author: "abelard", work: "misfortunes", title: "Historia Calamitatum", authorName: "Peter Abelard" },
    ]);
  });
  it("knows where the ThML file is and what to call the library", () => {
    expect(ccelXmlUrl(works[0])).toBe("https://ccel.org/ccel/a/aaberg/hymnsdenmark.xml");
    expect(ccelFileName(works[1])).toBe("Peter Abelard - Historia Calamitatum.nlib");
  });
  it("estimates the time at CCEL's pace", () => {
    expect(formatDuration(estimateSeconds(1310))).toMatch(/hours/);
    expect(formatDuration(30)).toBe("30 seconds");
  });
});
