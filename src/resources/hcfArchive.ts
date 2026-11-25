/** Turning a downloaded HistoricalChristianFaith archive into libraries, one author at a time so memory stays small. Node only. */
import { commentaryLibrary, writingsLibrary, type CommentNote } from "./hcf";
import { readTarGz } from "./tar";
import { buildNlib, type NlibWriteMeta } from "../sources/nlibWrite";

export type HcfKind = "writings" | "commentaries";

export interface HcfLibrary {
  fileName: string;
  data: Uint8Array;
  title: string;
  /** commentaries: this Father's comments by verse */
  notes?: CommentNote[];
}

const safeName = (s: string) => s.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim().slice(0, 120);

/** Calls `onLibrary` for each author's finished library. `say` reports which author is being read. */
export async function convertHcf(kind: HcfKind, archive: string, onLibrary: (lib: HcfLibrary) => Promise<void>, say: (detail: string) => void, signal?: AbortSignal): Promise<number> {
  const wanted = kind === "writings" ? /\.html?$/i : /\.toml$/i;
  let owner = "";
  let batch: { path: string; text: string }[] = [];
  let made = 0;
  const flush = async () => {
    if (!owner || !batch.length) return;
    say(owner);
    const built = kind === "writings" ? writingsLibrary(owner, batch.map((f) => ({ path: f.path, html: f.text }))) : commentaryLibrary(owner, batch.map((f) => ({ name: f.path, text: f.text })));
    batch = [];
    if (!built) return;
    const m: NlibWriteMeta = built.meta;
    const data = await buildNlib(m, built.entries);
    await onLibrary({ fileName: `${safeName(m.title)}.nlib`, data, title: m.title, notes: (built as { notes?: CommentNote[] }).notes });
    made++;
  };
  for await (const f of readTarGz(archive, (n) => n.includes("/") && !n.startsWith(".") && wanted.test(n), signal)) {
    const slash = f.name.indexOf("/");
    const who = f.name.slice(0, slash);
    if (who !== owner) {
      await flush();
      owner = who;
    }
    batch.push({ path: f.name.slice(slash + 1), text: f.data.toString("utf8") });
  }
  await flush();
  return made;
}
