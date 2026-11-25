/** Putting word matches and meaning matches into one list. Pure. */

/** Reciprocal rank fusion: each list gives 1/(k+rank) to what it ranks, and the sums decide. Needs no matching scales. */
export function fuse<T>(lists: Array<{ items: T[]; weight?: number }>, key: (t: T) => string, k = 60): Array<{ item: T; score: number }> {
  const score = new Map<string, { item: T; score: number }>();
  for (const l of lists) {
    l.items.forEach((item, rank) => {
      const id = key(item);
      const cur = score.get(id) ?? { item, score: 0 };
      cur.score += (l.weight ?? 1) / (k + rank + 1);
      score.set(id, cur);
    });
  }
  return [...score.values()].sort((a, b) => b.score - a.score);
}
