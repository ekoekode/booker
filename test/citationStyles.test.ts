import { describe, expect, it } from "vitest";
import { styleById, STYLES } from "../src/citations/styles";
import type { Source } from "../src/sources/types";

const base = { uid: "u", citekey: "k", file: "", kind: "md" as const };
const book: Source = { ...base, type: "book", title: "Mere Christianity", authors: ["C. S. Lewis"], year: "1952", publisher: "Macmillan", place: "New York" };
const two: Source = { ...base, type: "book", title: "The Cost of Discipleship", authors: ["Dietrich Bonhoeffer", "Eberhard Bethge"], year: "1959", publisher: "SCM Press", place: "London", edition: "2nd" };
const many: Source = { ...base, type: "book", title: "Many Hands", authors: ["Ann Lee", "Bo Chen", "Cy Diaz", "Di Eng"], year: "2001", publisher: "Pub" };
const article: Source = { ...base, type: "article", title: "Grace and Works", authors: ["Mary Ann Smith"], year: "2010", container: "Journal of Theology", volume: "12", issue: "3", pages: "45-67" };
const chapter: Source = { ...base, type: "chapter", title: "On Prayer", authors: ["Jo Park"], year: "1999", container: "A Prayer Reader", editors: ["Sam Hill"], publisher: "Press", pages: "10-20", place: "Boston" };
const web: Source = { ...base, type: "web", title: "A Page", authors: [], year: "2020", container: "Example Site", url: "https://example.com" };

describe("citation styles", () => {
  it("lists four styles that all answer", () => {
    expect(STYLES.map((s) => s.id)).toEqual(["chicago", "sbl", "apa", "mla"]);
    expect(styleById("nope").id).toBe("chicago");
    for (const st of STYLES) for (const s of [book, two, many, article, chapter, web]) {
      expect(st.entry(s).length).toBeGreaterThan(5);
      expect(st.cite(s, "45", true).length).toBeGreaterThan(3);
    }
  });
  it("puts Chicago and SBL in notes and APA and MLA in the text", () => {
    expect(styleById("chicago").inline).toBe(false);
    expect(styleById("sbl").inline).toBe(false);
    expect(styleById("apa").inline).toBe(true);
    expect(styleById("mla").inline).toBe(true);
  });
  it("names the list of sources for the style", () => {
    expect(styleById("apa").bibliographyTitle).toBe("References");
    expect(styleById("mla").bibliographyTitle).toBe("Works Cited");
  });
  describe("APA 7", () => {
    const apa = styleById("apa");
    it("cites in the text", () => {
      expect(apa.cite(book, "45", true)).toBe("(Lewis, 1952, p. 45)");
      expect(apa.cite(two, "10-12", false)).toBe("(Bonhoeffer & Bethge, 1959, pp. 10–12)");
      expect(apa.cite(many, undefined, true)).toBe("(Lee et al., 2001)");
      expect(apa.cite(web, undefined, true)).toBe("(“A Page,” 2020)");
    });
    it("writes reference entries", () => {
      expect(apa.entry(book)).toBe("Lewis, C. S. (1952). *Mere Christianity*. Macmillan.");
      expect(apa.entry(two)).toBe("Bonhoeffer, D., & Bethge, E. (1959). *The Cost of Discipleship* (2nd ed.). SCM Press.");
      expect(apa.entry(article)).toBe("Smith, M. A. (2010). Grace and Works. *Journal of Theology*, *12*(3), 45–67.");
    });
  });
  describe("MLA 9", () => {
    const mla = styleById("mla");
    it("cites author and page", () => {
      expect(mla.cite(book, "45", true)).toBe("(Lewis 45)");
      expect(mla.cite(two, "p. 10-12", false)).toBe("(Bonhoeffer and Bethge 10–12)");
      expect(mla.cite(many, undefined, true)).toBe("(Lee et al.)");
    });
    it("writes works cited entries", () => {
      expect(mla.entry(book)).toBe("Lewis, C. S. *Mere Christianity*. Macmillan, 1952.");
      expect(mla.entry(article)).toBe("Smith, Mary Ann. “Grace and Works.” *Journal of Theology*, vol. 12, no. 3, 2010, pp. 45–67.");
    });
  });
  describe("SBL", () => {
    const sbl = styleById("sbl");
    it("writes a book entry", () => {
      expect(sbl.entry(book)).toBe("Lewis, C. S. *Mere Christianity*. New York: Macmillan, 1952.");
    });
    it("writes an article entry with volume.issue and pages", () => {
      expect(sbl.entry(article)).toBe("Smith, Mary Ann. “Grace and Works.” *Journal of Theology* 12.3 (2010): 45–67.");
    });
    it("writes a chapter entry with pages first", () => {
      expect(sbl.entry(chapter)).toBe("Park, Jo. “On Prayer.” Pages 10–20 in *A Prayer Reader*. Edited by Sam Hill. Boston: Press, 1999.");
    });
  });
  it("sorts by author, then year", () => {
    const apa = styleById("apa");
    const list = [two, book, web].sort(apa.sort);
    expect(list.map((s) => s.title)).toEqual(["The Cost of Discipleship", "Mere Christianity", "A Page"]);
  });
});

import { makeCiter } from "../src/citations/cite";
describe("ibid", () => {
  const mk = (uid: string) => ({ uid, citekey: uid, title: `Book ${uid}`, authors: ["Smith, Ann"], year: "2001", type: "book", kind: "md" }) as any;
  const all: Record<string, any> = { a: mk("a"), b: mk("b") };
  it("replaces a repeat of the note before, only when asked", () => {
    const c = makeCiter((k) => all[k], "chicago", { ibid: true });
    const first = c.note("a", "4")!;
    expect(first).toContain("Book a");
    expect(c.note("a", "9")).toBe("Ibid., 9.");
    expect(c.note("b", "1")).toContain("Book b");
    expect(c.note("a", "2")).not.toContain("Ibid");
    const plain = makeCiter((k) => all[k], "chicago");
    plain.note("a", "4");
    expect(plain.note("a", "9")).not.toContain("Ibid");
  });
  it("is never used in author-date styles", () => {
    const c = makeCiter((k) => all[k], "apa", { ibid: true });
    c.note("a", "4");
    expect(c.note("a", "9")).not.toContain("Ibid");
  });
});
