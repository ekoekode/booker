/** Web pages (HTML) turned into a Booker library: headings become sections, paragraphs plain text. Pure; used for Tertullian.org, Fordham and the Church Fathers files. */
import { decodeEntities, type LibEntry, type ThmlWork } from "./thml";

const strip = (s: string) => decodeEntities(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

const PARA = new Set(["p", "blockquote", "table", "ul", "ol", "li", "div", "pre", "dd", "dt", "dl", "center", "article", "section", "hr"]);
const LINE = new Set(["br", "tr"]);
const SKIP = new Set(["script", "style", "head", "nav", "noscript", "form", "select", "button", "svg", "iframe"]);

/** The page's own title, from <title> or the first heading. */
function pageTitle(html: string, fallback: string): string {
  const t = strip(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "");
  return t || fallback;
}

export function htmlToLibrary(html: string, fallbackTitle = "Untitled"): ThmlWork {
  const body = /<body[^>]*>([\s\S]*?)(?:<\/body>|$)/i.exec(html)?.[1] ?? html;
  const clean = body.replace(/<!--[\s\S]*?-->/g, "");
  const title = pageTitle(html, fallbackTitle);
  const entries: LibEntry[] = [{ id: 1, parent: null, level: "work", locator: "", key: "", title, text: "" }];
  const parts = new Map<number, string[]>([[1, []]]);
  const stack: { entry: LibEntry; rank: number }[] = [{ entry: entries[0], rank: 0 }];
  let skip = 0;
  let heading: { rank: number; text: string[] } | null = null;
  let firstHeading = true;

  const cur = () => stack[stack.length - 1].entry;
  const put = (s: string) => (heading ? heading.text.push(s) : parts.get(cur().id)!.push(s));
  const breakWith = (b: "\n\n" | "\n") => {
    const arr = parts.get(cur().id)!;
    if (!arr.length) return;
    const last = arr[arr.length - 1];
    if (b === "\n\n") arr[arr.length - 1] = last.replace(/[ \t]*\n*$/, "") + "\n\n";
    else if (last.endsWith("\n\n")) return;
    else if (last.endsWith("\n")) arr[arr.length - 1] = last + "\n";
    else arr.push("\n");
  };

  const re = /<(\/?)([A-Za-z][\w:-]*)([^>]*?)(\/?)>|([^<]+)|</g;
  for (let m = re.exec(clean); m; m = re.exec(clean)) {
    if (m[5] !== undefined) {
      if (skip) continue;
      const t = decodeEntities(m[5]).replace(/\s+/g, " ");
      if (heading || t.trim() || (parts.get(cur().id)!.length && t === " ")) put(t);
      continue;
    }
    if (!m[2]) continue;
    const closing = m[1] === "/";
    const name = m[2].toLowerCase();
    const selfClosing = m[4] === "/";
    if (SKIP.has(name)) {
      if (!selfClosing) skip = Math.max(0, skip + (closing ? -1 : 1));
      continue;
    }
    if (skip) continue;
    const hm = /^h([1-6])$/.exec(name);
    if (hm) {
      const rank = Number(hm[1]);
      if (!closing) {
        heading = { rank, text: [] };
      } else if (heading) {
        const text = heading.text.join("").replace(/\s+/g, " ").trim();
        heading = null;
        if (!text) continue;
        // the first heading of a page, when nothing has been said yet, is the page's title
        if (firstHeading && !parts.get(1)!.length && entries.length === 1 && rank <= 2) {
          entries[0].title = text;
          firstHeading = false;
          continue;
        }
        firstHeading = false;
        while (stack.length > 1 && stack[stack.length - 1].rank >= rank) stack.pop();
        const e: LibEntry = { id: entries.length + 1, parent: cur().id, level: "section", locator: "", key: "", title: text, text: "" };
        entries.push(e);
        parts.set(e.id, []);
        stack.push({ entry: e, rank });
      }
      continue;
    }
    if (name === "td" || name === "th") {
      if (closing) put(" | ");
      continue;
    }
    if (PARA.has(name)) breakWith("\n\n");
    else if (LINE.has(name)) breakWith("\n");
  }

  for (const e of entries) {
    e.text = (parts.get(e.id) ?? [])
      .join("")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }
  return { meta: { title: entries[0].title, authors: [] }, entries };
}

/** Page bytes as text: the page's own declared character set (many older sites are not UTF-8), else UTF-8. */
export function decodeHtml(bytes: Uint8Array): string {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 2048));
  const label = /charset\s*=\s*["']?([\w-]+)/i.exec(head)?.[1];
  try {
    return new TextDecoder(label ?? "utf-8").decode(bytes);
  } catch {
    return new TextDecoder().decode(bytes);
  }
}
