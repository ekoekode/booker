/**
 * Fanning out pins that sit on top of each other. Pure: how many pins, the size of the dots and the first ring go in, and where each
 * dot goes (an offset from the centre, in pixels) comes out. Pins are laid on rings round the centre; the first ring starts at the top
 * and each further ring is staggered half a step so the dots nest instead of lining up.
 */

export interface FanSlot {
  dx: number;
  dy: number;
  ring: number;
}

export interface FanLayout {
  slots: FanSlot[];
  /** distance from the centre to the outside of the outermost dot */
  radius: number;
}

/** How many dots of `spacing` pixels fit on a ring of radius r (at least 3 for any ring after the first, never more than needed). */
const capacity = (r: number, spacing: number): number => Math.max(3, Math.floor((2 * Math.PI * r) / spacing));

export function fanLayout(n: number, spacing = 34, firstRing = 46): FanLayout {
  const slots: FanSlot[] = [];
  if (n <= 0) return { slots, radius: 0 };
  if (n === 1) return { slots: [{ dx: 0, dy: -firstRing, ring: 0 }], radius: firstRing + spacing / 2 };
  let left = n;
  let ring = 0;
  let r = firstRing;
  while (left > 0) {
    const here = Math.min(left, capacity(r, spacing));
    // spread what is left of the pins evenly round the ring so the last ring is not lopsided
    const offset = ring % 2 ? Math.PI / here : 0;
    for (let i = 0; i < here; i++) {
      const a = -Math.PI / 2 + offset + (2 * Math.PI * i) / here;
      slots.push({ dx: Math.round(Math.cos(a) * r * 100) / 100, dy: Math.round(Math.sin(a) * r * 100) / 100, ring });
    }
    left -= here;
    ring++;
    r += spacing + 6;
  }
  return { slots, radius: r - spacing - 6 + spacing / 2 };
}

/**
 * Pins on screen that are close enough to count as one stack: those within `tolerance` pixels of the pin that was clicked
 * (itself included), nearest first.
 */
export function stackAround<T extends { x: number; y: number }>(clicked: T, all: T[], toScreen: (p: T) => { x: number; y: number }, tolerance = 9): T[] {
  const c = toScreen(clicked);
  return all
    .map((p) => ({ p, d: Math.hypot(toScreen(p).x - c.x, toScreen(p).y - c.y) }))
    .filter((e) => e.d <= tolerance)
    .sort((a, b) => a.d - b.d)
    .map((e) => e.p);
}

/** Keep the whole fan on screen: move its centre in from the edges of a width by height area, leaving `margin` pixels. */
export function clampCentre(cx: number, cy: number, radius: number, width: number, height: number, margin = 12, top = 0, bottom = 0): { x: number; y: number } {
  const lo = (size: number, extra: number) => (size < 2 * (radius + margin) + extra ? size / 2 : radius + margin);
  const x = Math.min(Math.max(cx, lo(width, 0)), Math.max(width - lo(width, 0), lo(width, 0)));
  const yMin = radius + margin + top;
  const yMax = height - radius - margin - bottom;
  const y = yMin > yMax ? (yMin + yMax) / 2 : Math.min(Math.max(cy, yMin), yMax);
  return { x, y };
}
