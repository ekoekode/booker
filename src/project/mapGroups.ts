/**
 * Pins that are close together on screen are shown as one grey badge with a number, so a crowded place reads at a glance.
 * Pure: pins and a way to find where each one is on screen go in; singles and groups come out. Grouping is by distance on screen,
 * so it changes as you zoom: pins that are apart when you zoom in stand alone again.
 */

export interface Group<T> {
  /** where the badge goes, in the map's own units (the mean of its members) */
  x: number;
  y: number;
  members: T[];
}

export interface Grouped<T> {
  singles: T[];
  groups: Group<T>[];
}

export function groupByScreen<T extends { x: number; y: number }>(pins: T[], toScreen: (p: T) => { x: number; y: number }, radius = 14): Grouped<T> {
  interface Acc {
    members: T[];
    sx: number;
    sy: number;
    mx: number;
    my: number;
  }
  const cell = Math.max(1, radius);
  const grid = new Map<string, Acc[]>();
  const all: Acc[] = [];
  const keyOf = (cx: number, cy: number) => `${cx},${cy}`;
  for (const p of pins) {
    const s = toScreen(p);
    const cx = Math.floor(s.x / cell);
    const cy = Math.floor(s.y / cell);
    let home: Acc | null = null;
    let best = Infinity;
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const g of grid.get(keyOf(cx + dx, cy + dy)) ?? []) {
          const d = Math.hypot(g.sx / g.members.length - s.x, g.sy / g.members.length - s.y);
          if (d <= radius && d < best) {
            best = d;
            home = g;
          }
        }
    if (home) {
      home.members.push(p);
      home.sx += s.x;
      home.sy += s.y;
      home.mx += p.x;
      home.my += p.y;
    } else {
      const g: Acc = { members: [p], sx: s.x, sy: s.y, mx: p.x, my: p.y };
      all.push(g);
      const k = keyOf(cx, cy);
      grid.set(k, [...(grid.get(k) ?? []), g]);
    }
  }
  const singles: T[] = [];
  const groups: Group<T>[] = [];
  for (const g of all) {
    if (g.members.length === 1) singles.push(g.members[0]);
    else groups.push({ x: g.mx / g.members.length, y: g.my / g.members.length, members: g.members });
  }
  return { singles, groups };
}
