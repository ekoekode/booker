/** Other forms of a name or alias that should match it: plurals ("Christian" → "Christians") and, through the apostrophe, possessives ("Bob" → "Bob's", "Bobs'"). Pure. */

const MIN_LETTERS = 4;

/** The plural endings a name takes, longest first: "Church" → "es", "Christian" → "s". */
export function pluralEndings(name: string): string[] {
  const n = name.trim();
  if ([...n].length < MIN_LETTERS) return [];
  return /(s|x|z|ch|sh)$/i.test(n) ? ["es", "s"] : ["s"];
}

/**
 * How many letters straight after a matched name make it a plural of that name (0 when none).
 * `rest` is the text right after the match. The ending must be a whole word: "Christians" and "Christians'" qualify, "Christianity" does not.
 */
export function pluralSuffixLength(name: string, rest: string): number {
  const m = /^\p{L}+/u.exec(rest);
  if (!m) return 0;
  const letters = m[0];
  if (/^[\p{N}_]/u.test(rest.slice(letters.length))) return 0;
  return pluralEndings(name).find((e) => letters.toLowerCase() === e) ? letters.length : 0;
}

/** "Berry" → "Berries": the stem form for names ending in a consonant and y (last word only). Null otherwise. */
export function iesForm(name: string): string | null {
  const n = name.trim();
  if ([...n].length < MIN_LETTERS || !/[^aeiouy\s]y$/i.test(n)) return null;
  return `${n.slice(0, -1)}ies`;
}
