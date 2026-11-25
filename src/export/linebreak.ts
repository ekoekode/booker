/** Optimal (least ragged) paragraph line breaking, in the spirit of Knuth-Plass but without hyphenation. */

export interface Box {
  width: number;
  /** whitespace before this box: a line may break here */
  space: boolean;
}

/**
 * Returns [start, end) index ranges, one per line.
 * `first` is the width of the first line (paragraph indent already removed), `rest` the width of the others.
 * `sp` is the natural width of a space.
 */
export function breakLines(boxes: Box[], first: number, rest: number, sp: number): [number, number][] {
  const n = boxes.length;
  if (n === 0) return [];
  const best = new Array<number>(n + 1).fill(Infinity);
  const prev = new Array<number>(n + 1).fill(-1);
  best[0] = 0;
  for (let i = 0; i < n; i++) {
    if (best[i] === Infinity) continue;
    const avail = i === 0 ? first : rest;
    let sum = 0;
    let gaps = 0;
    for (let j = i; j < n; j++) {
      if (j > i && boxes[j].space) gaps++;
      sum += boxes[j].width;
      const nat = sum + gaps * sp;
      const min = sum + gaps * sp * 0.75;
      if (min > avail + 0.01 && j > i) break;
      if (j + 1 < n && !boxes[j + 1].space) continue; // cannot break inside a glued word
      const last = j === n - 1;
      let cost: number;
      if (last) cost = nat <= avail ? 0 : (nat - avail) * 4;
      else {
        const slack = avail - nat;
        const ratio = gaps > 0 ? slack / (gaps * sp) : slack / avail;
        cost = ratio >= 0 ? ratio * ratio * 100 : ratio * ratio * 250;
        // a lone word on a line is nearly always wrong, unless the word really is long
        if (gaps === 0 && sum < avail * 0.6) cost += 6000;
      }
      const total = best[i] + cost + 20;
      if (total < best[j + 1]) {
        best[j + 1] = total;
        prev[j + 1] = i;
      }
    }
  }
  if (best[n] === Infinity) return greedy(boxes, first, rest, sp);
  const lines: [number, number][] = [];
  for (let j = n; j > 0; j = prev[j]) lines.unshift([prev[j], j]);
  return lines;
}

function greedy(boxes: Box[], first: number, rest: number, sp: number): [number, number][] {
  const lines: [number, number][] = [];
  let start = 0;
  let w = 0;
  let avail = first;
  for (let i = 0; i < boxes.length; i++) {
    const add = boxes[i].width + (i > start && boxes[i].space ? sp : 0);
    if (w + add > avail && i > start) {
      lines.push([start, i]);
      start = i;
      w = boxes[i].width;
      avail = rest;
    } else w += add;
  }
  lines.push([start, boxes.length]);
  return lines;
}
