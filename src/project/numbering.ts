/**
 * Scene numbering across a whole book. A scene is shown as "Scene 3" (or "Scene 3 - The Title" when it has a
 * title), and the number follows its place in the book, so moving a scene renumbers the ones around it.
 * The title property holds the whole label; the name is whatever follows "Scene N - ".
 */
const esc = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const numbered = (word: string) => new RegExp(`^(?:Scene|Section|${esc(word)})\\s+\\d+(?:\\s+[-–—]\\s+(.*))?$`, "i");

/** The part of a scene's title that the writer chose ("" for a plain "Scene 3"). */
export function sceneName(title: string, word = "Scene"): string {
  const t = title.trim();
  const m = numbered(word).exec(t);
  return m ? (m[1] ?? "").trim() : t;
}

export function sceneTitle(n: number, name: string, word = "Scene"): string {
  return name ? `${word} ${n} - ${name}` : `${word} ${n}`;
}

/** New titles for scenes given in reading order; only scenes whose title changes are returned. */
export function planRenumber(scenes: Array<{ path: string; title: string }>, word = "Scene"): Array<{ path: string; title: string }> {
  const out: Array<{ path: string; title: string }> = [];
  scenes.forEach((s, i) => {
    const title = sceneTitle(i + 1, sceneName(s.title, word), word);
    if (title !== s.title) out.push({ path: s.path, title });
  });
  return out;
}
