/** Picking whole passages in a reader by clicking: click one, shift-click a range, cmd/ctrl-click to add or take away one. */
import { Menu } from "obsidian";
import type { Quotation } from "../../reader/quote";
import { copyQuote } from "./quoteClip";

export interface PickState {
  picked: Set<number>;
  anchor: number | null;
}

/** What a click on item `i` does to the picked set. `all` are the item numbers in reading order. Pure. */
export function nextPick(all: number[], state: PickState, i: number, mods: { shift: boolean; toggle: boolean }): PickState {
  if (mods.shift && state.anchor !== null && all.includes(state.anchor)) {
    const a = all.indexOf(state.anchor);
    const b = all.indexOf(i);
    const range = all.slice(Math.min(a, b), Math.max(a, b) + 1);
    return { picked: mods.toggle ? new Set([...state.picked, ...range]) : new Set(range), anchor: state.anchor };
  }
  if (mods.toggle) {
    const picked = new Set(state.picked);
    if (picked.has(i)) picked.delete(i);
    else picked.add(i);
    return { picked, anchor: i };
  }
  return { picked: new Set([i]), anchor: i };
}

export const sortedPicks = (p: Set<number>) => [...p].sort((a, b) => a - b);

/** Right-click on selected words or picked passages: Summarize with AI, and Copy (with the footnote that goes with them). */
export function wireContextMenu(root: HTMLElement, get: () => Quotation | null, summarize: (text: string) => void) {
  root.addEventListener("contextmenu", (e) => {
    const q = get();
    if (!q) return;
    e.preventDefault();
    const menu = new Menu();
    menu.addItem((i) => i.setTitle("Summarize with AI").setIcon("sparkles").onClick(() => summarize(q.text)));
    menu.addItem((i) => i.setTitle("Copy").setIcon("copy").onClick(() => copyQuote(q)));
    menu.showAtMouseEvent(e);
  });
}

/** Numbers as ranges: [16,17,18,20] becomes "16-18, 20". Pure. */
export function spans(sorted: number[]): string {
  const out: string[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    out.push(j > i ? `${sorted[i]}-${sorted[j]}` : String(sorted[i]));
    i = j + 1;
  }
  return out.join(", ");
}
