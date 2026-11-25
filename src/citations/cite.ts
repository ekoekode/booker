/**
 * [@key, locator] in the text becomes a Chicago note: the full form the first time a source is cited, the short form
 * afterwards. The bibliography lists only what was cited. Pure.
 */
import type { Source } from "../sources/types";
import { styleById, type CitationStyle, type StyleId } from "./styles";

export const CITE = /\[@([A-Za-z0-9_:.-]+)(?:,\s*([^\]]*))?\]/g;

export interface Citer {
  /** true when citations are written in the text (APA, MLA) rather than as footnotes (Chicago, SBL) */
  inline: boolean;
  /** what the list of sources is called in this style */
  bibliographyTitle: string;
  /** the note text for a citation, or null when the key is unknown */
  note(key: string, loc?: string): string | null;
  /** every source cited so far, in the order of the bibliography */
  cited(): Source[];
  bibliography(): string[];
  unknown(): string[];
}

export function makeCiter(lookup: (key: string) => Source | undefined, styleId: StyleId = "chicago", opts: { ibid?: boolean } = {}): Citer {
  const style: CitationStyle = styleById(styleId);
  const seen = new Map<string, Source>();
  const missing = new Set<string>();
  let last: { uid: string } | null = null;
  return {
    inline: style.inline,
    bibliographyTitle: style.bibliographyTitle,
    note(key, loc) {
      const s = lookup(key);
      if (!s) {
        missing.add(key);
        return null;
      }
      const first = !seen.has(s.uid);
      seen.set(s.uid, s);
      const again = last?.uid === s.uid;
      last = { uid: s.uid };
      // "Ibid." stands for the source cited just before, in the note styles
      if (opts.ibid && !style.inline && !first && again) return loc ? `Ibid., ${loc}.` : "Ibid.";
      return style.cite(s, loc, first);
    },
    cited: () => [...seen.values()].sort(style.sort),
    bibliography() {
      return this.cited().map(style.entry);
    },
    unknown: () => [...missing],
  };
}

/** Replace every citation marker in `text` with the result of `fn`. */
export function replaceCitations(text: string, fn: (key: string, loc: string | undefined) => string | null): string {
  return text.replace(CITE, (whole, key: string, loc?: string) => fn(key, loc?.trim() || undefined) ?? whole);
}
