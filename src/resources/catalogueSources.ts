/**
 * Websites Booker can turn into libraries one item at a time. Each source says how to list its items and how to fetch and convert one;
 * the app and the terminal script drive them the same way, with the same pacing and robots.txt rules. Pure apart from `ctx`.
 */
import { Cancelled } from "./fetcher";
import { CCEL_LIST_URL, ccelFileName, ccelPageUrl, ccelXmlUrl, parseCcelList } from "./ccel";
import { htmlToLibrary } from "./html";
import { LibBuilder } from "./libBuilder";
import { decodeEntities, thmlToLibrary, type LibEntry } from "./thml";
import type { NlibWriteMeta } from "../sources/nlibWrite";

export interface CatItem {
  id: string;
  title: string;
  /** a second line: the author, the period */
  note: string;
  /** the file the library is saved as */
  fileName: string;
  /** web requests it takes (for the time estimate) */
  requests: number;
  /** whatever the source needs to fetch it, kept with the cached list */
  data?: unknown;
}

export interface SourceCtx {
  /** read a page as text, paced and checked against robots.txt */
  text(url: string): Promise<string>;
  /** a status line shown in the background task */
  say(detail: string): void;
}

export interface Built {
  meta: NlibWriteMeta;
  entries: LibEntry[];
}

export interface CatalogueSource {
  id: string;
  title: string;
  origin: string;
  /** shown above the picker */
  intro: string;
  license: string;
  /** the task's title and the picker's word for one item */
  noun: string;
  list(ctx: SourceCtx): Promise<CatItem[]>;
  build(ctx: SourceCtx, item: CatItem): Promise<Built>;
}

const tidy = (s: string) => decodeEntities(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const safeName = (s: string) => s.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim().slice(0, 120);

// ------------------------------------------------------------------ CCEL

export const ccelSource: CatalogueSource = {
  id: "ccel",
  title: "Christian Classics Ethereal Library",
  origin: "https://ccel.org",
  intro: "CCEL asks programs to wait 10 seconds between requests, so each work takes about 11 seconds. CCEL's editions are mostly public domain, but CCEL claims the formatting: for your own use.",
  license: "Mostly public domain; CCEL claims its formatting. Personal and non-profit use.",
  noun: "CCEL works",
  async list(ctx) {
    ctx.say("Reading CCEL's catalogue");
    const works = parseCcelList(await ctx.text(CCEL_LIST_URL));
    if (!works.length) throw new Error("The CCEL catalogue page had no works in it; its layout may have changed.");
    return works.map((w) => ({ id: `${w.author}/${w.work}`, title: w.title, note: w.authorName, fileName: ccelFileName(w), requests: 1, data: w }));
  },
  async build(ctx, item) {
    const w = item.data as { author: string; work: string; title: string; authorName: string };
    const lib = thmlToLibrary(await ctx.text(ccelXmlUrl(w)), w.title);
    return {
      meta: { title: w.title || lib.meta.title, authors: w.authorName ? [w.authorName] : lib.meta.authors.slice(0, 1), category: "classics", container: "Christian Classics Ethereal Library", year: lib.meta.year, url: ccelPageUrl(w), license: "CCEL edition; mostly public domain in the US", description: lib.meta.description },
      entries: lib.entries,
    };
  },
};

// ------------------------------------------------------------------ Tertullian.org

const TERT = "https://www.tertullian.org/fathers/";

export interface TertPage {
  href: string;
  title: string;
}

export interface TertWork {
  author: string;
  title: string;
  pages: TertPage[];
}

/** The works on Roger Pearse's index: an author heading, a work title in bold, then its pages. */
export function parseTertullianIndex(html: string): TertWork[] {
  const works: TertWork[] = [];
  let author = "";
  let cur: TertWork | null = null;
  const seen = new Set<string>();
  const re = /<h2[^>]*>([\s\S]*?)<\/h2>|<p[^>]*>\s*(<b>[\s\S]*?)<\/p>|<a\s[^>]*href="([a-z0-9_.-]+\.htm)"[^>]*>([\s\S]*?)<\/a>/gi;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    if (m[1] !== undefined) {
      author = tidy(m[1]);
      cur = null;
    } else if (m[2] !== undefined) {
      cur = { author, title: tidy(m[2]), pages: [] };
      works.push(cur);
    } else if (m[3] !== undefined && m[3] !== "index.htm" && !seen.has(m[3])) {
      if (!cur) {
        cur = { author, title: author || "Texts", pages: [] };
        works.push(cur);
      }
      seen.add(m[3]);
      cur.pages.push({ href: m[3], title: tidy(m[4]) || m[3] });
    }
  }
  return works.filter((w) => w.pages.length);
}

export const tertullianSource: CatalogueSource = {
  id: "tertullian",
  title: "Tertullian.org additional Fathers",
  origin: "https://www.tertullian.org",
  intro: "Roger Pearse's translations of Fathers and early texts. Each work is a handful of pages; Booker waits 1.5 seconds between requests. Most of this is already inside the Church Fathers: Writings database, so you may not need it.",
  license: "Mostly public domain; check each page for its translator's terms",
  noun: "works",
  async list(ctx) {
    ctx.say("Reading the Tertullian.org index");
    const works = parseTertullianIndex(await ctx.text(`${TERT}index.htm`));
    const used = new Set<string>();
    return works.map((w) => {
      let id = `${w.author} - ${w.title}`;
      for (let n = 2; used.has(id); n++) id = `${w.author} - ${w.title} (${n})`;
      used.add(id);
      return { id, title: w.title, note: w.author, fileName: `${safeName(id)}.nlib`, requests: w.pages.length, data: w };
    });
  },
  async build(ctx, item) {
    const w = item.data as TertWork;
    const b = new LibBuilder(w.title);
    for (const [i, p] of w.pages.entries()) {
      ctx.say(`${w.title}: page ${i + 1} of ${w.pages.length}`);
      const doc = htmlToLibrary(await ctx.text(TERT + p.href), p.title);
      b.graft(1, p.title, doc);
    }
    return { meta: { title: w.title, authors: w.author ? [w.author] : [], category: "classics", container: "Tertullian.org (Roger Pearse)", url: `${TERT}index.htm`, license: "Mostly public domain; see tertullian.org" }, entries: b.entries };
  },
};

// ------------------------------------------------------------------ Fordham

const FORDHAM = "https://sourcebooks.fordham.edu/";

export interface FordhamPeriod {
  href: string;
  title: string;
}

/** The topic pages linked from the Medieval Sourcebook's front page. */
export function parseFordhamHub(html: string, base = `${FORDHAM}sbook.asp`): FordhamPeriod[] {
  const out: FordhamPeriod[] = [];
  const seen = new Set<string>();
  const re = /<a[^>]+href="([^"#]*sbook(?:1[a-z]+|2|3|-law)\.asp)"[^>]*>([\s\S]*?)<\/a>/gi;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const href = new URL(m[1], base).href.replace(/\/Halsall\//, "/");
    const title = tidy(m[2]);
    if (seen.has(href) || !title) continue;
    seen.add(href);
    out.push({ href, title });
  }
  return out;
}

/** Links to the texts themselves on a topic page: the `source/` and `basis/` pages. */
export function parseFordhamTexts(html: string, base: string): TertPage[] {
  const out: TertPage[] = [];
  const seen = new Set<string>();
  const re = /<a[^>]+href="([^"#]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    let url: URL;
    try {
      url = new URL(m[1], base);
    } catch {
      continue;
    }
    if (url.host !== "sourcebooks.fordham.edu" || !/\/(?:source|basis)\/[^/]+\.asp$/i.test(url.pathname) || seen.has(url.pathname.toLowerCase())) continue;
    const title = tidy(m[2]);
    if (!title) continue;
    seen.add(url.pathname.toLowerCase());
    out.push({ href: url.href.replace(/\/Halsall\//, "/"), title });
  }
  return out;
}

export const fordhamSource: CatalogueSource = {
  id: "fordham",
  title: "Internet Medieval Sourcebook (Fordham)",
  origin: "https://sourcebooks.fordham.edu",
  intro: "Fordham's collection of medieval texts, one library per topic page (the End of Rome, Islam, the Crusades…), each text a section. A topic page holds dozens to hundreds of texts and Booker waits 2 seconds between requests, so a topic takes a few minutes. Fordham asks you not to republish its pages: for your own study.",
  license: "Mostly public domain texts; Fordham's pages are for personal and classroom use",
  noun: "topics",
  async list(ctx) {
    ctx.say("Reading the Sourcebook's front page");
    const periods = parseFordhamHub(await ctx.text(`${FORDHAM}sbook.asp`));
    if (!periods.length) throw new Error("The Sourcebook's front page had no topic pages in it; its layout may have changed.");
    return periods.map((p) => ({ id: p.href, title: p.title, note: "Medieval Sourcebook topic", fileName: `Fordham - ${safeName(p.title)}.nlib`, requests: 60, data: p }));
  },
  async build(ctx, item) {
    const p = item.data as FordhamPeriod;
    ctx.say(`${p.title}: reading the list`);
    const texts = parseFordhamTexts(await ctx.text(p.href), p.href);
    if (!texts.length) throw new Error("no texts found on the page");
    const b = new LibBuilder(`Internet Medieval Sourcebook: ${p.title}`);
    let n = 0;
    for (const t of texts) {
      ctx.say(`${p.title}: ${++n} of ${texts.length}`);
      try {
        b.graft(1, t.title, htmlToLibrary(await ctx.text(t.href), t.title));
      } catch (e) {
        if (e instanceof Cancelled) throw e;
        // one text that will not load should not lose the topic
      }
    }
    if (b.entries.length <= 1) throw new Error("none of its texts could be fetched");
    return { meta: { title: `Internet Medieval Sourcebook: ${p.title}`, category: "classics", container: "Internet Medieval Sourcebook (Fordham)", url: p.href, license: "Fordham University; for personal and classroom use" }, entries: b.entries };
  },
};

export const CATALOGUE_SOURCES: CatalogueSource[] = [ccelSource, tertullianSource, fordhamSource];
export const catalogueSource = (id: string): CatalogueSource | undefined => CATALOGUE_SOURCES.find((s) => s.id === id);

/** How long a set of items takes, in seconds, at a site's pace. */
export const estimateItems = (items: CatItem[], gapMs: number): number => Math.round(items.reduce((n, i) => n + i.requests * (gapMs + 800), 0) / 1000);
