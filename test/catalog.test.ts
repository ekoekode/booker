import { describe, expect, it } from "vitest";
import { databases, databaseOf, filterWorks, groupWorks, sortWorks, facets, workOf } from "../src/sources/catalog";
import { volumeLabel, volumesFor } from "../src/sources/volumes";
import type { Source } from "../src/sources/types";

const src = (o: Partial<Source>): Source => ({ uid: o.title ?? "x", citekey: "k", title: "T", authors: [], type: "book", kind: "db", file: "a.nlib", ...o });
const W = "Historical Christian Faith, Writings Database (ANF, NPNF and other public-domain translations)";
const C = "Historical Christian Faith, Commentaries Database";
const all = [
  src({ title: "Writings of Augustine", authors: ["Augustine of Hippo"], year: "430", container: W }),
  src({ title: "Writings of Tertullian", authors: ["Tertullian"], year: "220", container: W }),
  src({ title: "Writings of Alcuin", authors: ["Alcuin of York"], year: "804", container: W }),
  src({ title: "Commentary of Origen", authors: ["Origen of Alexandria"], year: "253", container: C, category: "commentary" }),
  src({ title: "Notes", authors: [], kind: "md", file: "n.md" }),
];

describe("volumes", () => {
  it("knows where Fathers appear", () => {
    expect(volumeLabel(volumesFor("Tertullian"))).toBe("ANF 3–4");
    expect(volumeLabel(volumesFor("Augustine of Hippo"))).toBe("NPNF1 1–8");
    expect(volumeLabel(volumesFor("Jerome"))).toBe("NPNF2 3, 6");
    expect(volumesFor("Alcuin of York")).toEqual([]);
  });
});

describe("catalog", () => {
  it("lists databases by collection", () => {
    const d = databases(all);
    expect(d.map((x) => x.label)).toEqual(["Church Fathers: Commentaries", "Church Fathers: Writings", "Documents and books"]);
    expect(d[1].count).toBe(3);
    expect(databaseOf(all[4])).toBe("Documents and books");
  });
  it("filters by database, author, volume and year", () => {
    const db = databaseOf(all[0]);
    expect(filterWorks(all, { db }).length).toBe(3);
    expect(filterWorks(all, { db, volume: "ANF 3" }).map((w) => w.author)).toEqual(["Tertullian"]);
    expect(filterWorks(all, { db, yearFrom: 400 }).map((w) => w.author).sort()).toEqual(["Alcuin of York", "Augustine of Hippo"]);
    expect(filterWorks(all, { db, text: "tertul" }).length).toBe(1);
    expect(filterWorks(all, { category: "commentary" }).length).toBe(1);
  });
  it("sorts and groups under author headings", () => {
    const list = filterWorks(all, { db: databaseOf(all[0]) });
    expect(sortWorks(list, "date").map((w) => w.year)).toEqual([220, 430, 804]);
    const g = groupWorks(sortWorks(list, "author"), "author");
    expect(g.map((x) => x.heading)).toEqual(["Alcuin of York", "Augustine of Hippo", "Tertullian"]);
    expect(groupWorks(list, "title")[0].heading).toBe("");
  });
  it("offers facets and keeps undated works out of year ranges", () => {
    const f = facets(all.map(workOf));
    expect(f.minYear).toBe(220);
    expect(f.maxYear).toBe(804);
    expect(filterWorks(all, { yearFrom: 0 }).some((w) => w.year === null)).toBe(false);
  });
});
