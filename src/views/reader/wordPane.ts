import { Menu, Notice, setIcon } from "obsidian";
import { BOOK_BY_OSIS } from "../../scripture/books";
import { plain, type BibleModule } from "../../scripture/module";
import type { Place } from "../../reader/place";
import { entryText, type DictEntry } from "../../scripture/esword";
import { runs } from "../../scripture/align";
import { normStrongs } from "../../scripture/interlinear";
import type { ModuleFile } from "../../scripture/store";
import { entryFor, formatStudy, guessStudy, moveCard, orderCards, relatedStrongs, splitStrongs } from "../../scripture/wordstudy";
import { ResourceManager } from "../resourceManager";
import type { Pane, PaneCtx } from "./types";

type WordPlace = Extract<Place, { kind: "word" }>;

const BEREAN = "berean";

/** Letters-and-spaces pattern for a rendering; with `loose`, a longer word also matches its other forms (rule, rules, ruled, ruling). */
function renderingPattern(g: string, loose: boolean): string {
  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const stem = g.replace(/(ing|ed|es|s|e)$/i, "");
  return loose && !g.includes(" ") && stem.length >= 4 ? `${esc(stem)}\\p{L}{0,4}` : esc(g);
}

/**
 * The verse written into `into`, with the English the word is rendered as in it picked out. The Berean wording is tried first; in a
 * translation that words it otherwise, the ways the word is rendered elsewhere are tried, with their other forms.
 */
function markWords(into: HTMLElement, text: string, glosses: string[], others: string[]) {
  const clean = (list: string[]) => [...new Set(list.map((g) => g.replace(/[\[\]()]/g, "").replace(/\s+/g, " ").trim().toLowerCase()).filter(Boolean))].sort((a, b) => b.length - a.length);
  const find = (words: string[], loose: boolean) => {
    if (!words.length) return [];
    const re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${words.map((g) => renderingPattern(g, loose)).join("|")})(?![\\p{L}\\p{N}])`, "giu");
    return [...text.matchAll(re)];
  };
  let hits = find(clean(glosses), false);
  if (!hits.length) hits = find(clean([...glosses, ...others]), true);
  let at = 0;
  for (const m of hits) {
    into.appendText(text.slice(at, m.index));
    into.createEl("mark", { cls: "booker-wp-hit is-guess", text: m[0] });
    at = m.index! + m[0].length;
  }
  into.appendText(text.slice(at));
}

/** The verse written into `into`, with the stretches matched to the number picked out. */
function markRanges(into: HTMLElement, text: string, ranges: Array<[number, number]>) {
  let at = 0;
  for (const [s, e] of ranges) {
    into.appendText(text.slice(at, s));
    into.createEl("mark", { cls: "booker-wp-hit", text: text.slice(s, e) });
    at = e;
  }
  into.appendText(text.slice(at));
}

/** One original word: what the Berean tables say of it and what each lexicon you have says of its Strong's number. */
export class WordPane implements Pane {
  private dicts: Array<{ name: string; entries: DictEntry[] }> = [];
  private looked = new Map<string, WordPlace | null>();
  private peekEl: HTMLElement | null = null;
  private peekTimer = 0;
  private sizer: ResizeObserver | null = null;

  constructor(private ctx: PaneCtx, private p: WordPlace) {}

  place(): Place {
    return this.p;
  }
  source() {
    return "Word study";
  }
  crumbs() {
    return [{ text: "Word study" }, { text: this.p.strongs || this.p.text }];
  }
  placeLabel() {
    return null;
  }
  canPrev() {
    return false;
  }
  canNext() {
    return false;
  }
  prev() {}
  next() {}
  destroy() {
    this.sizer?.disconnect();
    this.hidePeek();
  }

  /** A word by its Strong's number, from the first dictionary that has it. */
  private lookup(strongs: string): WordPlace | null {
    const key = normStrongs(strongs);
    if (this.looked.has(key)) return this.looked.get(key)!;
    let found: WordPlace | null = null;
    for (const d of this.dicts) {
      const e = entryFor(d.entries, key);
      if (!e) continue;
      const g = guessStudy(e);
      // the lexicon's guess looks for Hebrew letters; a Greek number wants the Greek ones
      const greek = key.startsWith("G") ? /[\u0370-\u03ff\u1f00-\u1fff]+/.exec(`${e.word} ${entryText(e.text)}`)?.[0] : undefined;
      found = { kind: "word", strongs: key, text: (key.startsWith("G") ? greek : g.hebrew) || key, translit: g.translit, gloss: g.gloss, parse: "" };
      break;
    }
    this.looked.set(key, found);
    return found;
  }

  private open(strongs: string) {
    const w = this.lookup(strongs) ?? { kind: "word" as const, strongs: normStrongs(strongs), text: normStrongs(strongs), translit: "", gloss: "", parse: "" };
    this.ctx.go(w);
  }

  /** The quick look: the same facts the word-for-word line in the Reader shows, in a small card beside the word. */
  private wirePeek(el: HTMLElement, strongs: string) {
    el.addEventListener("mouseenter", () => {
      window.clearTimeout(this.peekTimer);
      this.peekTimer = window.setTimeout(() => {
        this.hidePeek();
        const w = this.lookup(strongs);
        const pop = document.body.createDiv({ cls: "booker-ws-peek" });
        if (w) {
          pop.createSpan({ cls: "booker-ws-orig", text: w.text, attr: { lang: w.strongs.startsWith("H") ? "he" : "grc", dir: w.strongs.startsWith("H") ? "rtl" : "ltr" } });
          if (w.translit) pop.createSpan({ cls: "booker-ws-tr", text: w.translit });
          if (w.gloss) pop.createSpan({ cls: "booker-ws-en", text: w.gloss });
        } else pop.createSpan({ cls: "booker-muted", text: "Not in your dictionaries" });
        pop.createSpan({ cls: "booker-ws-num", text: normStrongs(strongs) });
        const r = el.getBoundingClientRect();
        pop.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - pop.offsetWidth - 8))}px`;
        pop.style.top = `${r.bottom + 6}px`;
        this.peekEl = pop;
      }, 250);
    });
    el.addEventListener("mouseleave", () => this.hidePeek());
  }

  private hidePeek() {
    window.clearTimeout(this.peekTimer);
    this.peekEl?.remove();
    this.peekEl = null;
  }

  /** A Strong's number that can be hovered and clicked. */
  private link(into: HTMLElement, text: string, strongs: string, cls = "booker-wp-ref"): HTMLElement {
    const a = into.createEl("a", { cls, text });
    this.wirePeek(a, strongs);
    a.addEventListener("click", (e) => {
      e.preventDefault();
      this.hidePeek();
      this.open(strongs);
    });
    return a;
  }

  /** Text with its Strong's numbers made into links. */
  private linked(into: HTMLElement, text: string) {
    for (const part of splitStrongs(text)) {
      if (part.s) this.link(into, part.t, part.s);
      else into.appendText(part.t);
    }
  }

  async load() {
    const { host } = this.ctx;
    host.empty();
    const w = this.p;
    const layout = host.createDiv({ cls: "booker-wp-layout" });
    const page = layout.createDiv({ cls: "booker-reader-wide booker-wp" });
    // the verses the word is used in sit beside the results
    const versesBox = layout.createDiv({ cls: "booker-wp-verses" });
    const head = page.createDiv({ cls: "booker-wp-head" });
    head.createEl("div", { cls: "booker-wp-word", text: w.text, attr: { dir: /^[H]/.test(w.strongs) ? "rtl" : "ltr", lang: /^H/.test(w.strongs) ? "he" : "grc" } });
    const meta = head.createDiv({ cls: "booker-wp-meta" });
    if (w.translit) meta.createEl("em", { text: w.translit });
    if (w.strongs) meta.createSpan({ cls: "booker-wp-num", text: w.strongs });
    if (w.parse) meta.createSpan({ cls: "booker-muted", text: w.parse });
    // the English, as the Reader's word-for-word line gives it, then the other ways it is rendered
    const english = head.createDiv({ cls: "booker-wp-english" });
    if (w.gloss) english.createSpan({ cls: "booker-wp-gloss", text: w.gloss });
    const alts = english.createSpan({ cls: "booker-muted booker-wp-alts" });

    const acts = page.createDiv({ cls: "booker-wp-acts" });
    const study = { hebrew: w.text, translit: w.translit, gloss: w.gloss, strongs: w.strongs };
    acts.createEl("button", { text: "Insert", cls: "mod-cta" }).addEventListener("click", () => {
      const view = this.ctx.plugin.lastMarkdownView();
      if (!view) return void new Notice("Booker: open a note to insert into.");
      view.editor.replaceSelection(formatStudy(study, "inline"));
    });
    const at = this.ctx.plugin.selection.get();
    if (at) acts.createEl("button", { text: "Commentary" }).addEventListener("click", () => void this.ctx.plugin.openCommentary(at));
    acts.createEl("button", { text: "Copy" }).addEventListener("click", () => void navigator.clipboard.writeText(formatStudy(study, "inline")).then(() => new Notice("Booker: copied.")));

    const related = page.createDiv({ cls: "booker-wp-related" });
    versesBox.hide();
    // the verse column is as tall as the part of the tab you can see, not as the whole page
    let scroller: HTMLElement | null = host;
    while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
    if (scroller) {
      const sc = scroller;
      const fit = () => {
        const top = parseFloat(getComputedStyle(sc).paddingTop) || 0;
        layout.style.setProperty("--wp-top", `${top}px`);
        layout.style.setProperty("--wp-h", `${Math.max(200, sc.clientHeight - top)}px`);
      };
      this.sizer?.disconnect();
      this.sizer = new ResizeObserver(fit);
      this.sizer.observe(sc);
      fit();
    }
    if (w.strongs) this.versesToggle(acts, versesBox, w.strongs);
    const cards = page.createDiv({ cls: "booker-wp-cards" });
    const texts: string[] = [];

    const card = (id: string, title: string) => {
      const c = cards.createDiv({ cls: "booker-wp-entry", attr: { "data-card": id } });
      const top = c.createDiv({ cls: "booker-wp-entry-top" });
      top.createEl("h4", { text: title });
      const mv = top.createEl("button", { cls: "clickable-icon booker-wp-move", attr: { "aria-label": "Change the order of these cards" } });
      setIcon(mv, "chevrons-up-down");
      mv.addEventListener("click", (e) => {
        const menu = new Menu();
        for (const [how, label, icon] of [["up", "Move up", "arrow-up"], ["down", "Move down", "arrow-down"], ["top", "Move to the top", "arrow-up-to-line"]] as const)
          menu.addItem((i) => i.setTitle(label).setIcon(icon).onClick(() => void this.move(cards, id, how)));
        menu.showAtMouseEvent(e);
      });
      return c;
    };

    // the Berean card: this verse, then how the Bible renders the number everywhere
    const wd = this.ctx.plugin.wordData;
    if (w.strongs && (await wd.available())) {
      const c = card(BEREAN, "Berean Standard Bible");
      c.createEl("div", { cls: "booker-wp-entry-word", text: [w.text, w.translit].filter(Boolean).join(" · ") });
      if (w.gloss) c.createEl("p", { text: `In this verse: ${w.gloss}${w.parse ? ` (${w.parse})` : ""}` });
      const uses = c.createEl("p", { cls: "booker-muted", text: "Counting the places it is used…" });
      void wd.renderings(w.strongs).then((r) => {
        if (!c.isConnected) return;
        if (!r.total) return uses.setText("Not found in the Berean word-for-word data.");
        uses.setText(`Used ${r.total} time${r.total === 1 ? "" : "s"}, rendered as:`);
        const list = c.createEl("p", { cls: "booker-wp-renders" });
        r.glosses.slice(0, 20).forEach((g, i) => {
          if (i) list.appendText(", ");
          list.appendText(g.gloss);
          list.createSpan({ cls: "booker-muted", text: ` ×${g.count}` });
        });
        const others = r.glosses.map((g) => g.gloss).filter((g) => g !== w.gloss.trim().toLowerCase()).slice(0, 5);
        if (others.length) alts.setText(`also: ${others.join(", ")}`);
        else if (!w.gloss && r.glosses[0]) english.insertBefore(createSpan({ cls: "booker-wp-gloss", text: r.glosses[0].gloss }), alts);
      });
    }

    const files = await this.ctx.plugin.modules.dictionaries();
    if (!files.length) {
      const none = page.createDiv({ cls: "booker-wp-none" });
      none.createEl("p", { cls: "booker-muted", text: "No dictionaries yet. Strong's and the STEPBible lexicons are free downloads." });
      none.createEl("button", { text: "Open Resource manager", cls: "mod-cta" }).addEventListener("click", () => new ResourceManager(this.ctx.plugin).open());
      this.arrange(cards);
      return;
    }
    const q = w.strongs || w.text;
    let any = false;
    for (const f of files) {
      let entries: DictEntry[] = [];
      try {
        entries = (await this.ctx.plugin.modules.loadDictionary(f)).entries;
      } catch {
        continue;
      }
      const name = f.name.replace(/\.[^.]+$/, "").replace(/\.dct$/, "");
      this.dicts.push({ name, entries });
      const e = w.strongs ? entryFor(entries, w.strongs) : null;
      if (!e) continue;
      any = true;
      const c = card(f.path, name);
      c.createEl("div", { cls: "booker-wp-entry-word", text: e.word });
      const body = entryText(e.text);
      texts.push(body);
      for (const para of body.split(/\n+/).filter(Boolean)) this.linked(c.createEl("p"), para);
      const g = guessStudy(e);
      c.createEl("button", { text: "Use this gloss" }).addEventListener("click", () => {
        const view = this.ctx.plugin.lastMarkdownView();
        if (!view) return void new Notice("Booker: open a note to insert into.");
        view.editor.replaceSelection(formatStudy({ ...study, gloss: g.gloss || study.gloss }, "inline"));
      });
    }
    if (!any && !cards.childElementCount) page.createEl("p", { cls: "booker-muted", text: `No entry for ${q} in the dictionaries you have.` });
    this.arrange(cards);

    // related words, as buttons at the top of the results
    const rel = relatedStrongs(texts, w.strongs);
    if (rel.length) {
      related.createSpan({ cls: "booker-muted", text: "Related words" });
      const row = related.createDiv({ cls: "booker-wp-related-row" });
      const btns = rel.map((s) => {
        const b = row.createEl("button", { cls: "booker-wp-relbtn" });
        b.createSpan({ cls: "booker-wp-relorig" });
        b.createSpan({ cls: "booker-ws-num", text: s });
        this.wirePeek(b, s);
        b.addEventListener("click", () => (this.hidePeek(), this.open(s)));
        return b;
      });
      // the original words are found one at a time so the page does not stall
      btns.forEach((b, i) =>
        window.setTimeout(() => {
          const l = b.isConnected ? this.lookup(rel[i]) : null;
          if (l) b.querySelector(".booker-wp-relorig")!.setText(l.text);
        }, i * 15)
      );
    }
  }

  /** A switch that lists every verse the word is used in, in a column beside the results; each verse opens in the Reader. */
  private versesToggle(acts: HTMLElement, box: HTMLElement, strongs: string) {
    const btn = acts.createEl("button", { cls: "booker-wp-versesbtn", text: "Show verses", attr: { "aria-pressed": "false" } });
    const wd = this.ctx.plugin.wordData;
    let drawn = false;
    btn.addEventListener("click", async () => {
      const on = !box.isShown();
      box.toggle(on);
      btn.toggleClass("is-active", on);
      btn.setAttr("aria-pressed", String(on));
      btn.setText(on ? "Hide verses" : "Show verses");
      if (!on || drawn) return;
      drawn = true;
      if (!(await wd.available())) {
        box.createEl("p", { cls: "booker-muted", text: "The Hebrew and Greek word-for-word data is not downloaded yet." });
        return;
      }
      box.createEl("p", { cls: "booker-muted", text: "Finding the verses…" });
      const all = await wd.occurrences(strongs);
      box.empty();
      if (!all.length) return void box.createEl("p", { cls: "booker-muted", text: "No verses found." });
      // each verse once, however many times the word is in it
      const seen = new Map<string, string[]>();
      const verses = all.filter((o) => {
        const k = `${o.book}.${o.chapter}.${o.verse}`;
        const first = !seen.has(k);
        if (first) seen.set(k, []);
        if (o.gloss) seen.get(k)!.push(o.gloss);
        return first;
      });
      const plugin = this.ctx.plugin;
      const files = await plugin.modules.bibles();
      const head = box.createDiv({ cls: "booker-wp-versehead" });
      const pick = head.createEl("select", { cls: "dropdown", attr: { "aria-label": "Bible translation for these verses" } });
      for (const f of files) pick.createEl("option", { value: f.path, text: await plugin.modules.title(f) });
      pick.value = files.find((f) => f.path === plugin.scriptureData().defaultModule)?.path ?? files[0]?.path ?? "";
      head.createSpan({ cls: "booker-muted", text: `${verses.length} verse${verses.length === 1 ? "" : "s"}` });
      const note = head.createSpan({ cls: "booker-muted booker-wp-matching" });
      // the usual renderings of the word, for translations that word a verse differently from Berean
      const others = (await wd.renderings(strongs)).glosses.filter((g) => g.count > 1).slice(0, 12).map((g) => g.gloss);
      let mod: BibleModule | null = null;
      let cur: ModuleFile | null = null;
      const tried = new Set<string>();
      const list = box.createDiv({ cls: "booker-wp-verselist" });
      let shown = 0;
      const more = box.createEl("button", { text: "Show more" });
      const draw = async () => {
        const slice = verses.slice(shown, shown + 50);
        const file = cur;
        // where this Bible has been matched to Strong's numbers, book by book
        const matched = new Map<string, Awaited<ReturnType<typeof plugin.align.book>>>();
        if (file) for (const b of new Set(slice.map((o) => o.book))) matched.set(b, await plugin.align.book(file, b));
        if (file !== cur) return;
        for (const o of slice) {
          const name = `${BOOK_BY_OSIS.get(o.book)?.name ?? o.book} ${o.chapter}:${o.verse}`;
          const row = list.createDiv({ cls: "booker-wp-verse" });
          row.createSpan({ cls: "booker-wp-verseref", text: name });
          const text = mod?.verse(o.book, o.chapter, o.verse);
          if (text) {
            const t = plain(text);
            const spans = matched.get(o.book)?.[o.chapter]?.[o.verse];
            const exact = spans ? runs(t, spans, strongs) : [];
            if (exact.length) markRanges(row.createSpan(), t, exact);
            else markWords(row.createSpan(), t, seen.get(`${o.book}.${o.chapter}.${o.verse}`) ?? [], others);
          }
          row.addEventListener("click", () => void this.ctx.plugin.openBible(name));
        }
        shown = Math.min(verses.length, shown + 50);
        more.toggle(shown < verses.length);
      };
      more.addEventListener("click", () => void draw());
      const use = async () => {
        const f = files.find((x) => x.path === pick.value) ?? null;
        cur = f;
        mod = f ? await plugin.modules.load(f).catch(() => null) : null;
        list.empty();
        shown = 0;
        note.setText("");
        // a Bible not matched to Strong's numbers yet is matched in the background; the list is drawn again when that is done
        if (f && !tried.has(f.path) && !(await plugin.align.current(f))) {
          tried.add(f.path);
          note.setText("Matching this Bible’s words to Strong’s numbers…");
          void plugin.align.ensure(f).then(() => {
            if (cur === f && box.isConnected) void use();
          });
        }
        await draw();
      };
      pick.addEventListener("change", () => void use());
      await use();
    });
  }

  /** Put the cards in the order last chosen. */
  private arrange(cards: HTMLElement) {
    const els = Array.from(cards.children) as HTMLElement[];
    const order = orderCards(els.map((e) => e.dataset.card!), this.ctx.plugin.scriptureData().wordCardOrder);
    for (const id of order) cards.append(els.find((e) => e.dataset.card === id)!);
  }

  /** Move a card, and keep the arrangement as the default for every word. */
  private async move(cards: HTMLElement, id: string, how: "up" | "down" | "top") {
    const shown = Array.from(cards.children).map((e) => (e as HTMLElement).dataset.card!);
    const saved = this.ctx.plugin.scriptureData().wordCardOrder ?? [];
    const order = moveCard(shown, id, how);
    // cards of dictionaries not on this page keep their place in the saved list
    const rest = saved.filter((x) => !order.includes(x));
    await this.ctx.plugin.saveScripture({ ...this.ctx.plugin.scriptureData(), wordCardOrder: [...order, ...rest] });
    this.arrange(cards);
  }
}
