import { parseStoryDate } from "../dates";

/** Find a date in a quotation and give it back the way a story date is written, so a highlight can become a timeline event. Pure. */

const MONTHS = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";

const PATTERNS: RegExp[] = [
  /\b\d{4}-\d{2}-\d{2}\b/,
  new RegExp(`\\b(?:${MONTHS})\\.? \\d{1,2}(?:st|nd|rd|th)?,? \\d{3,4}\\b`, "i"),
  new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)? (?:${MONTHS})\\.?,? \\d{3,4}\\b`, "i"),
  new RegExp(`\\b(?:${MONTHS})\\.? \\d{3,4}\\b`, "i"),
  /\b(?:c\.|ca\.|circa) ?\d{3,4}(?: ?(?:BCE?|AD|CE))?/i,
  /\b\d{1,4} ?(?:BCE?|AD|CE)\b/,
  /\b\d{1,2}(?:st|nd|rd|th) century\b/i,
  /\b(?:1[0-9]{3}|20[0-9]{2})s?\b/,
];

const cleaned = (s: string) => s.replace(/(\d)(?:st|nd|rd|th)\b/, "$1").replace(/,/g, "").replace(/\s+/g, " ").trim();

/** The first date the story-date reader understands in `text`, most specific kind first. Null when there is none. */
export function findDate(text: string): { found: string; date: string } | null {
  for (const re of PATTERNS) {
    const m = re.exec(text);
    if (!m) continue;
    const candidate = /century/i.test(m[0]) ? m[0] : cleaned(m[0]);
    if (parseStoryDate(candidate)) return { found: m[0], date: candidate };
  }
  return null;
}

/** A short name for an event from the words of a quotation: the first few words without ending punctuation. */
export function eventTitle(text: string, words = 7): string {
  const w = text.replace(/\s+/g, " ").trim().split(" ").slice(0, words).join(" ");
  return w.replace(/[\s,;:.\-–—]+$/, "").replace(/[\\/:*?"<>|]/g, "") || "Event";
}

/** The Markdown body of an event note: the quotation and where it came from. */
export function eventBody(quote: string, cite: string): string {
  const q = quote.split(/\n+/).map((l) => `> ${l}`).join("\n>\n");
  return `${q}\n\n— ${cite}\n`;
}
