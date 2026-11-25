import { Notice } from "obsidian";
import type BookerPlugin from "../main";
import { VectorBlock } from "./vectors";

/** Passages and questions that share few words with them, to see whether a model finds meaning rather than spelling. */
export const CORPUS = [
  "My engine kept stalling at red lights, and the mechanic said the fuel pump was failing and would leave me stranded.",
  "The old farmer rose before dawn to milk the cows and mend the fence before the storm came in from the west.",
  "Grace is the unearned favour of God, given to sinners who could never pay for their own forgiveness.",
  "Justification means that God declares the believer righteous because of Christ, not because of anything the believer has done.",
  "She walked the empty corridors of the hospital at night, waiting for news about her father's surgery.",
  "The council met in Nicaea to settle the dispute over whether the Son was of the same substance as the Father.",
  "He sold his shop, packed two suitcases, and took the night train to a city where nobody knew his name.",
  "Early Christians were accused of atheism because they refused to offer incense to the emperor's image.",
  "The soup needs more salt, a little lemon, and ten more minutes on a low flame before it is served.",
  "Augustine confessed that his heart was restless until it found its rest in God.",
  "The ship's captain ordered the sails reefed as the barometer fell and the horizon turned black.",
  "Baptism was administered to new believers after a long period of instruction and fasting, usually at Easter.",
  "The detective noticed that the clock in the study had stopped at ten past nine, though the widow insisted she heard nothing.",
  "Tertullian argued that the blood of the martyrs is the seed of the church.",
  "Interest rates rose again this quarter, making it harder for young families to afford a first home.",
  "The prophet condemned those who trample the poor and sell the needy for a pair of sandals.",
  "After the funeral the family gathered in the kitchen, sharing stories about his terrible jokes and his generosity.",
  "Irenaeus taught that Christ recapitulated Adam, undoing in obedience what the first man did in disobedience.",
  "The software update broke the login screen, and thousands of customers were locked out for the whole afternoon.",
  "In the parable, a father runs to meet his wayward son while he is still far off and throws a feast for him.",
  "The monks rose at midnight to chant the psalms, and again at dawn, and seven times through the day.",
  "A cold front is expected overnight, with frost on low ground and snow possible above a thousand metres.",
  "Chrysostom preached that wealth hoarded while the poor go hungry is theft from the table of Christ.",
  "The child would not sleep until her mother sang the same quiet song she had sung every night since the baby was born.",
];

export const QUERIES: Array<[string, number]> = [
  ["car trouble", 0],
  ["farm chores before bad weather", 1],
  ["undeserved forgiveness from God", 2],
  ["being declared righteous by faith alone", 3],
  ["worried waiting in a medical building", 4],
  ["early church debate about the divinity of Christ", 5],
  ["leaving everything behind to start over", 6],
  ["why Romans persecuted believers", 7],
  ["cooking instructions", 8],
  ["longing of the soul for God", 9],
  ["preparing for a storm at sea", 10],
  ["how new converts were initiated", 11],
  ["a mystery about a stopped clock", 12],
  ["persecution makes the church grow", 13],
  ["housing affordability and the economy", 14],
  ["prophetic warning against exploiting the poor", 15],
  ["remembering a loved one after their death", 16],
  ["Christ as the second Adam", 17],
  ["technology failure locking users out", 18],
  ["the prodigal son", 19],
  ["monastic prayer schedule", 20],
  ["winter weather forecast", 21],
  ["rich people ignoring hunger", 22],
  ["a mother's lullaby", 23],
];

export interface ModelReport {
  model: string;
  backend: string;
  loadMs: number;
  chunksPerSec: number;
  top1: number;
  top3: number;
  error?: string;
}

/** Runs every installed model over the corpus and writes the speed and hit rate to the plugin folder. */
export async function runSelfTest(plugin: BookerPlugin): Promise<ModelReport[]> {
  const reports: ModelReport[] = [];
  const models = await plugin.semantic.models(true);
  if (!models.length) {
    new Notice("Booker: no models are installed in the plugin's models folder.");
    return reports;
  }
  for (const info of models) {
    try {
      const t0 = performance.now();
      const e = await plugin.semantic.embedder(info);
      const loadMs = performance.now() - t0;
      await e.embed(CORPUS.slice(0, 4));
      const t1 = performance.now();
      const docs = await e.embed(CORPUS);
      const long = Array.from({ length: 96 }, (_, i) => CORPUS[i % CORPUS.length] + " " + CORPUS[(i * 7 + 3) % CORPUS.length] + " " + CORPUS[(i * 5 + 1) % CORPUS.length]);
      const t2 = performance.now();
      await e.embed(long);
      const cps = long.length / ((performance.now() - t2) / 1000);
      void t1;
      const block = VectorBlock.from(e.dim, docs);
      const qs = await e.embed(QUERIES.map(([q]) => info.queryPrefix + q));
      let top1 = 0;
      let top3 = 0;
      QUERIES.forEach(([, want], i) => {
        const hits = block.nearest(qs[i], 3).map((h) => h.index);
        if (hits[0] === want) top1++;
        if (hits.includes(want)) top3++;
      });
      reports.push({ model: info.id, backend: e.backend, loadMs: Math.round(loadMs), chunksPerSec: Math.round(cps * 10) / 10, top1: top1 / QUERIES.length, top3: top3 / QUERIES.length });
    } catch (err) {
      reports.push({ model: info.id, backend: "none", loadMs: 0, chunksPerSec: 0, top1: 0, top3: 0, error: err instanceof Error ? err.message : String(err) });
    }
  }
  await plugin.semantic.close();
  try {
    await plugin.app.vault.adapter.write(`${plugin.manifest.dir}/selftest.json`, JSON.stringify(reports, null, 2));
  } catch {
    /* the notice still shows it */
  }
  new Notice(reports.map((r) => (r.error ? `${r.model}: ${r.error}` : `${r.model}: ${r.chunksPerSec} chunks/s, top-3 ${Math.round(r.top3 * 100)}%`)).join("\n"), 40000);
  return reports;
}
