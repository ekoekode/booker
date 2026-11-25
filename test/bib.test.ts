import { describe, expect, it } from "vitest";
import { naturalName, parseBibliography, parseBibtex, parseCslJson, parseRis } from "../src/sources/bib";

describe("bibliography import", () => {
  it("reads BibTeX books, articles and chapters", () => {
    const items = parseBibtex(`
@comment{ignored}
@book{calvin1559,
  author = {Calvin, John and Battles, Ford Lewis},
  title = {Institutes of the {C}hristian {R}eligion},
  publisher = "Westminster Press",
  address = {Philadelphia},
  year = 1960,
  edition = {2nd}
}
@article{k2,
  author = {M{\\"u}ller, Hans},
  title = {On Grace},
  journal = {Journal of Theology},
  volume = {12}, number = {3}, pages = {45--67}, doi = {10.1000/x}
}
@incollection{k3, author={A. Writer}, title={A Chapter}, booktitle={The Big Book}, year={2001}}`);
    expect(items.length).toBe(3);
    expect(items[0]).toMatchObject({ key: "calvin1559", title: "Institutes of the Christian Religion", authors: ["John Calvin", "Ford Lewis Battles"], year: "1960", place: "Philadelphia", type: "book", edition: "2nd" });
    expect(items[1]).toMatchObject({ type: "article", container: "Journal of Theology", pages: "45–67", volume: "12", issue: "3", url: "https://doi.org/10.1000/x" });
    expect(items[1].authors[0]).toBe("Hans Müller");
    expect(items[2]).toMatchObject({ type: "chapter", container: "The Big Book" });
  });
  it("reads RIS", () => {
    const items = parseRis(`TY  - JOUR\nAU  - Smith, Jane\nAU  - Lee, Tom\nTI  - Faith and Works\nJO  - Review\nPY  - 2010///\nVL  - 4\nSP  - 10\nEP  - 20\nER  - \n\nTY  - BOOK\nTI  - A Book\nAU  - Doe, J.\nPB  - Press\nCY  - Rome\nER  -`);
    expect(items.length).toBe(2);
    expect(items[0]).toMatchObject({ type: "article", authors: ["Jane Smith", "Tom Lee"], year: "2010", pages: "10–20", container: "Review" });
    expect(items[1]).toMatchObject({ type: "book", publisher: "Press", place: "Rome" });
  });
  it("reads CSL-JSON", () => {
    const items = parseCslJson(JSON.stringify([{ id: "x1", type: "book", title: "T", author: [{ given: "A", family: "B" }], issued: { "date-parts": [[1999]] }, publisher: "P" }]));
    expect(items[0]).toMatchObject({ key: "x1", authors: ["A B"], year: "1999", publisher: "P" });
  });
  it("picks the reader from the file name", () => {
    expect(parseBibliography("a.ris", "TY  - BOOK\nTI  - T\nER  - ").length).toBe(1);
    expect(naturalName("Doe, John")).toBe("John Doe");
  });
});
