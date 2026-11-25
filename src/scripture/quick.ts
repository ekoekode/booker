/** Fill in a typed reference without opening a window: the default Bible and verse style do the work. */
import { Notice } from "obsidian";
import type BookerPlugin from "../main";
import { formatVerses, type CopySettings } from "../reader/copySettings";
import { footnoteFor, type Quotation } from "../reader/quote";
import { BOOK_BY_OSIS } from "./books";
import { formatInsert, resolvePassage } from "./format";
import { plain } from "./module";
import { formatPassage, parseRefs } from "./ref";

/** The Markdown for "John 3:16" in the default Bible and style, or null (with a notice saying why). */
export async function quickScripture(plugin: BookerPlugin, ref: string): Promise<string | null> {
  const passages = parseRefs(ref);
  if (!passages) return null;
  const data = plugin.scriptureForBook();
  const files = await plugin.modules.bibles();
  if (!files.length) {
    new Notice(`Booker: no Bible modules found. Put one in the folder “${data.folder}” or use Booker: Add Bible module.`);
    return null;
  }
  const file = files.find((f) => f.path === data.defaultModule) ?? files[0];
  try {
    const mod = await plugin.modules.load(file);
    const text = formatInsert(mod, passages, data.style);
    if (!text) new Notice(`Booker: “${ref}” is not in ${mod.abbr || mod.name}.`);
    return text || null;
  } catch (e) {
    new Notice(`Booker: could not read ${file.name}. ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

/** "John 3:16" as the Reader's Insert button writes it: the default Bible's words set out by the copy settings, with a footnote naming the Bible and the passage. */
export async function quickQuotation(plugin: BookerPlugin, ref: string, copy: CopySettings): Promise<Quotation | null> {
  const passages = parseRefs(ref);
  if (!passages) return null;
  const data = plugin.scriptureForBook();
  const files = await plugin.modules.bibles();
  if (!files.length) {
    new Notice(`Booker: no Bible modules found. Put one in the folder “${data.folder}” or use Booker: Add Bible module.`);
    return null;
  }
  const file = files.find((f) => f.path === data.defaultModule) ?? files[0];
  try {
    const mod = await plugin.modules.load(file);
    const verses = passages.flatMap((p) => resolvePassage(mod, p).map((v) => ({ chapter: v.c, verse: v.v, text: plain(v.segs) })));
    const text = formatVerses(verses, copy);
    if (!text) {
      new Notice(`Booker: “${ref}” is not in ${mod.abbr || mod.name}.`);
      return null;
    }
    const cite = passages.map((p) => formatPassage(p, BOOK_BY_OSIS.get(p.book)!)).join("; ");
    return { text, footnote: footnoteFor(mod.abbr || mod.name, cite), ...(copy.letters && { letters: true }), ...(!copy.asQuote && { inline: true }) };
  } catch (e) {
    new Notice(`Booker: could not read ${file.name}. ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

/** The name of the Bible a reference is written out from (the default module), for a footnote. */
export async function defaultBibleName(plugin: BookerPlugin): Promise<string> {
  try {
    const data = plugin.scriptureForBook();
    const files = await plugin.modules.bibles();
    const file = files.find((f) => f.path === data.defaultModule) ?? files[0];
    if (!file) return "";
    const mod = await plugin.modules.load(file);
    return mod.name || mod.abbr || "";
  } catch {
    return "";
  }
}
