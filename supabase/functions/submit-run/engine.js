// src/engine/constants.ts
var TICK_RATE = 60;
var TICK_MS = 1e3 / TICK_RATE;
var ARENA_W = 900;
var ARENA_H = 600;
var LOOP_TICKS = 600;
var PLAYER_RADIUS = 11;
var PLAYER_SPEED = 4.3;
var DIAGONAL = 0.7071067811865476;
var SPAWN_GRACE_TICKS = 45;
var GRAZE_MARGIN = 20;
var COMBO_WINDOW_TICKS = 150;
var ORB_RADIUS = 9;
var ORB_PICKUP_BONUS = 5;
var ORB_MARGIN = 40;
var ORB_MIN_DIST_FROM_PLAYER = 120;
var FORGET_EVERY_LOOPS = 3;
var FORGET_MAX_CHARGES = 3;
var SCORE_ORB = 100;
var SCORE_GRAZE = 25;
var SCORE_LOOP = 250;
var IN_UP = 1;
var IN_DOWN = 2;
var IN_LEFT = 4;
var IN_RIGHT = 8;
var IN_FORGET = 16;
function orbQuota(loop) {
  if (loop <= 3) return 1;
  if (loop <= 7) return 2;
  return 3;
}
function orbCount(loop) {
  return Math.min(3 + Math.floor(loop / 2), 7);
}

// src/engine/rng.ts
var Rng = class {
  s;
  constructor(seed) {
    this.s = seed >>> 0;
  }
  next() {
    let t = this.s = this.s + 1831565813 >>> 0;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }
  range(min, max) {
    return min + this.next() * (max - min);
  }
};
function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function dailyKey(date = /* @__PURE__ */ new Date()) {
  return date.toISOString().slice(0, 10);
}
function dailySeed(key = dailyKey()) {
  return hashString("echo-daily-" + key);
}

// src/engine/sim.ts
var Sim = class {
  seed;
  rng;
  tick = 0;
  loopTick = 0;
  loop = 1;
  px = ARENA_W / 2;
  py = ARENA_H / 2;
  prevX = this.px;
  prevY = this.py;
  ghosts = [];
  currentPath = new Float64Array(LOOP_TICKS * 2);
  orbs = [];
  orbsThisLoop = 0;
  score = 0;
  orbsTotal = 0;
  combo = 0;
  maxCombo = 0;
  grazes = 0;
  forgets = 0;
  forgetCharges = 0;
  lastComboTick = 0;
  prevInput = 0;
  nextGhostId = 1;
  dead = false;
  deathCause = null;
  constructor(seed) {
    this.seed = seed >>> 0;
    this.rng = new Rng(this.seed);
    this.spawnOrbs();
  }
  get quota() {
    return orbQuota(this.loop);
  }
  get activeGhosts() {
    return this.ghosts.filter((g) => !g.forgotten);
  }
  get graceActive() {
    return this.loopTick < SPAWN_GRACE_TICKS;
  }
  ghostPos(g, loopTick = this.loopTick) {
    const i = Math.min(loopTick, LOOP_TICKS - 1) * 2;
    return [g.path[i], g.path[i + 1]];
  }
  step(input) {
    const events = [];
    if (this.dead) return events;
    this.prevX = this.px;
    this.prevY = this.py;
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
    if (this.combo > 0 && this.tick - this.lastComboTick > COMBO_WINDOW_TICKS) {
      events.push({ type: "comboLost", combo: this.combo });
      this.combo = 0;
    }
    this.tick++;
    this.loopTick++;
    if (this.loopTick >= LOOP_TICKS) this.endLoop(events);
    return events;
  }
  endLoop(events) {
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
      inGraze: false
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
  die(cause, events, ghost) {
    this.dead = true;
    this.deathCause = cause;
    events.push({ type: "death", cause, x: this.px, y: this.py, ghost });
  }
  spawnOrbs() {
    this.orbs = [];
    const n = orbCount(this.loop);
    for (let i = 0; i < n; i++) {
      let x = 0;
      let y = 0;
      for (let attempt = 0; attempt < 24; attempt++) {
        x = this.rng.range(ORB_MARGIN, ARENA_W - ORB_MARGIN);
        y = this.rng.range(ORB_MARGIN, ARENA_H - ORB_MARGIN);
        const farFromPlayer = dist2(x, y, this.px, this.py) > ORB_MIN_DIST_FROM_PLAYER * ORB_MIN_DIST_FROM_PLAYER;
        const farFromOrbs = this.orbs.every((o) => dist2(o.x, o.y, x, y) > 70 * 70);
        if (farFromPlayer && farFromOrbs) break;
      }
      this.orbs.push({ x, y, alive: true });
    }
  }
  /** Every recorded path, oldest first, including the unfinished final loop. */
  allPaths() {
    const out = this.ghosts.map((g) => ({
      loop: g.loop,
      path: g.path,
      length: LOOP_TICKS,
      forgotten: g.forgotten
    }));
    out.push({
      loop: this.loop,
      path: this.currentPath,
      length: Math.min(this.loopTick + 1, LOOP_TICKS),
      forgotten: false
    });
    return out;
  }
  summary() {
    return {
      score: this.score,
      loops: this.loop - 1,
      orbs: this.orbsTotal,
      maxCombo: this.maxCombo,
      grazes: this.grazes,
      forgets: this.forgets,
      ticks: this.tick
    };
  }
};
function simulate(seed, inputs) {
  const sim = new Sim(seed);
  for (let i = 0; i < inputs.length && !sim.dead; i++) sim.step(inputs[i]);
  return { ...sim.summary(), dead: sim.dead };
}
function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}
function dist2(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

// src/engine/replay.ts
function decodeInputs(encoded) {
  const bin = atob(encoded);
  let total = 0;
  for (let i = 1; i < bin.length; i += 2) total += bin.charCodeAt(i);
  const out = new Uint8Array(total);
  let o = 0;
  for (let i = 0; i + 1 < bin.length; i += 2) {
    const v = bin.charCodeAt(i);
    const n = bin.charCodeAt(i + 1);
    out.fill(v, o, o + n);
    o += n;
  }
  return out;
}
export {
  TICK_RATE,
  dailyKey,
  dailySeed,
  decodeInputs,
  simulate
};
