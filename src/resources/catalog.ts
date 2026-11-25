/** The resources Booker can download. Models come from Hugging Face; each file lists its size and checksum so a download can be verified. */
import type { Resource } from "./types";
import { HCF_COMMENTARIES_URL, HCF_WRITINGS_URL } from "./hcf";
import { BEREAN_TABLES_BYTES, BEREAN_TABLES_URL } from "../scripture/interlinear";

const hf = (repo: string, path: string) => `https://huggingface.co/${repo}/resolve/main/${path}`;

const embed = (id: string, repo: string, label: string, note: string, license: string, size: number, sha256: string, tok: { size: number; cfg: number }, extra: Record<string, unknown>): Resource => ({
  id,
  group: "Search models",
  title: label,
  note,
  license,
  kind: "model",
  files: [
    { url: hf(repo, "onnx/model_quantized.onnx"), to: "model_quantized.onnx", size, sha256 },
    { url: hf(repo, "tokenizer.json"), to: "tokenizer.json", size: tok.size },
    { url: hf(repo, "tokenizer_config.json"), to: "tokenizer_config.json", size: tok.cfg },
  ],
  json: { id, label, dim: 384, pooling: "mean", maxTokens: 256, queryPrefix: "", file: "model_quantized.onnx", license, version: 1, ...extra },
});

export const MODEL_RESOURCES: Resource[] = [
  embed("bge-micro-v2", "TaylorAI/bge-micro-v2", "bge-micro-v2 (fastest)", "Finds passages by meaning. Small and quick; the one in the release zips.", "MIT", 17409774, "ed65e36025aa94cb74207dab863c85452919ec0ab7df3512092932aa22c9a33a", { size: 711661, cfg: 1564 }, {}),
  embed("all-MiniLM-L6-v2", "Xenova/all-MiniLM-L6-v2", "all-MiniLM-L6-v2 (balanced)", "A good all-round search model.", "Apache-2.0", 22972370, "afdb6f1a0e45b715d0bb9b11772f032c399babd23bfc31fed1c170afc848bdb1", { size: 711661, cfg: 366 }, {}),
  embed("bge-small-en-v1.5", "Xenova/bge-small-en-v1.5", "bge-small-en-v1.5 (best quality)", "The most accurate search model, a little slower.", "MIT", 34014426, "6c9c6101a956d62dfb5e7190c538226c0c5bb9cb27b651234b6df063ee7dbfe4", { size: 711396, cfg: 366 }, {
    pooling: "cls",
    maxTokens: 512,
    queryPrefix: "Represent this sentence for searching relevant passages: ",
  }),
  {
    id: "qwen2.5-0.5b-instruct",
    group: "Writing model",
    title: "Qwen2.5-0.5B-Instruct",
    note: "Writes the summaries. Runs on this computer.",
    license: "Apache-2.0",
    kind: "gen",
    files: [
      { url: hf("onnx-community/Qwen2.5-0.5B-Instruct", "onnx/model_q4.onnx"), to: "model_q4.onnx", size: 786156820, sha256: "09235a3b1c135cd04ef570e5053b5c079e028078a2cc5f76ba6a251e91bf3296" },
      { url: hf("onnx-community/Qwen2.5-0.5B-Instruct", "tokenizer.json"), to: "tokenizer.json", size: 7031673 },
      { url: hf("onnx-community/Qwen2.5-0.5B-Instruct", "tokenizer_config.json"), to: "tokenizer_config.json", size: 7849 },
      { url: hf("onnx-community/Qwen2.5-0.5B-Instruct", "config.json"), to: "config.json", size: 678 },
      { url: hf("onnx-community/Qwen2.5-0.5B-Instruct", "generation_config.json"), to: "generation_config.json", size: 242 },
    ],
    json: { id: "qwen2.5-0.5b-instruct", label: "Qwen2.5-0.5B-Instruct", file: "model_q4.onnx", license: "Apache-2.0", chunkWords: 450, promptTokensPerSec: 200, outputTokensPerSec: 18 },
  },
];

const library = (id: string, group: string, title: string, note: string, license: string, page: string, detect: string | undefined, sizeNote: string, extra: Partial<Resource> = {}): Resource => ({ id, group, title, note, license, kind: "library", files: [], page, detect, sizeNote, ...extra });

/** A Bible from eBible.org: a zip holding one USFX file, which Booker reads like any other Bible module. */
const ebible = (id: string, title: string, note: string, license: string, page: string, detect: string, code: string, size: number): Resource => ({
  id,
  group: "Bibles",
  title,
  note,
  license,
  kind: "bible",
  page,
  detect,
  files: [{ url: `https://ebible.org/Scriptures/${code}_usfx.zip`, to: `${code}_usfx.zip`, size }],
  sizeNote: "about 3 MB",
});

/** Reference libraries found so far. Those without a download here open their page; the rest are fetched and made into libraries. */
export const LIBRARY_RESOURCES: Resource[] = [
  library("hcf-writings", "Church writings", "Church Fathers: Writings", "The Fathers, apocrypha and early letters (HistoricalChristianFaith). Largely the Schaff and Roger Pearse collections.", "Public domain", "https://github.com/HistoricalChristianFaith/Writings-Database", "Church Fathers Writings|Writings Database", "about 290 MB download, made into one library per author", { kind: "archive", archive: { url: HCF_WRITINGS_URL, kind: "writings" } }),
  library("hcf-commentaries", "Church writings", "Church Fathers: Commentary", "Fathers' comments on each Bible verse (HistoricalChristianFaith).", "Not stated by the author", "https://github.com/HistoricalChristianFaith/Commentaries-Database", "Church Fathers Commentary|Commentaries Database", "about 130 MB download, made into one library per Father", { kind: "archive", archive: { url: HCF_COMMENTARIES_URL, kind: "commentaries" } }),
  library("tertullian", "Church writings", "Tertullian.org additional Fathers", "Roger Pearse's translations of texts left out of Schaff. Most of it is already inside the Writings database above.", "Mostly public domain; check each page", "https://www.tertullian.org/fathers/", undefined, "web pages", { kind: "catalogue", source: "tertullian" }),
  library("josephus", "Church writings", "Josephus, Antiquities of the Jews", "Whiston's translation (Project Gutenberg 2848).", "Public domain", "https://www.gutenberg.org/ebooks/2848", "Josephus", "about 3 MB"),
  ebible("bsb", "Berean Standard Bible", "Free to use and share.", "Public domain (dedicated)", "https://berean.bible/downloads.htm", "BSB|Berean", "engbsb", 3083384),
  {
    id: "berean-interlinear",
    group: "Bibles",
    title: "Berean Interlinear Bible",
    note: "The English under each Hebrew and Greek word, in the order of the original, every word tagged with its Strong's number. Pick it in a word study's verse list to see a word picked out exactly. Made here from the word-for-word data, which is downloaded first if you do not have it.",
    license: "Public domain (Berean Bible, 2023)",
    kind: "interlinear",
    files: [],
    sizeNote: "made here; about 82 MB of word-for-word data first if you do not have it",
  },
  ebible("web", "World English Bible", "A modern public-domain English translation.", "Public domain", "https://ebible.org/web/", "WEB|World English", "eng-web", 3300930),
  ebible("oeb", "Open English Bible", "An open modern English translation (Commonwealth edition).", "CC0", "https://openenglishbible.org/", "OEB|Open English", "engoebcw", 1283336),
  library("fordham", "Medieval and late antique", "Internet Medieval Sourcebook (Fordham)", "Lay piety, women's writings, laws and chronicles, 0 to 1500 AD.", "Mostly public domain; Fordham asks you not to republish it", "https://sourcebooks.fordham.edu/sbook.asp", undefined, "web pages", { kind: "catalogue", source: "fordham" }),
  library("monergism", "Medieval and late antique", "Monergism free ebook library", "About 1,500 public-domain and open-licence works as ePub and PDF.", "Varies by title", "https://www.monergism.com/", undefined, "ePub and PDF files"),
  library("papyri", "Papyri", "Duke Databank of Documentary Papyri (Christian letters)", "Letters of ordinary Christians in Roman Egypt, 3rd to 6th century. Only the Christian letters are fetched, not the whole 3 GB.", "CC BY 3.0", "https://github.com/papyri/idp.data", undefined, "subset of a 3 GB repository"),
];

export const CCEL_RESOURCE: Resource = {
  id: "ccel",
  group: "CCEL works",
  title: "Christian Classics Ethereal Library",
  note: "Every work CCEL publishes as ThML (about 1,300), made into Booker libraries. CCEL asks for 10 seconds between requests, so the full set takes hours; you can choose which works.",
  license: "Mostly public domain; CCEL claims its formatting. Personal and non-profit use.",
  kind: "catalogue",
  source: "ccel",
  files: [],
  page: "https://ccel.org/",
  sizeNote: "about 1,300 works",
};

const STEP = "https://raw.githubusercontent.com/STEPBible/STEPBible-Data/master/Lexicons/";
const OSS = "https://raw.githubusercontent.com/openscriptures/strongs/master/";
const dictionary = (id: string, title: string, note: string, license: string, url: string, to: string, dict: NonNullable<Resource["dict"]>, sizeNote: string): Resource => ({ id, group: "Word study", title, note, license, kind: "dictionary", files: [{ url, to }], dict, sizeNote });

/** Hebrew and Greek word study: the Berean word-for-word tables, and open dictionaries to look the words up in. */
export const WORDSTUDY_RESOURCES: Resource[] = [
  {
    id: "berean-wordstudy",
    group: "Word study",
    title: "Berean word-for-word Hebrew and Greek",
    note: "Under each verse in the Reader: the Hebrew or Greek words with transliteration, English and Strong's number. From the Berean Bible's translation tables.",
    license: "Public domain (Berean Bible, 2023)",
    kind: "wordstudy",
    files: [{ url: BEREAN_TABLES_URL, to: "bsb_tables.tsv", size: BEREAN_TABLES_BYTES }],
  },
  dictionary("strongs-hebrew", "Strong's Hebrew Dictionary", "8,600 Hebrew and Aramaic entries (Strong, 1894), from Open Scriptures.", "Public domain text; Open Scriptures file CC BY-SA", `${OSS}hebrew/strongs-hebrew-dictionary.js`, "strongs-hebrew-dictionary.js", { parse: "strongs-h", title: "Strong's Hebrew Dictionary", abbr: "StrongsH" }, "about 1 MB"),
  dictionary("strongs-greek", "Strong's Greek Dictionary", "5,500 Greek entries (Strong, 1890), from Open Scriptures.", "Public domain text; Open Scriptures file CC BY-SA", `${OSS}greek/strongs-greek-dictionary.js`, "strongs-greek-dictionary.js", { parse: "strongs-g", title: "Strong's Greek Dictionary", abbr: "StrongsG" }, "about 1 MB"),
  dictionary("step-hebrew", "STEPBible brief Hebrew lexicon", "Short definitions for Hebrew words and the extended Strong's numbers the Berean data does not split. Tyndale House.", "CC BY 4.0 (Tyndale House, STEPBible)", `${STEP}TBESH%20-%20Translators%20Brief%20lexicon%20of%20Extended%20Strongs%20for%20Hebrew%20-%20STEPBible.org%20CC%20BY.txt`, "tbesh.txt", { parse: "step-h", title: "STEPBible Brief Hebrew Lexicon", abbr: "TBESH" }, "about 3 MB"),
  dictionary("step-greek", "STEPBible brief Greek lexicon", "Short definitions for New Testament Greek words. Tyndale House.", "CC BY 4.0 (Tyndale House, STEPBible)", `${STEP}TBESG%20-%20Translators%20Brief%20lexicon%20of%20Extended%20Strongs%20for%20Greek%20-%20STEPBible.org%20CC%20BY.txt`, "tbesg.txt", { parse: "step-g", title: "STEPBible Brief Greek Lexicon", abbr: "TBESG" }, "about 5 MB"),
];

/** An English dictionary and thesaurus in one: Princeton WordNet 3.0, read into a dictionary module. */
export const ENGLISH_RESOURCES: Resource[] = [
  {
    id: "wordnet",
    group: "Dictionary and thesaurus",
    title: "WordNet English dictionary and thesaurus",
    note: "About 147,000 words with definitions and synonyms, for the Dictionary card and word suggestions. Princeton University.",
    license: "WordNet 3.0 licence (free to use, copy and redistribute with the notice)",
    kind: "dictionary",
    files: [{ url: "https://wordnetcode.princeton.edu/3.0/WNdb-3.0.tar.gz", to: "WNdb-3.0.tar.gz" }],
    dict: { parse: "wordnet", title: "WordNet English Dictionary", abbr: "WordNet" },
    sizeNote: "about 10 MB",
  },
];

const GEONAMES = "https://download.geonames.org/export";

/**
 * Place data for the Map: type a city, state, country or zip and get coordinates, offline. GeoNames, CC BY 4.0 (https://www.geonames.org).
 * Zip files are unpacked when they arrive (a file `x.zip` becomes `x.txt`); everything is kept in the plugin folder under `places/`.
 */
export const PLACES_RESOURCES: Resource[] = [
  {
    id: "places-cities",
    group: "Maps",
    title: "Places: cities and regions",
    note: "About 25,000 cities of 15,000 people or more, with their state or region and country. Lets you type a city on a note's Location and get its position.",
    license: "CC BY 4.0 (GeoNames)",
    kind: "places",
    files: [
      { url: `${GEONAMES}/dump/cities15000.zip`, to: "cities15000.zip" },
      { url: `${GEONAMES}/dump/admin1CodesASCII.txt`, to: "admin1CodesASCII.txt" },
      { url: `${GEONAMES}/dump/countryInfo.txt`, to: "countryInfo.txt" },
    ],
    sizeNote: "about 3 MB",
  },
  {
    id: "places-postal",
    group: "Maps",
    title: "Places: postal codes",
    note: "Zip and postal codes for most countries. Lets you type a zip or postcode, with or without a country.",
    license: "CC BY 4.0 (GeoNames)",
    kind: "places",
    files: [{ url: `${GEONAMES}/zip/allCountries.zip`, to: "postal.zip" }],
    sizeNote: "about 30 MB download, about 130 MB on disk",
  },
];

export const RESOURCES: Resource[] = [...MODEL_RESOURCES, ...ENGLISH_RESOURCES, ...PLACES_RESOURCES, ...WORDSTUDY_RESOURCES, ...LIBRARY_RESOURCES, CCEL_RESOURCE];

/** The folder under the plugin's own folder that a resource is kept in. */
export const resourceFolder = (r: Resource): string => (r.kind === "gen" ? "models-gen" : "models");
