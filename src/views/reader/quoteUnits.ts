/** Pick commentary notes (or any list of cards) and quote them: click, shift-click, cmd-click, or select words inside one. Copy, drag and the toolbar all carry the footnote. */
import { Notice } from "obsidian";
import type BookerPlugin from "../../main";
import { joinQuotations, type Quotation } from "../../reader/quote";
import { copyQuote } from "./quoteClip";
import { flagsOf, type CopySettings } from "../../reader/copySettings";
import type { BarButton } from "./selectionBar";
import { ReadingSelect, type Taken } from "./readingSelect";
import { cutText } from "../../reader/partial";
import type { Place } from "../../reader/place";
import { SummaryModal } from "../summaryModal";

export interface QuoteUnit {
  /** the whole words of the card, not what is shown of them */
  text: string;
  footnote: string;
  /** for the reference bucket */
  citation: string;
  source: string;
  book?: string;
  chapter?: string;
  /** where to open it again, kept with a bookmark */
  place?: Place;
  /** more things to do with it, listed in the popup (Read more, Open commentary…) */
  extras?: () => BarButton[];
}

/** `unitSel` matches each card under `root`; `unitOf` reads one. Returns a way to clear the pick when the cards are redrawn. */
export function wireQuoteUnits(plugin: BookerPlugin, root: HTMLElement, unitSel: string, unitOf: (el: HTMLElement) => QuoteUnit | null, copy?: () => CopySettings): { reset(): void; destroy(): void } {
  const withFlags = (q: Quotation): Quotation => (copy ? { ...q, ...flagsOf(copy()) } : q);

  /** A whole card says its complete text (the card may show only the start); words cut from it carry the ellipses. */
  const quoteOf = (taken: Taken[]): Quotation | null => {
    const parts = taken.map((t) => {
      const u = unitOf(t.el);
      if (!u) return null;
      const whole = t.start === 0 && t.end >= t.full.length;
      return { text: whole ? u.text : cutText(t), footnote: u.footnote };
    }).filter((x): x is Quotation => !!x && !!x.text);
    const q = joinQuotations(parts);
    return q ? withFlags(q) : null;
  };

  const select = new ReadingSelect({
    root,
    unitSel,
    units: () => Array.from(root.querySelectorAll<HTMLElement>(unitSel)),
    body: (el) => el.querySelector<HTMLElement>(".booker-bible-note-text, .booker-lib-text") ?? el,
    quote: quoteOf,
    buttons: (taken, done, whole) => {
      const q = quoteOf(taken);
      const u = unitOf(taken[0].el);
      const extras = (u?.extras?.() ?? []).map((b) => ({ ...b, run: (e: MouseEvent) => (done(), b.run(e)) }));
      return [
        // words selected: only those words go in; a click on a result: the whole result
        { label: whole ? "Quote" : "Insert", tip: whole ? "Write this whole result into the most recent note, with a footnote" : "Write the selected words into the most recent note, with a footnote", run: () => (done(), q && void plugin.insertQuoted(q)) },
        ...extras,
        {
          label: "Bookmark",
          icon: "bookmark",
          tip: "Add this to your bookmarks",
          run: () => {
            done();
            if (!q) return;
            void plugin.stores
              .addToBucket({ text: q.text, citation: u?.citation ?? "", archiveSource: u?.source ?? "", book: u?.book ?? "", chapter: u?.chapter ?? "", kind: "reference", fileKind: "commentary", place: u?.place ? JSON.stringify(u.place) : "" })
              .then((r) => new Notice(r.added ? "Booker: added to bookmarks." : "Booker: already in your bookmarks."));
          },
        },
        { label: "Summarize", tip: "Summarize these words with AI", run: () => (done(), q && new SummaryModal(plugin, q.text, u?.citation ?? "", "written").open()) },
        { label: "Copy", run: () => (done(), q && copyQuote(q)) },
      ];
    },
  });
  return { reset: () => select.reset(), destroy: () => select.destroy() };
}
