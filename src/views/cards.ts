/** Foldable cards, as in the hub: a heading with an icon, a short note on the right, and a body that folds with a height animation. */
import { setIcon } from "obsidian";

export interface Card {
  card: HTMLDetailsElement;
  body: HTMLElement;
  /** the note on the right of the heading */
  sub: HTMLElement;
  /** the heading row, for buttons that sit beside it */
  summary: HTMLElement;
}

/** Wrap what is under each card's heading in a body that collapses, and let the heading toggle it. */
export function makeFoldable(scope: HTMLElement, selector = "details.booker-hub-card, details.booker-hub-tasks, details.booker-hub-matter", onToggle?: (d: HTMLDetailsElement, open: boolean) => void) {
  scope.querySelectorAll<HTMLDetailsElement>(selector).forEach((d) => {
    const sum = d.querySelector(":scope > summary");
    if (!sum || d.querySelector(":scope > .booker-fold")) return;
    const inner = createDiv({ cls: "booker-fold-inner" });
    for (const c of Array.from(d.children)) if (c !== sum) inner.appendChild(c);
    d.createDiv({ cls: "booker-fold" }).appendChild(inner);
    if (!d.open) {
      d.open = true;
      d.addClass("is-folded");
    }
    sum.addEventListener("click", (ev) => {
      // sidebar cards carry their own buttons in the heading; the hub always toggled
      if (d.dataset.card && (ev.target as HTMLElement).closest("button, input, select, a")) return;
      ev.preventDefault();
      d.toggleClass("is-folded", !d.hasClass("is-folded"));
      onToggle?.(d, !d.hasClass("is-folded"));
    });
  });
}

/** One card, already foldable. `open` says whether it starts unfolded. */
export function drawCard(parent: HTMLElement, key: string, title: string, icon: string, sub = "", open = true, onToggle?: (key: string, open: boolean) => void): Card {
  const card = parent.createEl("details", { cls: "booker-hub-card" });
  card.dataset.card = key;
  card.open = open;
  const summary = card.createEl("summary");
  setIcon(summary.createSpan({ cls: "booker-hub-ico" }), icon);
  summary.createEl("strong", { text: title });
  const s = summary.createSpan({ cls: "booker-muted booker-hub-keep", text: sub });
  const body = card.createDiv({ cls: "booker-hub-card-body" });
  makeFoldable(parent, `details.booker-hub-card[data-card="${key}"]`, (d, o) => onToggle?.(key, o));
  return { card, body, sub: s, summary };
}
