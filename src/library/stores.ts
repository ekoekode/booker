/** The three stores kept in the library folder, loaded once and saved on every change. */
import type { App } from "obsidian";
import { JsonFile, type FileAdapter } from "./jsonStore";
import { addToBucket, emptyBucket, parseBucket, removeFromBucket, retag, type Bucket, type NewItem } from "./bucket";
import { addBibleHighlight, emptyHighlights, parseBibleHighlights, removeBibleHighlight, type BibleHighlights, type NewHighlight } from "./bibleHighlights";
import { emptySaved, parseSaved, type SavedSearches } from "./savedSearches";

export const BUCKET_FILE = "Reference Bucket.json";
export const SAVED_FILE = "Saved Searches.json";
export const BIBLE_HL_FILE = "Bible Highlights.json";

class Held<T> {
  private value: T | null = null;
  private loading: Promise<T> | null = null;
  private subs = new Set<() => void>();
  constructor(private file: JsonFile<T>) {}

  async get(): Promise<T> {
    if (this.value) return this.value;
    return (this.loading ??= this.file.load().then((v) => (this.value = v)));
  }
  /** Replaces the value, saves it and tells whoever is listening. */
  async set(v: T): Promise<void> {
    this.value = v;
    for (const fn of [...this.subs]) fn();
    await this.file.save(v);
  }
  onChange(fn: () => void): () => void {
    this.subs.add(fn);
    return () => void this.subs.delete(fn);
  }
}

export class LibraryStores {
  readonly bucketData: Held<Bucket>;
  readonly savedData: Held<SavedSearches>;
  readonly highlightData: Held<BibleHighlights>;

  constructor(app: App) {
    const a = app.vault.adapter;
    const adapter: FileAdapter = { exists: (p) => a.exists(p), read: (p) => a.read(p), write: (p, d) => a.write(p, d), mkdir: (p) => a.mkdir(p) };
    this.bucketData = new Held(new JsonFile(adapter, BUCKET_FILE, parseBucket, emptyBucket));
    this.savedData = new Held(new JsonFile(adapter, SAVED_FILE, parseSaved, emptySaved));
    this.highlightData = new Held(new JsonFile(adapter, BIBLE_HL_FILE, parseBibleHighlights, emptyHighlights));
  }

  async addToBucket(n: NewItem) {
    const r = addToBucket(await this.bucketData.get(), n);
    await this.bucketData.set(r.bucket);
    return r;
  }
  async removeFromBucket(id: string) {
    await this.bucketData.set(removeFromBucket(await this.bucketData.get(), id));
  }
  async retagBucket(id: string, topic: string[]) {
    await this.bucketData.set(retag(await this.bucketData.get(), id, topic));
  }
  async addHighlight(n: NewHighlight) {
    const r = addBibleHighlight(await this.highlightData.get(), n);
    await this.highlightData.set(r.highlights);
    return r.item;
  }
  async removeHighlight(id: string) {
    await this.highlightData.set(removeBibleHighlight(await this.highlightData.get(), id));
  }
}
