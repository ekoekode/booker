/** One way for every reader pane to copy and drag words: the browser's plain text plus the Quotation, so a note gets a block quote and a footnote. */
import { decodeQuote, encodeQuote, QUOTE_MIME, quotePlain, type Quotation } from "../../reader/quote";

/** how far in from its left edge a picked passage can be grabbed to drag it, in pixels */
const GRIP = 8;

export const quoteFrom = (dt: DataTransfer | null | undefined): Quotation | null => decodeQuote(dt?.getData(QUOTE_MIME));

export function putQuote(dt: DataTransfer, q: Quotation) {
  dt.setData("text/plain", quotePlain(q));
  dt.setData(QUOTE_MIME, encodeQuote(q));
}

/** Copy to the clipboard with the quotation attached. Runs through the browser's own copy so the custom type survives. */
export function copyQuote(q: Quotation) {
  const once = (e: ClipboardEvent) => {
    if (!e.clipboardData) return;
    e.preventDefault();
    putQuote(e.clipboardData, q);
  };
  document.addEventListener("copy", once, { once: true, capture: true });
  if (!document.execCommand("copy")) {
    document.removeEventListener("copy", once, true);
    void navigator.clipboard.writeText(quotePlain(q));
  }
}

/**
 * cmd/ctrl+C and dragging, for selected words and for whole picked passages alike.
 * `get` gives what is selected or picked right now; `isPicked` says whether a dragged element is part of the pick.
 */
export function wireQuoteClip(root: HTMLElement, get: () => Quotation | null, isPicked: (el: HTMLElement) => boolean, unit = "p") {
  root.tabIndex = -1;
  const words = () => {
    const s = window.getSelection();
    return !!s && !s.isCollapsed && !!s.rangeCount && root.contains(s.getRangeAt(0).commonAncestorContainer);
  };
  root.addEventListener("copy", (e) => {
    const q = get();
    if (!q || !e.clipboardData) return;
    e.preventDefault();
    putQuote(e.clipboardData, q);
  });
  // with nothing selected the browser does not copy, so picked passages are copied here
  root.addEventListener("keydown", (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "c" || words()) return;
    const q = get();
    if (!q) return;
    e.preventDefault();
    copyQuote(q);
  });
  // A picked passage is dragged by its left edge, so pressing in the words always selects words
  root.addEventListener("mousedown", (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>(unit);
    root.querySelectorAll("[draggable]").forEach((x) => x.removeAttribute("draggable"));
    if (el && isPicked(el) && e.clientX - el.getBoundingClientRect().left <= GRIP) el.setAttribute("draggable", "true");
  });
  root.addEventListener("dragstart", (e) => {
    const el = e.target;
    if (!words() && !(el instanceof HTMLElement && el.getAttribute("draggable") === "true")) return;
    const q = get();
    if (!q || !e.dataTransfer) return;
    putQuote(e.dataTransfer, q);
    e.dataTransfer.effectAllowed = "copy";
  });
}
