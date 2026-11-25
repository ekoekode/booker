/** The reference bucket: passages and quotations kept from any reading, tagged so they can be found again. Pure. */
import { asNum, asStr, asStrs, newId } from "./jsonStore";

export interface BucketItem {
  id: string;
  text: string;
  /** "John 3:16-18", "Confessions 1.1" */
  citation: string;
  /** the archive or database it came from: a Bible module, a library title */
  archiveSource: string;
  book: string;
  chapter: string;
  topic: string[];
  created: number;
  /** what was kept: words of a Bible, or a passage of a document or commentary */
  kind: "verse" | "reference";
  /** "" for the top level; "A/B" for a folder inside a folder */
  group: string;
  /** the kind of file it came from (pdf, docx, md, epub, commentary…), for its icon */
  fileKind: string;
  /** the document it came from, to open it again; "" when there is none */
  uid: string;
  /** where to open it again: a Place as JSON; "" for older bookmarks */
  place: string;
}

export interface Bucket {
  items: BucketItem[];
  /** folders with nothing in them yet */
  groups: string[];
}

export const emptyBucket = (): Bucket => ({ items: [], groups: [] });

export function parseBucket(raw: unknown): Bucket {
  const list = (raw && typeof raw === "object" ? (raw as any).items : null) as unknown;
  if (!Array.isArray(list)) return emptyBucket();
  const items: BucketItem[] = [];
  for (const r of list) {
    if (!r || typeof r !== "object" || !asStr((r as any).text).trim()) continue;
    const o = r as Record<string, unknown>;
    items.push({ id: asStr(o.id) || newId(), text: asStr(o.text), citation: asStr(o.citation), archiveSource: asStr(o.archiveSource), book: asStr(o.book), chapter: asStr(o.chapter), topic: asStrs(o.topic), created: asNum(o.created), kind: o.kind === "verse" ? "verse" : "reference", group: asStr(o.group).split("/").map((x) => x.trim()).filter(Boolean).join("/"), fileKind: asStr(o.fileKind), uid: asStr(o.uid), place: asStr(o.place) });
  }
  const groups = Array.isArray((raw as any)?.groups) ? [...new Set<string>((raw as any).groups.filter((g: unknown): g is string => typeof g === "string").map((g: string) => g.split("/").map((x) => x.trim()).filter(Boolean).join("/")).filter(Boolean))] : [];
  return { items, groups };
}

export type NewItem = Omit<BucketItem, "id" | "created" | "topic" | "kind" | "group" | "fileKind" | "uid" | "place"> & Partial<Pick<BucketItem, "kind" | "group" | "fileKind" | "uid" | "place">> & { topic?: string[] };

/** Adds an item at the top. The same text from the same place is kept once; its tags are merged. */
export function addToBucket(b: Bucket, n: NewItem, now = Date.now()): { bucket: Bucket; item: BucketItem; added: boolean } {
  const topic = [...new Set((n.topic ?? []).map((t) => t.trim()).filter(Boolean))];
  const same = b.items.find((i) => i.text === n.text && i.citation === n.citation && i.archiveSource === n.archiveSource);
  if (same) {
    const merged = { ...same, topic: [...new Set([...same.topic, ...topic])] };
    return { bucket: { ...b, items: b.items.map((i) => (i === same ? merged : i)) }, item: merged, added: false };
  }
  const item: BucketItem = { ...n, topic, kind: n.kind ?? "reference", group: n.group ?? "", fileKind: n.fileKind ?? "", uid: n.uid ?? "", place: n.place ?? "", id: newId(now), created: now };
  return { bucket: { ...b, items: [item, ...b.items] }, item, added: true };
}

export const removeFromBucket = (b: Bucket, id: string): Bucket => ({ ...b, items: b.items.filter((i) => i.id !== id) });

export function retag(b: Bucket, id: string, topic: string[]): Bucket {
  const t = [...new Set(topic.map((x) => x.trim()).filter(Boolean))];
  return { ...b, items: b.items.map((i) => (i.id === id ? { ...i, topic: t } : i)) };
}

export interface BucketFilter {
  archiveSource?: string;
  book?: string;
  chapter?: string;
  topic?: string;
  text?: string;
}

export function filterBucket(items: BucketItem[], f: BucketFilter): BucketItem[] {
  const q = f.text?.trim().toLowerCase();
  return items.filter(
    (i) =>
      (!f.archiveSource || i.archiveSource === f.archiveSource) &&
      (!f.book || i.book === f.book) &&
      (!f.chapter || i.chapter === f.chapter) &&
      (!f.topic || i.topic.includes(f.topic)) &&
      (!q || i.text.toLowerCase().includes(q) || i.citation.toLowerCase().includes(q))
  );
}

/** The values to offer in each filter: every archive, book, chapter and topic in use, sorted. */
export function bucketTags(items: BucketItem[]): { archiveSource: string[]; book: string[]; chapter: string[]; topic: string[] } {
  const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return { archiveSource: uniq(items.map((i) => i.archiveSource)), book: uniq(items.map((i) => i.book)), chapter: uniq(items.map((i) => i.chapter)), topic: uniq(items.flatMap((i) => i.topic)) };
}

/** A quotation as it is written into a note: the text as a blockquote with its citation. */
export const bucketQuote = (i: Pick<BucketItem, "text" | "citation">): string =>
  `${i.text.trim().split(/\n+/).map((l) => `> ${l}`).join("\n>\n")}${i.citation ? `\n> — ${i.citation}` : ""}\n`;

export const moveBookmark = (b: Bucket, id: string, group: string): Bucket => ({ ...b, items: b.items.map((i) => (i.id === id ? { ...i, group: group.split("/").map((x) => x.trim()).filter(Boolean).join("/") } : i)) });

/** Renames a folder, and with it everything inside; moving a folder into another is a rename too. */
export function renameBucketGroup(b: Bucket, from: string, to: string): Bucket {
  const clean = (g: string) => g.split("/").map((x) => x.trim()).filter(Boolean).join("/");
  const a = clean(from);
  const z = clean(to);
  if (!a || a === z || z.startsWith(`${a}/`)) return b;
  const re = (g: string) => (g === a ? z : g.startsWith(`${a}/`) ? z + g.slice(a.length) : g);
  return { items: b.items.map((i) => ({ ...i, group: re(i.group) })), groups: [...new Set(b.groups.map(re).filter(Boolean))] };
}
