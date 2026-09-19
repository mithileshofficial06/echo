// Cosmetic effects only. Uses Math.random freely: nothing here feeds the sim.

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
}

export interface FloatText {
  text: string;
  x: number;
  y: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
  /** Screen-space banner (centered) instead of arena-space popup. */
  banner?: boolean;
}

export class Fx {
  particles: Particle[] = [];
  texts: FloatText[] = [];
  shake = 0;
  flash = 0;
  flashColor = "#fff";
  glitch = 0;

  burst(x: number, y: number, color: string, count: number, speed = 3, life = 40, size = 2.5) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.3 + Math.random() * 0.9);
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: life * (0.6 + Math.random() * 0.6),
        maxLife: life,
        size: size * (0.5 + Math.random()),
        color,
      });
    }
  }

  /** Dissolve a ghost into rising specks. */
  dissolve(x: number, y: number, color: string) {
    for (let i = 0; i < 36; i++) {
      this.particles.push({
        x: x + (Math.random() - 0.5) * 22,
        y: y + (Math.random() - 0.5) * 22,
        vx: (Math.random() - 0.5) * 1.2,
        vy: -0.5 - Math.random() * 1.8,
        life: 50 + Math.random() * 40,
        maxLife: 90,
        size: 1.5 + Math.random() * 2,
        color,
      });
    }
  }

  popup(text: string, x: number, y: number, color = "#fff", size = 14, life = 50) {
    this.texts.push({ text, x, y, life, maxLife: life, color, size });
  }

  banner(text: string, color = "#fff", size = 42, life = 80) {
    this.texts = this.texts.filter((t) => !t.banner);
    this.texts.push({ text, x: 0, y: 0, life, maxLife: life, color, size, banner: true });
  }

  addShake(amount: number) {
    this.shake = Math.max(this.shake, amount);
  }

  addFlash(amount: number, color = "#fff") {
    this.flash = Math.max(this.flash, amount);
    this.flashColor = color;
  }

  /** Advance by dt frames (1 = one 60Hz frame; smaller for slow motion). */
  update(dt: number) {
    for (const p of this.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= Math.pow(0.95, dt);
      p.vy *= Math.pow(0.95, dt);
      p.life -= dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);

    for (const t of this.texts) {
      t.life -= dt;
      if (!t.banner) t.y -= 0.6 * dt;
    }
    this.texts = this.texts.filter((t) => t.life > 0);

    this.shake *= Math.pow(0.88, dt);
    if (this.shake < 0.1) this.shake = 0;
    this.flash *= Math.pow(0.9, dt);
    if (this.flash < 0.01) this.flash = 0;
    this.glitch *= Math.pow(0.93, dt);
    if (this.glitch < 0.01) this.glitch = 0;
  }

  clear() {
    this.particles = [];
    this.texts = [];
    this.shake = this.flash = this.glitch = 0;
  }
}
