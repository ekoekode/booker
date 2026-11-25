export type SourceKind = "md" | "txt" | "pdf" | "epub" | "html" | "xml" | "db";
export type SourceType = "book" | "chapter" | "article" | "web";

/** What the library knows about one source: the citation fields and where its file is. */
export interface Source {
  uid: string;
  /** short name used in [@key] citations */
  citekey: string;
  title: string;
  authors: string[];
  editors?: string[];
  translators?: string[];
  year?: string;
  publisher?: string;
  place?: string;
  edition?: string;
  /** book or journal the source appears in */
  container?: string;
  /** what it is: fathers, commentary, lexicon... (reference libraries carry it) */
  category?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  url?: string;
  accessed?: string;
  type: SourceType;
  kind: SourceKind;
  /** vault path of the original file */
  file: string;
  /** vault path of the note that describes it */
  note?: string;
}

/** A piece of a source's text with the place it came from, small enough to search and to show as a result. */
export interface Chunk {
  /** shown to the reader: "p. 12", "ch. 3", "Book II, section 4" */
  loc: string;
  /** page number when the source has pages */
  page?: number;
  text: string;
}
