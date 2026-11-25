/** The installed English dictionary (WordNet), loaded once into a lookup index. */
import type BookerPlugin from "../main";
import { EnglishIndex } from "./lookup";

export class EnglishService {
  private index: EnglishIndex | null = null;
  private loading: Promise<EnglishIndex | null> | null = null;

  constructor(private plugin: BookerPlugin) {}

  /** The index when it has been loaded, without waiting. */
  peek(): EnglishIndex | null {
    return this.index;
  }

  /** Load the English dictionary module, if one is installed. */
  load(): Promise<EnglishIndex | null> {
    if (this.index) return Promise.resolve(this.index);
    this.loading ??= (async () => {
      try {
        const all = await this.plugin.modules.dictionaries();
        const pick = (re: RegExp) => all.find((m) => re.test(m.name) || re.test(m.path));
        // Open English WordNet is preferred over the older Princeton WordNet 3.0 download when both are there
        const file = pick(/open english wordnet/i) ?? pick(/wordnet/i);
        if (!file) return null;
        const mod = await this.plugin.modules.loadDictionary(file);
        const index = new EnglishIndex(mod.entries);
        const thes = pick(/moby/i);
        if (thes) index.setThesaurus((await this.plugin.modules.loadDictionary(thes)).entries);
        this.index = index;
        return this.index;
      } catch {
        return null;
      } finally {
        this.loading = null;
      }
    })();
    return this.loading;
  }

  /** Forget the loaded index, after a dictionary was added or removed. */
  reset() {
    this.index = null;
    this.loading = null;
  }
}
