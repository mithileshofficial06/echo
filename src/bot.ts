import {
  ARENA_H,
  ARENA_W,
  DIAGONAL,
  IN_DOWN,
  IN_LEFT,
  IN_RIGHT,
  IN_UP,
  LOOP_TICKS,
  PLAYER_RADIUS,
  PLAYER_SPEED,
} from "./engine/constants";
import type { Sim } from "./engine/sim";

const DIRS: [number, number, number][] = [
  [0, 0, 0],
  [0, -1, IN_UP],
  [0, 1, IN_DOWN],
  [-1, 0, IN_LEFT],
  [1, 0, IN_RIGHT],
  [-DIAGONAL, -DIAGONAL, IN_LEFT | IN_UP],
  [DIAGONAL, -DIAGONAL, IN_RIGHT | IN_UP],
  [-DIAGONAL, DIAGONAL, IN_LEFT | IN_DOWN],
  [DIAGONAL, DIAGONAL, IN_RIGHT | IN_DOWN],
];
const LOOKAHEAD = 14;

/** A simple look-ahead bot that plays behind the main menu. Not perfect on purpose. */
export function createBot(): (sim: Sim) => number {
  let current = 0;
  return (sim) => {
    if (sim.tick % 3 !== 0) return current;

    const target = nearestOrb(sim);
    let best = -Infinity;
    for (const [dx, dy, bits] of DIRS) {
      let x = sim.px;
      let y = sim.py;
      let minD = Infinity;
      let toOrb = target ? Math.hypot(target[0] - x, target[1] - y) : 0;
      for (let t = 1; t <= LOOKAHEAD; t++) {
        x = clamp(x + dx * PLAYER_SPEED, PLAYER_RADIUS, ARENA_W - PLAYER_RADIUS);
        y = clamp(y + dy * PLAYER_SPEED, PLAYER_RADIUS, ARENA_H - PLAYER_RADIUS);
        const lt = Math.min(sim.loopTick + t, LOOP_TICKS - 1);
        for (const g of sim.ghosts) {
          if (g.forgotten) continue;
          const d = Math.hypot(g.path[lt * 2] - x, g.path[lt * 2 + 1] - y);
          if (d < minD) minD = d;
        }
        if (target) toOrb = Math.min(toOrb, Math.hypot(target[0] - x, target[1] - y) + t * 0.5);
      }
      const danger = minD < 34 ? 5000 : minD < 60 ? (60 - minD) * 10 : 0;
      const score = -toOrb - danger + (bits === 0 ? -20 : 0);
      if (score > best) {
        best = score;
        current = bits;
      }
    }
    return current;
  };
}

function nearestOrb(sim: Sim): [number, number] | null {
  let best: [number, number] | null = null;
  let bestD = Infinity;
  for (const o of sim.orbs) {
    if (!o.alive) continue;
    const d = Math.hypot(o.x - sim.px, o.y - sim.py);
    if (d < bestD) {
      bestD = d;
      best = [o.x, o.y];
    }
  }
  return best;
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}
