/** What a dropped file is, from its name and its first bytes. Pure. */
import type { SourceKind } from "../sources/types";
import type { LibraryFolder } from "./paths";

export type LibraryKind =
  | "bible" // a Bible module (e-Sword, MySword, OSIS, Zefania, USFX)
  | "commentary" // a commentary module
  | "lexicon" // an e-Sword or MySword dictionary or lexicon
  | "library" // a Booker library (.nlib)
  | "sqlite" // some other SQLite database that has to be mapped
  | "document" // PDF, ePub, web page, Markdown, text, TEI/ThML XML
  | "convert" // Word, OpenDocument or RTF, turned into Markdown on the way in
  | "bibliography" // BibTeX or RIS: its references become sources, the file is not kept
  | "unsupported";

export interface Classified {
  kind: LibraryKind;
  /** the label shown to the user */
  label: string;
  /** which library folder it is kept in; null when it cannot be imported */
  folder: LibraryFolder | null;
  /** how the source registry knows it, for kinds that become sources */
  sourceKind?: SourceKind;
  /** a Bible-style module that the scripture reader loads, not a citable source */
  module?: boolean;
  /** why it was refused */
  reason?: string;
}

const SQLITE = "SQLite format 3\0";

/** Does this start the way an SQLite file does? */
export function isSqliteHeader(head?: Uint8Array): boolean {
  if (!head || head.length < SQLITE.length) return false;
  for (let i = 0; i < SQLITE.length; i++) if (head[i] !== SQLITE.charCodeAt(i)) return false;
  return true;
}

function text(head?: Uint8Array): string {
  return head ? new TextDecoder("utf-8", { fatal: false }).decode(head.slice(0, 4000)) : "";
}

const bible = (label: string): Classified => ({ kind: "bible", label, folder: "Bibles", module: true });

/** Classify by name; `head` (the first few KB) settles the ambiguous ones: .xml, .mybible and unknown extensions. */
export function classify(name: string, head?: Uint8Array): Classified {
  const n = name.toLowerCase();
  const ext = n.includes(".") ? n.slice(n.lastIndexOf(".") + 1) : "";

  if (/\.bblx$|\.bbl\.mybible$/.test(n)) return bible("Bible");
  if (/\.cmtx$|\.cmt\.mybible$/.test(n)) return { kind: "commentary", label: "Commentary", folder: "Bibles", module: true };
  if (/\.dctx$|\.dct\.mybible$/.test(n)) return { kind: "lexicon", label: "Dictionary or lexicon", folder: "Databases", sourceKind: "db" };
  if (/\.lexx$/.test(n)) return { kind: "lexicon", label: "Lexicon", folder: "Bibles", module: true };
  if (ext === "nlib") return { kind: "library", label: "Booker library", folder: "Databases", sourceKind: "db" };
  if (ext === "osis" || ext === "zefania" || ext === "usfx") return bible("Bible (XML)");
  if (ext === "xml" || ext === "thml") {
    const t = text(head);
    if (/<osis\b|<osisText\b|<XMLBIBLE\b|<usfx\b/i.test(t)) return bible("Bible (XML)");
    return { kind: "document", label: "XML text (TEI, ThML)", folder: "Documents", sourceKind: "xml" };
  }
  if (ext === "bib" || ext === "bibtex" || ext === "ris") return { kind: "bibliography", label: "Bibliography", folder: "Documents" };
  if (ext === "pdf") return { kind: "document", label: "PDF", folder: "Documents", sourceKind: "pdf" };
  if (ext === "epub") return { kind: "document", label: "ePub", folder: "Documents", sourceKind: "epub" };
  if (ext === "html" || ext === "htm" || ext === "xhtml") return { kind: "document", label: "Web page", folder: "Documents", sourceKind: "html" };
  if (ext === "md" || ext === "markdown") return { kind: "document", label: "Markdown", folder: "Documents", sourceKind: "md" };
  if (ext === "txt") return { kind: "document", label: "Text", folder: "Documents", sourceKind: "txt" };
  if (ext === "docx" || ext === "odt" || ext === "rtf") return { kind: "convert", label: ext === "docx" ? "Word" : ext === "odt" ? "OpenDocument" : "RTF", folder: "Documents", sourceKind: "md" };
  if (ext === "mybible" || ext === "sqlite" || ext === "sqlite3" || ext === "db" || isSqliteHeader(head)) return { kind: "sqlite", label: "SQLite database", folder: "Databases", sourceKind: "db" };
  return { kind: "unsupported", label: "Unsupported", folder: null, reason: `Booker does not read .${ext || "this kind of"} files.` };
}

/** A SQLite file's tables settle what it is. */
export function refineSqlite(c: Classified, tables: string[]): Classified {
  if (c.kind !== "sqlite") return c;
  const t = new Set(tables.map((x) => x.toLowerCase()));
  if (t.has("entries") && t.has("meta")) return { kind: "library", label: "Booker library", folder: "Databases", sourceKind: "db" };
  if (t.has("bible")) return bible("Bible");
  if (t.has("commentary")) return { kind: "commentary", label: "Commentary", folder: "Bibles", module: true };
  if (t.has("dictionary")) return { kind: "lexicon", label: "Dictionary or lexicon", folder: "Databases", sourceKind: "db" };
  return c;
}

export interface SupportedKind {
  label: string;
  extensions: string;
  keptIn: LibraryFolder;
  note: string;
}

/** The list shown in the Documents tab: what can be dropped and where it goes. */
export const SUPPORTED_KINDS: SupportedKind[] = [
  { label: "Bibles", extensions: ".bblx .bbl.mybible .osis .zefania .usfx .xml", keptIn: "Bibles", note: "Read, searched and quoted in the Bible reader." },
  { label: "Commentaries", extensions: ".cmtx .cmt.mybible", keptIn: "Bibles", note: "Shown beside the verse you are reading." },
  { label: "Reference libraries", extensions: ".nlib", keptIn: "Databases", note: "Church fathers, encyclopedias, lexicons: browsed and searched like a book." },
  { label: "Dictionaries and lexicons", extensions: ".dctx .dct.mybible", keptIn: "Databases", note: "e-Sword and MySword dictionaries." },
  { label: "Other SQLite databases", extensions: ".sqlite .db", keptIn: "Databases", note: "Choose which fields to use from the three-dot menu." },
  { label: "Bibliographies", extensions: ".bib .bibtex .ris", keptIn: "Documents", note: "Their references become citable sources; the file itself is not kept." },
  { label: "Documents", extensions: ".pdf .epub .html .md .txt .xml .thml", keptIn: "Documents", note: "Cited, highlighted and searched." },
  { label: "Word and similar", extensions: ".docx .odt .rtf", keptIn: "Documents", note: "Turned into Markdown on the way in." },
  { label: "A folder from another Booker", extensions: "folder", keptIn: "Databases", note: "Libraries, documents and their notes are copied across as they were." },
];
