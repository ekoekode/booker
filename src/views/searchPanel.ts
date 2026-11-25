import { Notice, debounce, setIcon } from "obsidian";
import type BookerPlugin from "../main";
import { MODES, type SearchMode } from "../reader/searchOptions";
import { runMode } from "./reader/resultsPane";
import { hitRow } from "./searchResults";
import { fuse } from "../semantic/hybrid";
import { BOOK_BY_OSIS } from "../scripture/books";
import { moduleLabel } from "../scripture/store";

type Where = "all" | "writing" | "library";
const WHERE: Array<{ id: Where; label: string }> = [
  { id: "all", label: "Everything" },
  { id: "writing", label: "My project" },
  { id: "library", label: "Library (Bibles and documents)" },
];

/** One search over your own project files and your library documents. Remembers its query, scope and mode while the sidebar is open. */
export class SearchPanel {
  private query = "";
  private where: Where = "all";
  private mode: SearchMode = "exact";
  private token = 0;

  constructor(private plugin: BookerPlugin) {}

  /** Draw the search box, its two segmented controls (where, how) and a results area that unfolds when there is something to show. */
  draw(body: HTMLElement) {
    const row = body.createDiv({ cls: "booker-sp-row" });
    setIcon(row.createSpan({ cls: "booker-sp-ico" }), "search");
    const input = row.createEl("input", { cls: "booker-side-search", type: "text", placeholder: "Search your project and library" });
    input.value = this.query;
    const chips = body.createDiv({ cls: "booker-sp-controls" });
    const fold = body.createDiv({ cls: "booker-fold booker-search-fold is-folded" });
    const results = fold.createDiv({ cls: "booker-fold-inner booker-side-results" });
    const open = (on: boolean) => fold.toggleClass("is-folded", !on);
    const run = debounce(() => void this.search(results, open), 300, true);
    const choose = (list: Array<{ id: string; label: string }>, icons: Record<string, string>, label: string, current: () => string, pick: (id: string) => void) => {
      const box = chips.createDiv({ cls: "booker-sp-pick" });
      setIcon(box.createSpan({ cls: "booker-sp-ico", attr: { "aria-label": label, title: label } }), icons.icon);
      const sel = box.createEl("select", { cls: "dropdown", attr: { "aria-label": label } });
      for (const c of list) {
        const o = sel.createEl("option", { text: c.label });
        o.value = c.id;
        o.selected = current() === c.id;
      }
      sel.addEventListener("change", () => {
        pick(sel.value);
        run();
      });
    };
    choose(WHERE, { icon: "layers" }, "Where to search", () => this.where, (id) => (this.where = id as Where));
    choose(MODES, { icon: "wand" }, "How to search", () => this.mode, (id) => (this.mode = id as SearchMode));
    input.addEventListener("input", () => {
      this.query = input.value;
      if (this.query.trim().length < 2) {
        this.token++;
        open(false);
      } else run();
    });
    input.addEventListener("keydown", (e) => e.key === "Enter" && void this.search(results, open));
    if (this.query) void this.search(results, open);
    return input;
  }

  private async search(out: HTMLElement, open: (on: boolean) => void) {
    const q = this.query.trim();
    const mine = ++this.token;
    const alive = () => mine === this.token;
    out.empty();
    if (q.length < 2) return open(false);
    open(true);
    const p = this.plugin;
    const status = out.createDiv({ cls: "booker-muted", text: "Searching…" });
    const list = out.createDiv();
    let count = 0;
    const mode = runMode(this.mode);
    try {
      if (this.where !== "library") {
        const hits = await p.writingIndex.search(q, this.mode, 40, (m) => alive() && status.setText(m));
        if (!alive()) return;
        for (const h of hits) {
          hitRow(list, `${h.title}${h.loc ? ` · ${h.loc}` : ""}`, h.snippet, () => void p.app.workspace.openLinkText(h.path, "", false), "booker-side-hit booker-item-card");
          count++;
        }
      }
      if (this.where !== "writing") {
        const sources = p.sources();
        let hits = sources.length ? await p.sourceService.search(sources, q, 40, (m) => alive() && status.setText(m), mode) : [];
        if (!alive()) return;
        if (this.mode === "semantic" && sources.length) {
          // the same blend as the Reader: the words found above, joined with the passages closest in meaning
          try {
            const meaning = await p.semanticIndex.search(sources, q, 40, (m) => alive() && status.setText(m));
            if (!alive()) return;
            const by = new Map(hits.map((h) => [`${h.source.uid}:${h.chunkNo}`, h]));
            hits = fuse([{ items: hits, weight: 0.7 }, { items: meaning }], (h) => `${h.source.uid}:${h.chunkNo}`)
              .slice(0, 40)
              .map((x) => by.get(`${x.item.source.uid}:${x.item.chunkNo}`) ?? x.item);
          } catch (e) {
            new Notice(`Booker: searching by meaning is not available, so only words were searched. ${e instanceof Error ? e.message : e}`);
          }
        }
        for (const h of hits) {
          hitRow(list, `${h.source.title} · ${h.chunk.loc}`, h.snippet, () => void p.openHit(h), "booker-side-hit booker-item-card");
          count++;
        }
        // verses of the Bibles, so Everything and Library mean the same here as in the Reader
        const words = q.toLowerCase().split(/\s+/).filter(Boolean);
        for (const f of await p.modules.bibles()) {
          try {
            const mod = await p.modules.load(f);
            if (!alive()) return;
            for (const h of mod.search(words, 15, mode)) {
              const segs = mod.verse(h.book, h.c, h.v);
              if (!segs) continue;
              const ref = `${BOOK_BY_OSIS.get(h.book)?.name ?? h.book} ${h.c}:${h.v}`;
              hitRow(list, `${ref} · ${moduleLabel(f.name)}`, segs.map((x) => x.t).join(""), () => void p.openBible(ref), "booker-side-hit booker-item-card");
              count++;
            }
          } catch {
            /* a Bible that cannot be read is left out */
          }
        }
      }
    } catch (e) {
      if (alive()) new Notice(`Booker: ${e instanceof Error ? e.message : e}`);
    }
    if (alive()) status.setText(count ? `${count} result${count === 1 ? "" : "s"}` : "Nothing found.");
  }
}
