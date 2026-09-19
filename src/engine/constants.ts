// All simulation values are in logical arena units and ticks.
// The sim runs at a fixed 60 ticks per second so it is fully deterministic.

export const TICK_RATE = 60;
export const TICK_MS = 1000 / TICK_RATE;

export const ARENA_W = 900;
export const ARENA_H = 600;

/** One loop = 10 seconds = 4 bars at 96 BPM. */
export const LOOP_TICKS = 600;

export const PLAYER_RADIUS = 11;
export const PLAYER_SPEED = 4.3;
export const DIAGONAL = 0.7071067811865476;

/** Ghosts are intangible for the first moments of each loop. */
export const SPAWN_GRACE_TICKS = 45;
/** Passing within this extra distance of a ghost counts as a graze. */
export const GRAZE_MARGIN = 20;
/** Combo resets if no graze or orb happens within this window. */
export const COMBO_WINDOW_TICKS = 150;

export const ORB_RADIUS = 9;
export const ORB_MARGIN = 40;
export const ORB_MIN_DIST_FROM_PLAYER = 120;

/** Forget charge is earned every N completed loops. */
export const FORGET_EVERY_LOOPS = 3;
export const FORGET_MAX_CHARGES = 3;

export const SCORE_ORB = 100;
export const SCORE_GRAZE = 25;
export const SCORE_LOOP = 250;

// Input bitmask
export const IN_UP = 1;
export const IN_DOWN = 2;
export const IN_LEFT = 4;
export const IN_RIGHT = 8;
export const IN_FORGET = 16;

/** Orbs that must be collected in a loop to survive it. */
export function orbQuota(loop: number): number {
  if (loop <= 3) return 1;
  if (loop <= 7) return 2;
  return 3;
}

/** Orbs spawned at the start of a loop. */
export function orbCount(loop: number): number {
  return Math.min(3 + Math.floor(loop / 2), 7);
}
