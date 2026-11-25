/**
 * The look of a pin being edited: lifted off the map with a shadow beneath and a dotted ring round it, and an elastic ball that trails
 * the pointer while it is dragged and springs back to the pin. Used by both map engines, which only place `el` on the map.
 */

export interface EditPin {
  /** zero-sized element to anchor on the map; the ball and shadow are drawn around it */
  el: HTMLElement;
  /** the anchor moved by (dx, dy) screen pixels: the ball stays behind and then springs after it */
  kick(dx: number, dy: number): void;
  /** set the pin down: the lift, shadow and ring fade, then resolve */
  drop(): Promise<void>;
  /** stop animating and remove */
  destroy(): void;
}

const STIFFNESS = 0.18;
const DAMPING = 0.72;
const REST = 0.05;
/** how far behind the ball may trail, in pixels, so a fast drag does not fling it off screen */
const MAX_TRAIL = 36;

export function createEditPin(color: string): EditPin {
  const root = document.createElement("div");
  root.className = "booker-pin-edit";
  root.style.setProperty("--pin", color);
  const shadow = root.appendChild(document.createElement("div"));
  shadow.className = "booker-pin-shadow";
  const elastic = root.appendChild(document.createElement("div"));
  elastic.className = "booker-pin-elastic";
  const ball = elastic.appendChild(document.createElement("div"));
  ball.className = "booker-pin-ball";
  // start set down and lift on the next frame, so the lift animates
  requestAnimationFrame(() => root.classList.add("is-lifted"));

  let ox = 0;
  let oy = 0;
  let vx = 0;
  let vy = 0;
  let raf = 0;
  let dead = false;

  const step = () => {
    raf = 0;
    if (dead) return;
    vx = (vx - ox * STIFFNESS) * DAMPING;
    vy = (vy - oy * STIFFNESS) * DAMPING;
    ox += vx;
    oy += vy;
    if (Math.abs(ox) < REST && Math.abs(oy) < REST && Math.abs(vx) < REST && Math.abs(vy) < REST) {
      ox = oy = vx = vy = 0;
      elastic.style.transform = "";
      return;
    }
    elastic.style.transform = `translate(${ox.toFixed(2)}px, ${oy.toFixed(2)}px)`;
    // the shadow stays under the pin's true position and stretches a little with the trail
    shadow.style.transform = `scaleX(${(1 + Math.min(0.6, Math.hypot(ox, oy) / 60)).toFixed(2)})`;
    raf = requestAnimationFrame(step);
  };

  return {
    el: root,
    kick(dx, dy) {
      ox = Math.max(-MAX_TRAIL, Math.min(MAX_TRAIL, ox - dx));
      oy = Math.max(-MAX_TRAIL, Math.min(MAX_TRAIL, oy - dy));
      if (!raf) raf = requestAnimationFrame(step);
    },
    drop() {
      root.classList.remove("is-lifted");
      root.classList.add("is-dropping");
      return new Promise((resolve) => window.setTimeout(resolve, 260));
    },
    destroy() {
      dead = true;
      if (raf) cancelAnimationFrame(raf);
      root.remove();
    },
  };
}
