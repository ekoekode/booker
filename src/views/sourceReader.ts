import { parseRefs } from "../scripture/ref";
import { ItemView, MarkdownView, Menu, Notice, WorkspaceLeaf } from "obsidian";
import { NamePrompt } from "../ui";
import { EventModal } from "./eventModal";
import { eventBody, eventTitle, findDate } from "../sources/dated";
import { createEventNote } from "../project/vaultOps";
import type BookerPlugin from "../main";
import { context, formatHighlight, locate, parseHighlights, removeHighlight, updateHighlight, type Highlight } from "../sources/highlights";
import { uid as newUid } from "../sources/ids";
import type { SourceIndex } from "../sources/index";
import { search as searchIndex } from "../sources/index";
import type { Source } from "../sources/types";

export const VIEW_SOURCE = "booker-source";

const WINDOW = 12;

/** Reads a source's text, shows its highlights, and turns a selection into a highlight, a quote or a citation. */
export class SourceReaderView extends ItemView {
  private src: Source | null = null;
  private ix: SourceIndex | null = null;
  private hls: Highlight[] = [];
  private from = 0;
  private to = 0;
  private focusHl = "";
  private body!: HTMLElement;
  private pop: HTMLElement | null = null;
  private find = "";

  constructor(leaf: WorkspaceLeaf, private plugin: BookerPlugin) {
    super(leaf);
  }

  getViewType() {
    return VIEW_SOURCE;
  }
  getDisplayText() {
    return this.src?.title ?? "Source";
  }
  getIcon() {
    return "book-open-text";
  }

  getState() {
    return { uid: this.src?.uid, chunk: this.from + 0, hl: this.focusHl };
  }
  async setState(state: any, result: any) {
    await super.setState(state, result);
    const s = this.plugin.sources().find((x) => x.uid === state?.uid);
    if (!s) return;
    this.focusHl = state.hl ?? "";
    if (!this.src || this.src.uid !== s.uid) {
      this.src = s;
      this.ix = null;
    }
    await this.show(typeof state.chunk === "number" ? state.chunk : 0);
  }

  async onOpen() {
    this.contentEl.addClass("booker-src");
    this.contentEl.addEventListener("mouseup", () => window.setTimeout(() => this.showPop(), 10));
    this.contentEl.addEventListener("scroll", () => this.hidePop(), true);
  }
  async onClose() {
    this.hidePop();
  }

  private hlPath() {
    const f = this.src!.file;
    return `${f.slice(0, f.lastIndexOf("/"))}/Highlights.md`;
  }

  private async readHighlights() {
    const a = this.app.vault.adapter;
    this.hls = (await a.exists(this.hlPath())) ? parseHighlights(await a.read(this.hlPath())) : [];
  }

  private async show(chunk: number) {
    const el = this.contentEl;
    el.empty();
    const s = this.src!;
    const head = el.createDiv({ cls: "booker-src-head" });
    head.createEl("h3", { text: s.title });
    head.createDiv({ cls: "booker-muted", text: [s.authors.join(", "), s.year].filter(Boolean).join(" · ") });
    const bar = head.createDiv({ cls: "booker-src-bar" });
    const input = bar.createEl("input", { type: "text", placeholder: "Find in this source" });
    input.value = this.find;
    input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      this.find = input.value;
      this.jumpToFind(e.shiftKey ? -1 : 1);
    });
    const btn = (label: string, fn: () => void) => bar.createEl("button", { text: label }).addEventListener("click", fn);
    if (s.kind === "pdf") btn("Open the PDF", () => this.openOriginal(this.chunkPage(this.from)));
    else btn("Open the file", () => this.openOriginal());
    btn("Highlights", () => void this.openNote());
    this.body = el.createDiv({ cls: "booker-src-body" });
    this.body.setText("Opening…");
    let ix: SourceIndex;
    try {
      ix = this.ix ??= await this.plugin.sourceService.index(s, (m: string) => this.body.setText(m));
    } catch (e) {
      this.body.setText(e instanceof Error ? e.message : String(e));
      return;
    }
    await this.readHighlights();
    let at = Math.max(0, Math.min(chunk, ix.chunks.length - 1));
    if (this.focusHl) {
      const h = this.hls.find((x) => x.uid === this.focusHl);
      if (h) {
        const i = ix.chunks.findIndex((c) => c.loc === h.loc && locate(c.text, h) >= 0);
        if (i >= 0) at = i;
      }
    }
    this.from = Math.max(0, at - WINDOW);
    this.to = Math.min(ix.chunks.length, at + WINDOW + 1);
    this.draw(at);
  }

  private chunkPage(i: number) {
    return this.ix?.chunks[i]?.page;
  }

  private draw(focus?: number) {
    const ix = this.ix!;
    this.body.empty();
    if (this.from > 0) this.body.createEl("button", { text: "Earlier", cls: "booker-src-more" }).onclick = () => {
      this.from = Math.max(0, this.from - WINDOW * 2);
      this.draw();
    };
    for (let i = this.from; i < this.to; i++) this.body.appendChild(this.chunkEl(i));
    if (this.to < ix.chunks.length) this.body.createEl("button", { text: "Later", cls: "booker-src-more" }).onclick = () => {
      this.to = Math.min(ix.chunks.length, this.to + WINDOW * 2);
      this.draw();
    };
    if (focus !== undefined) {
      const target = (this.focusHl && this.body.querySelector(`[data-hl="${this.focusHl}"]`)) || this.body.querySelector(`[data-i="${focus}"]`);
      if (target) {
        (target as HTMLElement).scrollIntoView({ block: "center" });
        target.addClass("is-flash");
        window.setTimeout(() => target.removeClass("is-flash"), 1800);
      }
    }
  }

  private chunkEl(i: number): HTMLElement {
    const c = this.ix!.chunks[i];
    const wrap = createDiv({ cls: "booker-src-chunk" });
    wrap.dataset.i = String(i);
    wrap.createDiv({ cls: "booker-src-loc", text: c.loc });
    const t = wrap.createDiv({ cls: "booker-src-text" });
    const ranges: Array<{ a: number; b: number; h?: Highlight; find?: boolean }> = [];
    for (const h of this.hls) {
      if (h.loc !== c.loc) continue;
      const a = locate(c.text, h);
      if (a >= 0) ranges.push({ a, b: a + h.text.replace(/\s+/g, " ").trim().length, h });
    }
    ranges.sort((x, y) => x.a - y.a);
    const flat = c.text;
    // highlight offsets were found in whitespace-squashed text; chunk text uses \n\n only between paragraphs
    const squashed = flat.replace(/\s+/g, " ");
    if (squashed.length !== flat.length) {
      // render the squashed text so offsets agree; paragraphs are shown as one flowing block
      this.paint(t, squashed, ranges);
    } else this.paint(t, flat, ranges);
    return wrap;
  }

  private paint(el: HTMLElement, text: string, ranges: Array<{ a: number; b: number; h?: Highlight }>) {
    let at = 0;
    for (const r of ranges) {
      if (r.a < at) continue;
      if (r.a > at) el.appendText(text.slice(at, r.a));
      const m = el.createEl("mark", { text: text.slice(r.a, r.b), cls: `booker-hl booker-hl-${r.h!.color}` });
      m.dataset.hl = r.h!.uid;
      if (r.h!.comment) m.title = r.h!.comment;
      m.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        const h = r.h!;
        const menu = new Menu();
        for (const c of ["yellow", "blue", "green", "pink"]) menu.addItem((i) => i.setTitle(`Colour: ${c}`).setChecked(h.color === c).onClick(() => void this.changeHl({ ...h, color: c })));
        menu.addItem((i) =>
          i.setTitle(h.comment ? "Edit comment…" : "Add a comment…").setIcon("message-square").onClick(() => new NamePrompt(this.app, "Comment on this highlight", "It shows when you point at the highlight and is saved with it.", (t) => void this.changeHl({ ...h, comment: t.trim() || undefined }), h.comment ?? "", true, "Save").open())
        );
        menu.addSeparator();
        menu.addItem((i) => i.setTitle("Remove highlight").setIcon("trash").onClick(() => void this.removeHl(h)));
        menu.showAtMouseEvent(e);
      });
      at = r.b;
    }
    el.appendText(text.slice(at));
  }

  private jumpToFind(dir: 1 | -1) {
    if (!this.ix || !this.find.trim()) return;
    const hits = searchIndex(this.ix, this.find, 5000).map((h) => h.chunk).sort((a, b) => a - b);
    if (!hits.length) return void new Notice("Not found in this source.");
    const cur = this.from + Math.min(WINDOW, this.to - this.from);
    const next = dir === 1 ? hits.find((h) => h > cur) ?? hits[0] : [...hits].reverse().find((h) => h < cur) ?? hits[hits.length - 1];
    this.from = Math.max(0, next - WINDOW);
    this.to = Math.min(this.ix.chunks.length, next + WINDOW + 1);
    this.focusHl = "";
    this.draw(next);
    const words = this.find.toLowerCase().split(/\s+/).filter(Boolean);
    const el = this.body.querySelector(`[data-i="${next}"] .booker-src-text`) as HTMLElement | null;
    if (el) {
      const txt = el.textContent ?? "";
      const at = words.map((w) => txt.toLowerCase().indexOf(w.replace(/^"|"$/g, ""))).find((x) => x >= 0);
      if (at !== undefined && at >= 0) {
        const r = document.createRange();
        const node = el.firstChild;
        if (node && node.nodeType === 3) {
          r.setStart(node, at);
          r.setEnd(node, Math.min((node as Text).length, at + words[0].length));
          const sel = window.getSelection();
          sel?.removeAllRanges();
          sel?.addRange(r);
        }
      }
    }
  }

  // ----------------------------------------------------------- selection

  private offsetIn(root: Node, node: Node, off: number): number {
    let n = 0;
    const walk = (cur: Node): boolean => {
      if (cur === node) {
        n += cur.nodeType === 3 ? off : 0;
        if (cur.nodeType !== 3) for (let i = 0; i < off; i++) n += (cur.childNodes[i].textContent ?? "").length;
        return true;
      }
      if (cur.nodeType === 3) n += (cur as Text).length;
      else for (const ch of Array.from(cur.childNodes)) if (walk(ch)) return true;
      return false;
    };
    walk(root);
    return n;
  }

  private selection(): { chunk: number; start: number; end: number; text: string; rect: DOMRect } | null {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount || !this.ix) return null;
    const r = sel.getRangeAt(0);
    const host = (n: Node) => (n.nodeType === 1 ? (n as HTMLElement) : n.parentElement)?.closest(".booker-src-chunk") as HTMLElement | null;
    const a = host(r.startContainer);
    const b = host(r.endContainer);
    if (!a || a !== b || !this.contentEl.contains(a)) return null;
    const textEl = a.querySelector(".booker-src-text")!;
    const start = this.offsetIn(textEl, r.startContainer, r.startOffset);
    const end = this.offsetIn(textEl, r.endContainer, r.endOffset);
    const full = textEl.textContent ?? "";
    const text = full.slice(start, end).trim();
    if (!text) return null;
    return { chunk: Number(a.dataset.i), start, end, text, rect: r.getBoundingClientRect() };
  }

  private hidePop() {
    this.pop?.remove();
    this.pop = null;
  }

  private showPop() {
    this.hidePop();
    const s = this.selection();
    if (!s) return;
    const p = (this.pop = document.body.createDiv({ cls: "booker-src-pop" }));
    p.style.left = `${Math.max(8, s.rect.left)}px`;
    p.style.top = `${s.rect.bottom + 6}px`;
    const b = (label: string, fn: () => void) => {
      const el = p.createEl("button", { text: label });
      el.addEventListener("mousedown", (e) => e.preventDefault());
      el.addEventListener("click", () => {
        this.hidePop();
        fn();
      });
    };
    b("Highlight", () => void this.makeHl(s, false));
    b("Quote", () => void this.makeHl(s, true));
    b("Cite", () => this.cite(s.chunk));
    if (this.plugin.currentProject()) b("Event", () => this.event(s));
    if (parseRefs(s.text.trim())) b("Read", () => void this.plugin.openBible(s.text.trim()));
    b("Copy", () => void navigator.clipboard.writeText(s.text));
  }

  /** Turn the selected words into a dated event on the timeline of the book being worked on. */
  private event(s: { chunk: number; text: string }) {
    const proj = this.plugin.currentProject();
    if (!proj) return;
    const c = this.ix!.chunks[s.chunk];
    const quote = s.text.replace(/\s+/g, " ").trim();
    const where = c.page ? `p. ${c.page}` : c.loc;
    const cite = `[@${this.src!.citekey}, ${where}]`;
    const found = findDate(quote) ?? findDate(c.text.replace(/\s+/g, " "));
    new EventModal(this.app, quote, eventTitle(quote), found?.date ?? "", proj.name, async (name, date) => {
      try {
        const f = await createEventNote(this.app, proj, name, date, eventBody(quote, cite), cite);
        new Notice(`Booker: added “${f.basename}” to ${proj.name}'s timeline (${date}).`);
      } catch (e) {
        new Notice(`Booker: ${e instanceof Error ? e.message : e}`);
      }
    }).open();
    window.getSelection()?.removeAllRanges();
  }

  private async makeHl(s: { chunk: number; start: number; end: number; text: string }, quote: boolean) {
    const src = this.src!;
    const c = this.ix!.chunks[s.chunk];
    const sq = c.text.replace(/\s+/g, " ");
    const ctx = context(sq, s.start, s.end);
    const h: Highlight = {
      uid: newUid(),
      source: src.uid,
      loc: c.loc,
      ...(c.page !== undefined && { page: c.page }),
      text: s.text.replace(/\s+/g, " "),
      prefix: ctx.prefix,
      suffix: ctx.suffix,
      color: quote ? "blue" : "yellow",
      created: Date.now(),
    };
    const a = this.app.vault.adapter;
    const prev = (await a.exists(this.hlPath())) ? await a.read(this.hlPath()) : `# Highlights: ${src.title}\n`;
    await a.write(this.hlPath(), prev.replace(/\s+$/, "") + "\n\n" + formatHighlight(h));
    this.hls.push(h);
    this.focusHl = "";
    this.draw();
    window.getSelection()?.removeAllRanges();
    if (quote) this.plugin.insertQuote(src, h, this.ix!.chunks[s.chunk].page ? String(this.ix!.chunks[s.chunk].page) : c.loc);
    else new Notice("Highlighted.");
  }

  private cite(chunk: number) {
    const src = this.src!;
    const c = this.ix!.chunks[chunk];
    this.plugin.insertCitation(src, c.page ? String(c.page) : c.loc.replace(/ \(\d+\)$/, ""));
  }

  private async changeHl(next: Highlight) {
    const a = this.app.vault.adapter;
    await a.write(this.hlPath(), updateHighlight(await a.read(this.hlPath()), next));
    this.hls = this.hls.map((x) => (x.uid === next.uid ? next : x));
    this.draw();
  }

  private async removeHl(h: Highlight) {
    const a = this.app.vault.adapter;
    await a.write(this.hlPath(), removeHighlight(await a.read(this.hlPath()), h.uid));
    this.hls = this.hls.filter((x) => x.uid !== h.uid);
    this.draw();
    new Notice("Highlight removed.");
  }

  private async openNote() {
    const f = this.app.vault.getFileByPath(this.hlPath());
    if (f) await this.app.workspace.getLeaf("split").openFile(f);
  }

  private openOriginal(page?: number) {
    const s = this.src!;
    void this.app.workspace.openLinkText(page ? `${s.file}#page=${page}` : s.file, "", "tab");
  }
}

export function lastMarkdown(plugin: BookerPlugin): MarkdownView | null {
  return plugin.lastMarkdownView();
}
