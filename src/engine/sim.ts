import {
  ARENA_H,
  ARENA_W,
  COMBO_WINDOW_TICKS,
  DIAGONAL,
  FORGET_EVERY_LOOPS,
  FORGET_MAX_CHARGES,
  GRAZE_MARGIN,
  IN_DOWN,
  IN_FORGET,
  IN_LEFT,
  IN_RIGHT,
  IN_UP,
  LOOP_TICKS,
  ORB_MARGIN,
  ORB_MIN_DIST_FROM_PLAYER,
  ORB_PICKUP_BONUS,
  ORB_RADIUS,
  PLAYER_RADIUS,
  PLAYER_SPEED,
  SCORE_GRAZE,
  SCORE_LOOP,
  SCORE_ORB,
  SPAWN_GRACE_TICKS,
  orbCount,
  orbQuota,
} from "./constants";
import { Rng } from "./rng";

export interface Ghost {
  id: number;
  /** The loop this ghost was recorded in (1-based). */
  loop: number;
  /** x,y pairs for every tick of its loop. */
  path: Float64Array;
  forgotten: boolean;
  inGraze: boolean;
}

export interface Orb {
  x: number;
  y: number;
  alive: boolean;
}

export type DeathCause = "collision" | "fade";

export type SimEvent =
  | { type: "orb"; x: number; y: number; points: number; combo: number }
  | { type: "graze"; x: number; y: number; points: number; combo: number }
  | { type: "comboLost"; combo: number }
  | { type: "forget"; ghost: Ghost }
  | { type: "loop"; loop: number; bonus: number; charged: boolean }
  | { type: "quotaMet" }
  | { type: "death"; cause: DeathCause; x: number; y: number; ghost?: Ghost };

export interface RunSummary {
  score: number;
  loops: number;
  orbs: number;
  maxCombo: number;
  grazes: number;
  forgets: number;
  ticks: number;
}

/**
 * Pure, deterministic ECHO simulation. Same seed + same input sequence
 * always produces the same run, which powers replays and score verification.
 */
export class Sim {
  readonly seed: number;
  private rng: Rng;

  tick = 0;
  loopTick = 0;
  loop = 1;

  px = ARENA_W / 2;
  py = ARENA_H / 2;
  prevX = this.px;
  prevY = this.py;

  ghosts: Ghost[] = [];
  currentPath = new Float64Array(LOOP_TICKS * 2);
  orbs: Orb[] = [];
  orbsThisLoop = 0;

  score = 0;
  orbsTotal = 0;
  combo = 0;
  maxCombo = 0;
  grazes = 0;
  forgets = 0;
  forgetCharges = 0;
  private lastComboTick = 0;
  private prevInput = 0;
  private nextGhostId = 1;

  dead = false;
  deathCause: DeathCause | null = null;

  constructor(seed: number) {
    this.seed = seed >>> 0;
    this.rng = new Rng(this.seed);
    this.spawnOrbs();
  }

  get quota(): number {
    return orbQuota(this.loop);
  }

  get activeGhosts(): Ghost[] {
    return this.ghosts.filter((g) => !g.forgotten);
  }

  get graceActive(): boolean {
    return this.loopTick < SPAWN_GRACE_TICKS;
  }

  ghostPos(g: Ghost, loopTick = this.loopTick): [number, number] {
    const i = Math.min(loopTick, LOOP_TICKS - 1) * 2;
    return [g.path[i], g.path[i + 1]];
  }

  step(input: number): SimEvent[] {
    const events: SimEvent[] = [];
    if (this.dead) return events;

    this.prevX = this.px;
    this.prevY = this.py;

    // Forget: edge-triggered, erases the oldest active ghost.
    if (input & IN_FORGET && !(this.prevInput & IN_FORGET) && this.forgetCharges > 0) {
      const oldest = this.ghosts.find((g) => !g.forgotten);
      if (oldest) {
        oldest.forgotten = true;
        this.forgetCharges--;
        this.forgets++;
        events.push({ type: "forget", ghost: oldest });
      }
    }
    this.prevInput = input;

    // Movement
    let dx = 0;
    let dy = 0;
    if (input & IN_LEFT) dx -= 1;
    if (input & IN_RIGHT) dx += 1;
    if (input & IN_UP) dy -= 1;
    if (input & IN_DOWN) dy += 1;
    if (dx !== 0 && dy !== 0) {
      dx *= DIAGONAL;
      dy *= DIAGONAL;
    }
    this.px = clamp(this.px + dx * PLAYER_SPEED, PLAYER_RADIUS, ARENA_W - PLAYER_RADIUS);
    this.py = clamp(this.py + dy * PLAYER_SPEED, PLAYER_RADIUS, ARENA_H - PLAYER_RADIUS);

    this.currentPath[this.loopTick * 2] = this.px;
    this.currentPath[this.loopTick * 2 + 1] = this.py;

    // Orbs
    const pickR = PLAYER_RADIUS + ORB_RADIUS + ORB_PICKUP_BONUS;
    for (const orb of this.orbs) {
      if (!orb.alive) continue;
      if (dist2(orb.x, orb.y, this.px, this.py) < pickR * pickR) {
        orb.alive = false;
        const points = Math.round(SCORE_ORB * (1 + this.combo * 0.2));
        this.score += points;
        this.orbsTotal++;
        this.orbsThisLoop++;
        events.push({ type: "orb", x: orb.x, y: orb.y, points, combo: this.combo });
        if (this.orbsThisLoop === this.quota) events.push({ type: "quotaMet" });
      }
    }

    // Ghosts: collide or graze
    const hitR = PLAYER_RADIUS * 2;
    const grazeR = hitR + GRAZE_MARGIN;
    const solid = !this.graceActive;
    for (const g of this.ghosts) {
      if (g.forgotten) continue;
      const [gx, gy] = this.ghostPos(g);
      const d2 = dist2(gx, gy, this.px, this.py);
      if (solid && d2 < hitR * hitR) {
        this.die("collision", events, g);
        return events;
      }
      if (solid && d2 < grazeR * grazeR) {
        if (!g.inGraze) {
          g.inGraze = true;
          this.combo++;
          this.grazes++;
          this.maxCombo = Math.max(this.maxCombo, this.combo);
          this.lastComboTick = this.tick;
          const points = SCORE_GRAZE * this.combo;
          this.score += points;
          events.push({ type: "graze", x: gx, y: gy, points, combo: this.combo });
        }
      } else {
        g.inGraze = false;
      }
    }

    // Combo decay
    if (this.combo > 0 && this.tick - this.lastComboTick > COMBO_WINDOW_TICKS) {
      events.push({ type: "comboLost", combo: this.combo });
      this.combo = 0;
    }

    this.tick++;
    this.loopTick++;

    if (this.loopTick >= LOOP_TICKS) this.endLoop(events);
    return events;
  }

  private endLoop(events: SimEvent[]) {
    if (this.orbsThisLoop < this.quota) {
      this.loopTick = LOOP_TICKS - 1;
      this.die("fade", events);
      return;
    }

    this.ghosts.push({
      id: this.nextGhostId++,
      loop: this.loop,
      path: this.currentPath,
      forgotten: false,
      inGraze: false,
    });
    this.currentPath = new Float64Array(LOOP_TICKS * 2);

    const bonus = SCORE_LOOP * this.loop;
    this.score += bonus;

    let charged = false;
    if (this.loop % FORGET_EVERY_LOOPS === 0 && this.forgetCharges < FORGET_MAX_CHARGES) {
      this.forgetCharges++;
      charged = true;
    }

    this.loop++;
    this.loopTick = 0;
    this.orbsThisLoop = 0;
    for (const g of this.ghosts) g.inGraze = false;
    this.spawnOrbs();
    events.push({ type: "loop", loop: this.loop, bonus, charged });
  }

  private die(cause: DeathCause, events: SimEvent[], ghost?: Ghost) {
    this.dead = true;
    this.deathCause = cause;
    events.push({ type: "death", cause, x: this.px, y: this.py, ghost });
  }

  private spawnOrbs() {
    this.orbs = [];
    const n = orbCount(this.loop);
    for (let i = 0; i < n; i++) {
      let x = 0;
      let y = 0;
      for (let attempt = 0; attempt < 24; attempt++) {
        x = this.rng.range(ORB_MARGIN, ARENA_W - ORB_MARGIN);
        y = this.rng.range(ORB_MARGIN, ARENA_H - ORB_MARGIN);
        const farFromPlayer =
          dist2(x, y, this.px, this.py) > ORB_MIN_DIST_FROM_PLAYER * ORB_MIN_DIST_FROM_PLAYER;
        const farFromOrbs = this.orbs.every((o) => dist2(o.x, o.y, x, y) > 70 * 70);
        if (farFromPlayer && farFromOrbs) break;
      }
      this.orbs.push({ x, y, alive: true });
    }
  }

  /** Every recorded path, oldest first, including the unfinished final loop. */
  allPaths(): { loop: number; path: Float64Array; length: number; forgotten: boolean }[] {
    const out = this.ghosts.map((g) => ({
      loop: g.loop,
      path: g.path,
      length: LOOP_TICKS,
      forgotten: g.forgotten,
    }));
    out.push({
      loop: this.loop,
      path: this.currentPath,
      length: Math.min(this.loopTick + 1, LOOP_TICKS),
      forgotten: false,
    });
    return out;
  }

  summary(): RunSummary {
    return {
      score: this.score,
      loops: this.loop - 1,
      orbs: this.orbsTotal,
      maxCombo: this.maxCombo,
      grazes: this.grazes,
      forgets: this.forgets,
      ticks: this.tick,
    };
  }
}

/** Re-run a whole game from its seed and inputs. Used for replays and verification. */
export function simulate(seed: number, inputs: ArrayLike<number>): RunSummary & { dead: boolean } {
  const sim = new Sim(seed);
  for (let i = 0; i < inputs.length && !sim.dead; i++) sim.step(inputs[i]);
  return { ...sim.summary(), dead: sim.dead };
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}
