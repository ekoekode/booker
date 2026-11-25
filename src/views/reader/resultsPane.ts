import { Notice } from "obsidian";
import { moduleLabel } from "../../scripture/store";
import type BookerPlugin from "../../main";
import type { Place } from "../../reader/place";
import { scopeTargets, type Scope, type SearchMode } from "../../reader/searchOptions";
import { BOOK_BY_OSIS } from "../../scripture/books";
import { fuse } from "../../semantic/hybrid";
import { entryForLoc } from "../../sources/tree";
import { hitRow } from "../searchResults";

export interface ResultsArgs {
  plugin: BookerPlugin;
  host: HTMLElement;
  query: string;
  scope: Scope;
  mode: SearchMode;
  place: Place;
  go(p: Place): void;
  close(): void;
  /** called by "Save this search" */
  save(): void;
  /** false once a newer search has replaced this one */
  alive(): boolean;
}

/** Until the meaning-based search is built, a semantic search runs as the looser word search. */
export const runMode = (m: SearchMode): "exact" | "fuzzy" => (m === "exact" ? "exact" : "fuzzy");

/** Search results: verses of the Bibles and passages of your documents, in one list. */
export async function drawResults(a: ResultsArgs) {
  const { plugin, host, query: q, scope, place } = a;
  host.empty();
  const wrap = host.createDiv({ cls: "booker-reader-wide" });
  const head = wrap.createDiv({ cls: "booker-lib-resulthead" });
  const title = head.createSpan({ cls: "booker-muted", text: "Searching…" });
  const tools = head.createDiv({ cls: "booker-reader-resulttools" });
  const save = tools.createEl("button", { text: "Save this search" });
  save.addEventListener("click", () => a.save());
  const close = tools.createEl("button", { text: "Close results" });
  close.addEventListener("click", () => a.close());
  const list = wrap.createDiv();
  let count = 0;
  const mode = runMode(a.mode);
  const targets = scopeTargets(scope, place, plugin.sources());

  if (targets.bibles !== "none") {
    const files = await plugin.modules.bibles();
    const current = files.find((x) => x.path === (place.kind === "bible" ? place.module : "")) ?? files.find((x) => x.path === plugin.scriptureData().defaultModule) ?? files[0];
    const chosen = targets.bibles === "every" ? files : current ? [current] : [];
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    for (const f of chosen) {
      try {
        const mod = await plugin.modules.load(f);
        let verses = mod.search(words, 60, mode);
        if (a.mode === "semantic") {
          try {
            const meaning = await plugin.bibleSemantic.search(f.path, mod, q, 60, (m) => a.alive() && title.setText(m));
            if (!a.alive()) return;
            verses = fuse([{ items: verses, weight: 0.7 }, { items: meaning }], (h) => `${h.book}.${h.c}.${h.v}`).slice(0, 60).map((x) => ({ book: x.item.book, c: x.item.c, v: x.item.v }));
          } catch (e) {
            new Notice(`Booker: semantic search of ${f.name} is not available, so only words were searched. ${e instanceof Error ? e.message : e}`);
          }
        }
        for (const h of verses) {
          const segs = mod.verse(h.book, h.c, h.v);
          if (!segs) continue;
          const r = list.createDiv({ cls: "booker-bible-hit" });
          const where = `${BOOK_BY_OSIS.get(h.book)?.name ?? h.book} ${h.c}:${h.v}`;
          r.createEl("div", { cls: "booker-bible-hit-title", text: chosen.length > 1 ? `${where} · ${moduleLabel(f.name)}` : where });
          r.createEl("div", { text: segs.map((s) => s.t).join("") });
          r.addEventListener("click", () => a.go({ kind: "bible", module: f.path, book: h.book, chapter: h.c, verse: h.v }));
          count++;
        }
      } catch (e) {
        new Notice(`Booker: could not search ${f.name}. ${e instanceof Error ? e.message : e}`);
      }
      if (!a.alive()) return;
    }
  }
  if (!a.alive()) return;

  if (targets.sources.length) {
    try {
      let hits = await plugin.sourceService.search(targets.sources, q, 60, (m) => a.alive() && title.setText(m), mode);
      if (!a.alive()) return;
      if (a.mode === "semantic") {
        try {
          const meaning = await plugin.semanticIndex.search(targets.sources, q, 60, (m) => a.alive() && title.setText(m));
          if (!a.alive()) return;
          const by = new Map(hits.map((h) => [`${h.source.uid}:${h.chunkNo}`, h]));
          hits = fuse([{ items: hits, weight: 0.7 }, { items: meaning }], (h) => `${h.source.uid}:${h.chunkNo}`)
            .slice(0, 60)
            .map((x) => by.get(`${x.item.source.uid}:${x.item.chunkNo}`) ?? x.item);
        } catch (e) {
          new Notice(`Booker: semantic search is not available, so only words were searched. ${e instanceof Error ? e.message : e}`);
        }
      }
      for (const h of hits) {
        const row = list.createDiv({ cls: "booker-bible-hit" });
        row.createDiv({ cls: "booker-bible-hit-title", text: `${h.source.title} · ${h.chunk.loc}` });
        row.createDiv({ text: h.snippet });
        row.addEventListener("click", async () => {
          if (h.source.kind === "db") {
            const entries = await plugin.sourceService.entries(h.source);
            a.go({ kind: "work", uid: h.source.uid, entry: entryForLoc(entries, h.chunk.loc)?.id ?? 0 });
          } else a.go({ kind: "work", uid: h.source.uid, entry: h.chunkNo + 1 });
        });
        count++;
      }
    } catch (e) {
      new Notice(`Booker: ${e instanceof Error ? e.message : e}`);
    }
  }
  if (!a.alive()) return;
  if (targets.writing) {
    try {
      const hits = await plugin.writingIndex.search(q, a.mode, 60, (m) => a.alive() && title.setText(m));
      if (!a.alive()) return;
      for (const h of hits) {
        hitRow(list, `${h.title}${h.loc ? ` · ${h.loc}` : ""}`, h.snippet, () => void plugin.app.workspace.openLinkText(h.path, "", false));
        count++;
      }
    } catch (e) {
      new Notice(`Booker: ${e instanceof Error ? e.message : e}`);
    }
  }
  if (!a.alive()) return;
  title.setText(count ? `${count} result${count === 1 ? "" : "s"} for “${q}”` : `Nothing found for “${q}”.`);
}
