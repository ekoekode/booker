/**
 * The canon: sixty-six books in the usual order, then the Apocrypha / deuterocanon and a few other books some
 * modules carry. `osis` is the id used everywhere inside Booker; `usfm` is for USFX files; `num` is the number
 * e-Sword, MySword and Zefania files use (1 to 66 are standard; the rest follow the order listed here).
 */
export interface Book {
  osis: string;
  usfm: string;
  num: number;
  name: string;
  /** Society of Biblical Literature short form, as in Chicago and SBL notes */
  sbl: string;
  /** the shortest common form */
  short: string;
  /** other spellings people type */
  aliases: string[];
  /** the Apocrypha and other books outside the sixty-six */
  extra?: boolean;
  /** books with one chapter, where "Jude 5" means verse 5 */
  single?: boolean;
}

// osis, usfm, name, sbl, short, aliases, flags
type Row = [string, string, string, string, string, string[]] | [string, string, string, string, string, string[], "single" | "extra" | "extra single"];

const ROWS: Row[] = [
  ["Gen", "GEN", "Genesis", "Gen", "Gen", ["ge", "gn"]],
  ["Exod", "EXO", "Exodus", "Exod", "Ex", ["ex", "exo"]],
  ["Lev", "LEV", "Leviticus", "Lev", "Lev", ["le", "lv"]],
  ["Num", "NUM", "Numbers", "Num", "Num", ["nu", "nm", "nb"]],
  ["Deut", "DEU", "Deuteronomy", "Deut", "Deut", ["dt", "de"]],
  ["Josh", "JOS", "Joshua", "Josh", "Josh", ["jos", "jsh"]],
  ["Judg", "JDG", "Judges", "Judg", "Judg", ["jdg", "jg", "jdgs"]],
  ["Ruth", "RUT", "Ruth", "Ruth", "Ruth", ["ru", "rth"]],
  ["1Sam", "1SA", "1 Samuel", "1 Sam", "1 Sam", ["1sa", "1sm", "1s", "1st samuel", "first samuel"]],
  ["2Sam", "2SA", "2 Samuel", "2 Sam", "2 Sam", ["2sa", "2sm", "2s"]],
  ["1Kgs", "1KI", "1 Kings", "1 Kgs", "1 Kings", ["1ki", "1k", "1kin"]],
  ["2Kgs", "2KI", "2 Kings", "2 Kgs", "2 Kings", ["2ki", "2k", "2kin"]],
  ["1Chr", "1CH", "1 Chronicles", "1 Chr", "1 Chron", ["1ch", "1chron"]],
  ["2Chr", "2CH", "2 Chronicles", "2 Chr", "2 Chron", ["2ch", "2chron"]],
  ["Ezra", "EZR", "Ezra", "Ezra", "Ezra", ["ezr"]],
  ["Neh", "NEH", "Nehemiah", "Neh", "Neh", ["ne"]],
  ["Esth", "EST", "Esther", "Esth", "Esth", ["es", "est"]],
  ["Job", "JOB", "Job", "Job", "Job", ["jb"]],
  ["Ps", "PSA", "Psalms", "Ps", "Ps", ["psalm", "pslm", "psa", "psm", "pss"]],
  ["Prov", "PRO", "Proverbs", "Prov", "Prov", ["pr", "prv", "pro"]],
  ["Eccl", "ECC", "Ecclesiastes", "Eccl", "Eccl", ["ec", "ecc", "qoh", "qoheleth"]],
  ["Song", "SNG", "Song of Solomon", "Song", "Song", ["sos", "ss", "song of songs", "songs", "canticles", "cant", "sng"]],
  ["Isa", "ISA", "Isaiah", "Isa", "Isa", ["is"]],
  ["Jer", "JER", "Jeremiah", "Jer", "Jer", ["je", "jr"]],
  ["Lam", "LAM", "Lamentations", "Lam", "Lam", ["la"]],
  ["Ezek", "EZK", "Ezekiel", "Ezek", "Ezek", ["eze", "ezk"]],
  ["Dan", "DAN", "Daniel", "Dan", "Dan", ["da", "dn"]],
  ["Hos", "HOS", "Hosea", "Hos", "Hos", ["ho"]],
  ["Joel", "JOL", "Joel", "Joel", "Joel", ["jl", "joe"]],
  ["Amos", "AMO", "Amos", "Amos", "Amos", ["am"]],
  ["Obad", "OBA", "Obadiah", "Obad", "Obad", ["ob", "obd"], "single"],
  ["Jonah", "JON", "Jonah", "Jonah", "Jonah", ["jnh", "jon"]],
  ["Mic", "MIC", "Micah", "Mic", "Mic", ["mc"]],
  ["Nah", "NAM", "Nahum", "Nah", "Nah", ["na"]],
  ["Hab", "HAB", "Habakkuk", "Hab", "Hab", ["hb"]],
  ["Zeph", "ZEP", "Zephaniah", "Zeph", "Zeph", ["zep", "zp"]],
  ["Hag", "HAG", "Haggai", "Hag", "Hag", ["hg"]],
  ["Zech", "ZEC", "Zechariah", "Zech", "Zech", ["zec", "zc"]],
  ["Mal", "MAL", "Malachi", "Mal", "Mal", ["ml"]],
  ["Matt", "MAT", "Matthew", "Matt", "Matt", ["mt", "mat"]],
  ["Mark", "MRK", "Mark", "Mark", "Mark", ["mk", "mr", "mrk"]],
  ["Luke", "LUK", "Luke", "Luke", "Luke", ["lk", "luk"]],
  ["John", "JHN", "John", "John", "John", ["jn", "jhn", "joh"]],
  ["Acts", "ACT", "Acts", "Acts", "Acts", ["ac", "act", "acts of the apostles"]],
  ["Rom", "ROM", "Romans", "Rom", "Rom", ["ro", "rm"]],
  ["1Cor", "1CO", "1 Corinthians", "1 Cor", "1 Cor", ["1co", "1corinthians", "first corinthians"]],
  ["2Cor", "2CO", "2 Corinthians", "2 Cor", "2 Cor", ["2co"]],
  ["Gal", "GAL", "Galatians", "Gal", "Gal", ["ga"]],
  ["Eph", "EPH", "Ephesians", "Eph", "Eph", ["ep"]],
  ["Phil", "PHP", "Philippians", "Phil", "Phil", ["php", "pp"]],
  ["Col", "COL", "Colossians", "Col", "Col", ["co"]],
  ["1Thess", "1TH", "1 Thessalonians", "1 Thess", "1 Thess", ["1th", "1thes"]],
  ["2Thess", "2TH", "2 Thessalonians", "2 Thess", "2 Thess", ["2th", "2thes"]],
  ["1Tim", "1TI", "1 Timothy", "1 Tim", "1 Tim", ["1ti", "1tm"]],
  ["2Tim", "2TI", "2 Timothy", "2 Tim", "2 Tim", ["2ti", "2tm"]],
  ["Titus", "TIT", "Titus", "Titus", "Titus", ["ti"]],
  ["Phlm", "PHM", "Philemon", "Phlm", "Philem", ["phm", "philem", "pm"], "single"],
  ["Heb", "HEB", "Hebrews", "Heb", "Heb", []],
  ["Jas", "JAS", "James", "Jas", "James", ["jm", "jam"]],
  ["1Pet", "1PE", "1 Peter", "1 Pet", "1 Pet", ["1pe", "1pt"]],
  ["2Pet", "2PE", "2 Peter", "2 Pet", "2 Pet", ["2pe", "2pt"]],
  ["1John", "1JN", "1 John", "1 John", "1 John", ["1jn", "1jo", "1j"]],
  ["2John", "2JN", "2 John", "2 John", "2 John", ["2jn", "2jo", "2j"], "single"],
  ["3John", "3JN", "3 John", "3 John", "3 John", ["3jn", "3jo", "3j"], "single"],
  ["Jude", "JUD", "Jude", "Jude", "Jude", ["jd"], "single"],
  ["Rev", "REV", "Revelation", "Rev", "Rev", ["re", "revelation of john", "apocalypse", "revelations"]],
  // Apocrypha and other books carried by some modules
  ["Tob", "TOB", "Tobit", "Tob", "Tob", ["tb"], "extra"],
  ["Jdt", "JDT", "Judith", "Jdt", "Jdt", ["jth"], "extra"],
  ["Wis", "WIS", "Wisdom of Solomon", "Wis", "Wis", ["ws", "wisdom"], "extra"],
  ["Sir", "SIR", "Sirach", "Sir", "Sir", ["ecclus", "ecclesiasticus", "wisdom of sirach", "ben sira"], "extra"],
  ["Bar", "BAR", "Baruch", "Bar", "Bar", [], "extra"],
  ["EpJer", "LJE", "Letter of Jeremiah", "Ep Jer", "Let Jer", ["epistle of jeremiah", "letter of jeremiah", "lje"], "extra single"],
  ["1Macc", "1MA", "1 Maccabees", "1 Macc", "1 Macc", ["1ma", "1mac", "first maccabees"], "extra"],
  ["2Macc", "2MA", "2 Maccabees", "2 Macc", "2 Macc", ["2ma", "2mac"], "extra"],
  ["1Esd", "1ES", "1 Esdras", "1 Esd", "1 Esd", ["1es"], "extra"],
  ["2Esd", "2ES", "2 Esdras", "2 Esd", "2 Esd", ["2es", "4 ezra"], "extra"],
  ["PrMan", "MAN", "Prayer of Manasseh", "Pr Man", "Pr Man", ["prayer of manasses", "man"], "extra single"],
  ["AddEsth", "ESG", "Additions to Esther", "Add Esth", "Add Esth", ["rest of esther", "esg"], "extra"],
  ["PrAzar", "S3Y", "Prayer of Azariah", "Pr Azar", "Pr Azar", ["song of the three", "song of three children", "s3y"], "extra single"],
  ["Sus", "SUS", "Susanna", "Sus", "Sus", [], "extra single"],
  ["Bel", "BEL", "Bel and the Dragon", "Bel", "Bel", ["bel and dragon"], "extra single"],
  ["Ps151", "PS2", "Psalm 151", "Ps 151", "Ps 151", ["ps2"], "extra single"],
  ["3Macc", "3MA", "3 Maccabees", "3 Macc", "3 Macc", ["3ma", "3mac"], "extra"],
  ["4Macc", "4MA", "4 Maccabees", "4 Macc", "4 Macc", ["4ma", "4mac"], "extra"],
  ["Odes", "ODA", "Odes", "Odes", "Odes", ["oda"], "extra"],
  ["PssSol", "PSS", "Psalms of Solomon", "Pss Sol", "Pss Sol", ["psalms of solomon", "pss"], "extra"],
  ["Jub", "JUB", "Jubilees", "Jub", "Jub", [], "extra"],
  ["1En", "ENO", "1 Enoch", "1 En", "1 En", ["enoch", "1 enoch"], "extra"],
];

export const BOOKS: Book[] = ROWS.map((r, i) => ({
  osis: r[0],
  usfm: r[1],
  num: i + 1,
  name: r[2],
  sbl: r[3],
  short: r[4],
  aliases: r[5],
  ...(r[6]?.includes("extra") && { extra: true }),
  ...(r[6]?.includes("single") && { single: true }),
}));

export const BOOK_BY_OSIS = new Map(BOOKS.map((b) => [b.osis, b]));
export const BOOK_BY_NUM = new Map(BOOKS.map((b) => [b.num, b]));
export const BOOK_BY_USFM = new Map(BOOKS.map((b) => [b.usfm, b]));

/** "1 Corinthians", "1cor", "I Cor." and "first corinthians" all become "1cor"-style keys. */
export function bookKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/\./g, " ")
    .replace(/^\s*(?:first|1st|i)\s+(?=[a-z])/, "1 ")
    .replace(/^\s*(?:second|2nd|ii)\s+(?=[a-z])/, "2 ")
    .replace(/^\s*(?:third|3rd|iii)\s+(?=[a-z])/, "3 ")
    .replace(/[^a-z0-9]/g, "");
}

const KEYS = new Map<string, Book>();
const ambiguous = new Set<string>();
const add = (key: string, b: Book) => {
  if (!key) return;
  const had = KEYS.get(key);
  if (had && had !== b) ambiguous.add(key);
  else KEYS.set(key, b);
};
// the Protestant books claim their own forms before the extras can
for (const b of [...BOOKS.filter((x) => !x.extra), ...BOOKS.filter((x) => x.extra)]) {
  for (const f of [b.osis, b.usfm, b.name, b.sbl, b.short, ...b.aliases]) add(bookKey(f), b);
}
// "ps" and "pss" and the like stay with the first book that claimed them
for (const k of ambiguous) if (!KEYS.has(k)) continue;

/** Find a book from what someone typed: an exact spelling, or an unambiguous start such as "deut" or "revel". */
export function findBook(text: string): Book | null {
  const key = bookKey(text);
  if (!key) return null;
  const exact = KEYS.get(key);
  if (exact) return exact;
  if (key.length < 3) return null;
  const hits = new Set<Book>();
  for (const [k, b] of KEYS) if (k.startsWith(key)) hits.add(b);
  return hits.size === 1 ? [...hits][0] : null;
}

export type BookNaming = "full" | "sbl" | "short";

export function bookName(b: Book, naming: BookNaming): string {
  return naming === "full" ? b.name : naming === "sbl" ? b.sbl : b.short;
}
