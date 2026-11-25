/** Assembling a library from several documents: each document becomes a section, its own headings become sections beneath it. Pure. */
import type { LibEntry } from "./thml";

export class LibBuilder {
  readonly entries: LibEntry[];

  constructor(title: string) {
    this.entries = [{ id: 1, parent: null, level: "work", locator: "", key: "", title, text: "" }];
  }

  add(parent: number, title: string, text = "", level = "section", locator = ""): number {
    const id = this.entries.length + 1;
    this.entries.push({ id, parent, level, locator, key: "", title, text });
    return id;
  }

  /** Put another library's tree under `parent`, its root becoming a section called `title`. Returns that section's id. */
  graft(parent: number, title: string, work: { entries: LibEntry[] }, level = "section"): number {
    const map = new Map<number, number>();
    for (const e of work.entries) {
      const id = this.entries.length + 1;
      map.set(e.id, id);
      const root = e.parent === null;
      this.entries.push({ ...e, id, parent: root ? parent : map.get(e.parent!) ?? parent, level: root ? level : e.level, title: root ? title : e.title });
    }
    return map.get(work.entries[0].id)!;
  }

  get empty(): boolean {
    return this.entries.length <= 1 && !this.entries[0].text;
  }
}

/** "Book 2" before "Book 10". */
export const naturalCompare = (a: string, b: string): number => a.localeCompare(b, "en", { numeric: true, sensitivity: "base" });
