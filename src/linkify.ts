/** Turn scripture references and [@key] citations in rendered text into things you can click or point at. */
import type BookerPlugin from "./main";
import { CITE, makeCiter } from "./citations/cite";
import { locateReferences } from "./scripture/index";
import { profileById, allProfiles } from "./profiles/profile";
import { findProjects } from "./project/vaultOps";

const SKIP = new Set(["CODE", "PRE", "A", "BUTTON", "INPUT", "TEXTAREA", "SCRIPT", "STYLE"]);

interface Span {
  from: number;
  to: number;
  kind: "cite" | "ref";
  text: string;
  key?: string;
}

export function spansIn(text: string, citations: boolean, refs = true): Span[] {
  const spans: Span[] = [];
  if (citations) for (const m of text.matchAll(CITE)) spans.push({ from: m.index!, to: m.index! + m[0].length, kind: "cite", text: m[0], key: m[1] });
  if (refs) for (const l of locateReferences(text)) if (!spans.some((s) => l.from < s.to && l.to > s.from)) spans.push({ from: l.from, to: l.to, kind: "ref", text: l.text });
  return spans.sort((a, b) => a.from - b.from);
}

/** The bibliography entry for a source, in the style of the book the note belongs to. */
function entryFor(plugin: BookerPlugin, key: string, sourcePath: string | undefined): string | null {
  const src = plugin.sources().find((s) => s.citekey === key);
  if (!src) return null;
  const proj = sourcePath ? findProjects(plugin.app).find((p) => sourcePath.startsWith(`${p.file.parent?.path}/`)) : undefined;
  const fm = proj ? (plugin.app.metadataCache.getFileCache(proj.file)?.frontmatter ?? {}) : {};
  const style = (["chicago", "sbl", "apa", "mla"].includes(fm.citationStyle) ? fm.citationStyle : undefined) ?? (proj ? profileById(allProfiles(), proj.profile).citationStyle : "chicago");
  const c = makeCiter((k) => (k === key ? src : undefined), style);
  c.note(key);
  return c.bibliography()[0]?.replace(/[*_]/g, "") ?? null;
}

export function linkify(root: HTMLElement, plugin: BookerPlugin, opts: { citations: boolean; refs?: boolean; sourcePath?: string }) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => {
      for (let e = n.parentElement; e && e !== root.parentElement; e = e.parentElement) if (SKIP.has(e.tagName) || e.classList.contains("booker-ref") || e.classList.contains("booker-cite")) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const nodes: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
  for (const node of nodes) {
    const text = node.data;
    const spans = spansIn(text, opts.citations, opts.refs !== false);
    if (!spans.length) continue;
    const frag = document.createDocumentFragment();
    let at = 0;
    for (const s of spans) {
      if (s.from > at) frag.append(text.slice(at, s.from));
      const el = document.createElement("span");
      el.textContent = s.text;
      if (s.kind === "cite") {
        el.className = "booker-cite";
        const entry = s.key ? entryFor(plugin, s.key, opts.sourcePath) : null;
        el.setAttribute("aria-label", entry ?? `No source has the key “${s.key}”`);
        if (!entry) el.addClass("is-broken");
        el.addEventListener("click", (e) => {
          e.preventDefault();
          const src = plugin.sources().find((x) => x.citekey === s.key);
          if (src) void plugin.openSource(src);
        });
      } else {
        el.className = "booker-ref";
        el.setAttribute("aria-label", `Read ${s.text} in the Bible reader`);
        el.addEventListener("click", (e) => {
          e.preventDefault();
          void plugin.openBible(s.text);
        });
      }
      frag.append(el);
      at = s.to;
    }
    if (at < text.length) frag.append(text.slice(at));
    node.replaceWith(frag);
  }
}
