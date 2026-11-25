/** Reading the Berean translation tables from disk and writing one JSON file per book. Node only. */
import { createReadStream } from "fs";
import { createInterface } from "readline";
import { BereanParser, type IBook } from "../scripture/interlinear";

/** Calls `onBook` with each book's words (OSIS id, chapters). Returns how many books were made. */
export async function convertBerean(tsvPath: string, onBook: (osis: string, data: IBook) => Promise<void> | void, signal?: AbortSignal): Promise<number> {
  const pending: Array<Promise<void> | void> = [];
  let n = 0;
  const parser = new BereanParser((osis, data) => {
    n++;
    pending.push(onBook(osis, data));
  });
  const rl = createInterface({ input: createReadStream(tsvPath, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of rl) {
    if (signal?.aborted) {
      rl.close();
      throw new Error("Cancelled");
    }
    parser.push(line);
    if (pending.length > 2) await Promise.all(pending.splice(0));
  }
  parser.end();
  await Promise.all(pending);
  return n;
}
