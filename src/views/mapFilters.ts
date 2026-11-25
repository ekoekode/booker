import type { MapFilter } from "../project/mapData";
import { group, row, segmented, toggleRow } from "./prefsUi";

/** What the filters sheet needs to know, and how to tell the map when something changed. */
export interface FilterSheet {
  filter: MapFilter;
  kinds: Array<[string, number]>;
  characters: string[];
  plotlines: string[];
  books: string[];
  colorOf(kind: string): string;
  series: boolean;
  scope: "book" | "series";
  /** the pins to show have changed */
  changed(): void;
  /** the kinds switched off or "undated" changed, so they should be remembered */
  remember(): void;
  setScope(s: "book" | "series"): void;
}

/**
 * The filters, as a floating sheet under its button (not a native menu): what is on the map by type, then who, which plotline and which
 * book it involves. Closes on a click outside it or Esc. Returns a function that closes it.
 */
export function openFilters(root: HTMLElement, anchor: HTMLElement, f: FilterSheet, onClose?: () => void): () => void {
  const sheet = root.createDiv({ cls: "bm-sheet bm-glass", attr: { role: "dialog", "aria-label": "Filters" } });
  const a = anchor.getBoundingClientRect();
  const r = root.getBoundingClientRect();
  sheet.style.left = `${Math.max(8, a.left - r.left)}px`;
  sheet.style.top = `${a.bottom - r.top + 8}px`;

  const body = sheet.createDiv({ cls: "bm-sheet-body" });
  const draw = () => {
    body.empty();
    if (f.series) {
      const g = group(body, "Show");
      const rr = row(g, "Scope");
      segmented(rr.ctrl, [{ id: "book", label: "This book" }, { id: "series", label: "Whole series" }], f.scope, (id) => {
        f.scope = id as "book" | "series";
        f.setScope(f.scope);
        draw();
      });
    }
    const types = group(body, "Types");
    for (const [k, n] of f.kinds) {
      const rr = row(types, `${k}`);
      rr.el.addClass("is-check");
      const dot = rr.el.createSpan({ cls: "bm-dot" });
      dot.style.background = f.colorOf(k);
      rr.el.insertBefore(dot, rr.el.firstChild);
      rr.ctrl.createSpan({ cls: "bp-value", text: String(n) });
      const on = !f.filter.hidden.has(k);
      const box = rr.ctrl.createEl("button", { cls: "bp-check", attr: { role: "checkbox", "aria-checked": String(on), "aria-label": `Show ${k}` } });
      box.toggleClass("is-on", on);
      rr.el.onclick = () => {
        if (f.filter.hidden.has(k)) f.filter.hidden.delete(k);
        else f.filter.hidden.add(k);
        f.remember();
        f.changed();
        draw();
      };
    }
    const list = (caption: string, values: string[], key: "characters" | "plotlines" | "books") => {
      if (!values.length) return;
      const g = group(body, caption);
      for (const v of values.slice(0, 40)) {
        const rr = row(g, v);
        rr.el.addClass("is-check");
        const on = f.filter[key].includes(v);
        const box = rr.ctrl.createEl("button", { cls: "bp-check", attr: { role: "checkbox", "aria-checked": String(on), "aria-label": v } });
        box.toggleClass("is-on", on);
        rr.el.onclick = () => {
          f.filter[key] = on ? f.filter[key].filter((x) => x !== v) : [...f.filter[key], v];
          f.changed();
          draw();
        };
      }
    };
    list("Characters", f.characters, "characters");
    list("Plotlines", f.plotlines, "plotlines");
    if (f.books.length > 1) list("Books", f.books, "books");
    const more = group(body, "Dates");
    toggleRow(more, "Show places with no story date", f.filter.undated, (v) => {
      f.filter.undated = v;
      f.remember();
      f.changed();
    }, "While the story-date window is on.");
    const reset = body.createEl("button", { cls: "bp-button bm-sheet-clear", text: "Clear filters" });
    reset.onclick = () => {
      f.filter.hidden.clear();
      f.filter.characters = [];
      f.filter.plotlines = [];
      f.filter.books = [];
      f.remember();
      f.changed();
      draw();
    };
  };
  draw();

  const close = () => {
    if (!sheet.isConnected) return;
    sheet.remove();
    onClose?.();
    document.removeEventListener("mousedown", away, true);
    document.removeEventListener("keydown", esc, true);
  };
  const away = (e: MouseEvent) => {
    if (!sheet.contains(e.target as Node) && !anchor.contains(e.target as Node)) close();
  };
  const esc = (e: KeyboardEvent) => {
    if (e.key === "Escape") close();
  };
  window.setTimeout(() => {
    document.addEventListener("mousedown", away, true);
    document.addEventListener("keydown", esc, true);
  }, 0);
  return close;
}
