/** Mulberry32: small, fast, deterministic PRNG. */
export class Rng {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0;
  }

  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }
}

/** FNV-1a hash of a string into a 32-bit seed. */
export function hashString(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** UTC date key, e.g. "2026-09-19". Everyone shares the same daily seed. */
export function dailyKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function dailySeed(key = dailyKey()): number {
  return hashString("echo-daily-" + key);
}
