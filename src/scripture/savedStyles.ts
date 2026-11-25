import { DEFAULT_STYLE, type VerseStyle } from "./format";

/** Named verse styles, and a book's own choice of Bible and style. Pure. */

export type SavedStyles = Record<string, VerseStyle>;

export interface BookScripture {
  /** path of the Bible module this book writes verses from */
  bible?: string;
  /** name of the saved verse style this book uses */
  verseStyle?: string;
}

export const sameStyle = (a: Partial<VerseStyle>, b: Partial<VerseStyle>): boolean =>
  (Object.keys(DEFAULT_STYLE) as Array<keyof VerseStyle>).every((k) => (a[k] ?? DEFAULT_STYLE[k]) === (b[k] ?? DEFAULT_STYLE[k]));

/** The name a style was saved under, if it was. */
export const styleNameOf = (saved: SavedStyles | undefined, style: Partial<VerseStyle>): string | undefined => Object.keys(saved ?? {}).find((n) => sameStyle(saved![n], style));

/** Read the book's choice from its project note properties. */
export function bookScripture(fm: Record<string, any> | undefined): BookScripture {
  const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  return { bible: text(fm?.bible), verseStyle: text(fm?.verseStyle) };
}

/** The scripture settings a book works with: the global ones with the book's Bible and style laid over them. A style name that no longer exists is ignored. */
export function withBook<D extends { defaultModule?: string; style: VerseStyle; savedStyles?: SavedStyles }>(data: D, book: BookScripture): D {
  const named = book.verseStyle ? data.savedStyles?.[book.verseStyle] : undefined;
  return { ...data, defaultModule: book.bible ?? data.defaultModule, style: named ? { ...DEFAULT_STYLE, ...named } : data.style };
}
