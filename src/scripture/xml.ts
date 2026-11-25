/**
 * OSIS, Zefania and USFX Bible files. A small tokenizer reads them in one pass, so a large file never becomes a
 * document tree. Notes, headings and cross references are left out; added words and words of Jesus are kept as such.
 */
import { BOOK_BY_NUM, BOOK_BY_OSIS, BOOK_BY_USFM, findBook } from "./books";
import { decodeEntities, MemoryBible, verseKey, type RawBible, type Seg } from "./module";

type Attrs = Record<string, string>;

interface Handlers {
  open(name: string, attrs: Attrs, selfClose: boolean): void;
  close(name: string): void;
  text(t: string): void;
}

const TOKEN = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[^<>]*?)?)(\/?)>|([^<]+)/g;
const ATTR = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

function sax(xml: string, h: Handlers) {
  for (const m of xml.matchAll(TOKEN)) {
    if (m[1] !== undefined) h.text(m[1]);
    else if (m[3]) {
      if (m[2]) h.close(m[3]);
      else {
        const attrs: Attrs = {};
        if (m[4]) for (const a of m[4].matchAll(ATTR)) attrs[a[1]] = decodeEntities(a[2] ?? a[3] ?? "");
        h.open(m[3], attrs, m[5] === "/");
      }
    } else if (m[6] !== undefined) h.text(decodeEntities(m[6]));
  }
}

/** Collects one verse's text with the styles in force. */
class Verse {
  private segs: Seg[] = [];
  add(t: string, i: boolean, jesus: boolean) {
    if (!t) return;
    const last = this.segs[this.segs.length - 1];
    if (last && !!last.i === i && !!last.jesus === jesus) last.t += t;
    else this.segs.push({ t, ...(i && { i }), ...(jesus && { jesus }) });
  }
  done(): Seg[] {
    const s = this.segs.map((g) => ({ ...g, t: g.t.replace(/\s+/g, " ") })).filter((g) => g.t);
    if (s.length) {
      s[0].t = s[0].t.replace(/^\s+/, "");
      s[s.length - 1].t = s[s.length - 1].t.replace(/\s+$/, "");
    }
    return s.filter((g) => g.t);
  }
}

const SKIP = new Set(["note", "NOTE", "title", "rdg", "catchWord", "f", "x", "xt", "fr", "fk", "fq", "fqa", "ft", "XREF", "REMARK", "h", "toc", "toc1", "toc2", "toc3", "mt", "s", "s1", "r", "d", "ide", "headerinfo", "INFORMATION", "header", "ms", "mr", "cl", "sp"]);

export type XmlKind = "osis" | "zefania" | "usfx";

export function sniffXml(xml: string): XmlKind | null {
  const head = xml.slice(0, 4000);
  if (/<osis\b|<osisText\b/i.test(head)) return "osis";
  if (/<XMLBIBLE\b/i.test(head)) return "zefania";
  if (/<usfx\b/i.test(head)) return "usfx";
  return null;
}

export function readXmlBible(id: string, xml: string, kind: XmlKind | null = sniffXml(xml)): MemoryBible {
  if (!kind) throw new Error("This XML file is not OSIS, Zefania or USFX.");
  const verses = new Map<string, Seg[]>();
  let name = "";
  let abbr = "";
  let rtl = false;

  const stack: string[] = [];
  let skip = 0;
  let italic = 0;
  let jesus = 0;
  const flags: Array<[boolean, boolean]> = []; // per open element: did it add italic / jesus
  let nameNext = false;
  let key: string | null = null;
  let cur: Verse | null = null;
  let book = "";
  let chapter = 0;
  const finish = () => {
    if (key && cur) {
      const s = cur.done();
      if (s.length && !verses.has(key)) verses.set(key, s);
    }
    key = null;
    cur = null;
  };
  const start = (k: string) => {
    finish();
    key = k;
    cur = new Verse();
  };

  const osisKey = (id0: string): string | null => {
    const first = id0.split(/\s+/)[0].split("-")[0];
    const [b, c, v] = first.split(".");
    if (!c || !v) return null;
    const bk = BOOK_BY_OSIS.get(b) ?? findBook(b);
    return bk ? verseKey(bk.osis, +c, +v) : null;
  };

  sax(xml, {
    open(tag, a, selfClose) {
      if (kind === "osis") {
        if (tag === "work" && a.osisWork) abbr ||= a.osisWork;
        if (tag === "verse") {
          if (a.eID) finish();
          else if (a.sID || a.osisID) {
            const k = osisKey(a.sID ?? a.osisID);
            if (k) start(k);
            else finish();
          }
        }
        if (tag === "div" && a.type === "book") finish();
      } else if (kind === "zefania") {
        if (tag === "XMLBIBLE") {
          name ||= a.biblename ?? "";
          abbr ||= a.biblename && a.biblename.length <= 8 ? a.biblename : "";
        }
        if (tag === "BIBLEBOOK") {
          const b = BOOK_BY_NUM.get(Number(a.bnumber)) ?? findBook(a.bname ?? "");
          book = b?.osis ?? "";
        }
        if (tag === "CHAPTER") chapter = Number(a.cnumber);
        if (tag === "VERS") {
          if (book && chapter) start(verseKey(book, chapter, Number(a.vnumber)));
          else finish();
        }
      } else {
        if (tag === "book") {
          finish();
          book = BOOK_BY_USFM.get((a.id ?? "").toUpperCase())?.osis ?? "";
          chapter = 0;
        }
        if (tag === "c") {
          finish();
          chapter = Number(a.id);
        }
        if (tag === "v") {
          if (book && chapter) start(verseKey(book, chapter, parseInt(a.id ?? "0", 10)));
          else finish();
        }
        if (tag === "ve") finish();
      }
      if (selfClose) return;
      stack.push(tag);
      const isSkip = SKIP.has(tag);
      if (isSkip) skip++;
      const it = kind === "osis" ? tag === "transChange" || (tag === "hi" && /italic|emphasis/.test(a.type ?? "")) || tag === "i" : kind === "zefania" ? tag === "STYLE" && /italic/.test(a.css ?? "") : tag === "add" || tag === "it";
      const je = kind === "osis" ? tag === "q" && /jesus|christ/i.test(a.who ?? "") : kind === "zefania" ? tag === "STYLE" && /color\s*:\s*(?:#?f{2}0{4}|red)/i.test(a.css ?? "") : tag === "wj";
      if (it) italic++;
      if (je) jesus++;
      flags.push([it, je]);
      if (kind === "osis" && tag === "title" && !name && stack.includes("work")) nameNext = true;
      if (kind === "zefania" && tag === "title") nameNext = !name;
      if (kind === "osis" && tag === "language") rtl = rtl || /^(he|ar|fa|ur|yi)/i.test(a.type ?? "");
    },
    close(tag) {
      if (!stack.length) return;
      stack.pop();
      if (SKIP.has(tag)) skip = Math.max(0, skip - 1);
      const f = flags.pop() ?? [false, false];
      if (f[0]) italic--;
      if (f[1]) jesus--;
      // a container verse ends here; a milestone verse (sID/eID) is self-closing and ended at its eID
      if (kind === "osis" && tag === "verse") finish();
    },
    text(t) {
      if (nameNext && stack[stack.length - 1] === "title") {
        name = t.trim();
        nameNext = false;
        return;
      }
      if (!cur || skip) return;
      cur.add(t, italic > 0, jesus > 0);
    },
  });
  finish();
  // a file with no title in it is named by its file name, not by its path in the vault
  const fromFile = (id.split("/").pop() ?? id).replace(/(\.(xml|osis|zefania|usfx))+$/i, "").replace(/[_]+/g, " ").trim();
  const raw: RawBible = { name: name || fromFile || id, abbr, rtl, verses, markup: "plain" };
  return new MemoryBible(id, raw);
}

