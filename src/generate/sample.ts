/** Choosing the next token. Pure. */

/** The most likely token, with tokens seen recently made less likely so the text does not loop. */
export function pickToken(logits: ArrayLike<number>, recent: number[], penalty = 1.1): number {
  const seen = new Set(recent);
  let best = 0;
  let bestScore = -Infinity;
  for (let i = 0; i < logits.length; i++) {
    let v = logits[i];
    if (seen.has(i)) v = v > 0 ? v / penalty : v * penalty;
    if (v > bestScore) {
      bestScore = v;
      best = i;
    }
  }
  return best;
}
