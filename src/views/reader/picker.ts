import { bookGroups, numbers } from "../../reader/passage";

export interface PickerSpec {
  books: string[];
  /** chapters with text, for a book */
  chapters(book: string): number[];
  book: string;
  chapter: number;
  onPick(book: string, chapter: number): void;
}

/** Books in groups and a grid of chapters for the chosen book: the picker for a Bible or a commentary. */
export function drawPassagePicker(into: HTMLElement, s: PickerSpec) {
  into.empty();
  let book = s.book;
  const wrap = into.createDiv({ cls: "booker-reader-picker" });
  const list = wrap.createDiv({ cls: "booker-reader-books" });
  const grid = wrap.createDiv({ cls: "booker-reader-chapters" });
  const chapters = () => {
    grid.empty();
    const have = s.chapters(book);
    grid.createDiv({ cls: "booker-reader-picker-head", text: "Chapter" });
    const box = grid.createDiv({ cls: "booker-reader-numbers" });
    for (const n of have.length ? have : numbers(0)) {
      const b = box.createEl("button", { text: String(n), cls: book === s.book && n === s.chapter ? "is-current" : "" });
      b.addEventListener("click", () => s.onPick(book, n));
    }
  };
  for (const g of bookGroups(s.books)) {
    list.createDiv({ cls: "booker-reader-picker-head", text: g.label });
    for (const b of g.books) {
      const row = list.createDiv({ cls: "booker-reader-book" + (b.osis === book ? " is-current" : ""), text: b.name });
      row.dataset.osis = b.osis;
      row.addEventListener("click", () => {
        book = b.osis;
        list.querySelectorAll(".booker-reader-book.is-current").forEach((x) => x.removeClass("is-current"));
        row.addClass("is-current");
        chapters();
      });
    }
  }
  chapters();
  list.querySelector(".booker-reader-book.is-current")?.scrollIntoView({ block: "center" });
}
