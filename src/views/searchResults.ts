import { renderInline } from "./inlineMarkup";

/** One result row, drawn the same in the reader and in the sidebar. */
export function hitRow(list: HTMLElement, title: string, snippet: string, open: () => void | Promise<void>, cls = "booker-bible-hit"): HTMLElement {
  const row = list.createDiv({ cls });
  renderInline(row.createDiv({ cls: "booker-bible-hit-title" }), title);
  renderInline(row.createDiv(), snippet);
  row.addEventListener("click", () => void open());
  return row;
}
