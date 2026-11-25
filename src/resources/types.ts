/** What the Resource manager can download. Pure: nothing here touches Obsidian, the disk or the network. */

export interface ResourceFile {
  url: string;
  /** the file name it is saved as, inside the resource's folder */
  to: string;
  size?: number;
  sha256?: string;
}

/** bible: a zip from eBible.org holding a USFX file, added to the Bibles. interlinear: a Bible made here from the word-for-word data. model/gen: files for the search and writing engines. archive: one big download converted into many libraries. catalogue: a website fetched item by item. library: a page only. */
export type ResourceKind = "model" | "gen" | "library" | "archive" | "catalogue" | "wordstudy" | "dictionary" | "interlinear" | "places" | "bible";

export interface Resource {
  id: string;
  group: string;
  title: string;
  note: string;
  license: string;
  kind: ResourceKind;
  files: ResourceFile[];
  /** written next to the files as model.json (models only) */
  json?: Record<string, unknown>;
  /** where the resource is described, opened in the browser for those that cannot be fetched from here yet */
  page?: string;
  /** a pattern matched against the names of what is already in the library, to tell it is there */
  detect?: string;
  /** how big it is to fetch, when it is not a list of files */
  sizeNote?: string;
  /** archive: the tarball and what its files are */
  archive?: { url: string; kind: "writings" | "commentaries" };
  /** catalogue: the id of its source in catalogueSources */
  source?: string;
  /** dictionary: how to read the download and what to call the module made from it */
  dict?: { parse: "strongs-h" | "strongs-g" | "step-h" | "step-g" | "wordnet"; title: string; abbr: string };
}

export const totalSize = (r: Resource): number => r.files.reduce((n, f) => n + (f.size ?? 0), 0);

export function formatSize(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}
