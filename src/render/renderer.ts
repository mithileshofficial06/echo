import { ARENA_H, ARENA_W, GRAZE_MARGIN, LOOP_TICKS, ORB_RADIUS, PLAYER_RADIUS, TICK_RATE } from "../engine/constants";
import type { Ghost, Sim } from "../engine/sim";
import type { Joystick } from "../input";
import { JOY_RADIUS } from "../input";
import type { Fx } from "./fx";

export const ACCENT = "#00f0ff";
export const DANGER = "#ff2e4d";
export const FONT = '"JetBrains Mono", ui-monospace, Consolas, monospace';

const TRAIL_TICKS = 22;
const PREVIEW_TICKS = 36;

export interface RenderOptions {
  alpha: number;
  time: number;
  hud: boolean;
  label?: string;
}

/** Draws the arena, sim state, effects and HUD onto the main canvas. */
export class Renderer {
  readonly ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;
  rotated = false;
  private scale = 1;
  private cx = 0;
  private cy = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);

    this.rotated = this.h > this.w * 1.05;
    const dw = this.rotated ? ARENA_H : ARENA_W;
    const dh = this.rotated ? ARENA_W : ARENA_H;
    const top = this.w < 600 ? 64 : 84;
    const bottom = this.rotated ? 110 : 24;
    const side = 16;
    this.scale = Math.min((this.w - side * 2) / dw, (this.h - top - bottom) / dh);
    this.cx = this.w / 2;
    this.cy = top + (this.h - top - bottom) / 2;
  }

  /** Arena coordinates -> screen (CSS pixel) coordinates. */
  toScreen(ax: number, ay: number): [number, number] {
    const x = (ax - ARENA_W / 2) * this.scale;
    const y = (ay - ARENA_H / 2) * this.scale;
    return this.rotated ? [this.cx - y, this.cy + x] : [this.cx + x, this.cy + y];
  }

  private get arenaTop(): number {
    const dh = (this.rotated ? ARENA_W : ARENA_H) * this.scale;
    return this.cy - dh / 2;
  }

  private beginArena(shakeX: number, shakeY: number) {
    const c = this.ctx;
    c.save();
    c.translate(this.cx + shakeX, this.cy + shakeY);
    if (this.rotated) c.rotate(Math.PI / 2);
    c.scale(this.scale, this.scale);
    c.translate(-ARENA_W / 2, -ARENA_H / 2);
  }

  draw(sim: Sim, fx: Fx, joy: Joystick | null, opt: RenderOptions) {
    const c = this.ctx;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.fillStyle = "#000";
    c.fillRect(0, 0, this.w, this.h);

    const sx = fx.shake ? (Math.random() - 0.5) * fx.shake * 2 : 0;
    const sy = fx.shake ? (Math.random() - 0.5) * fx.shake * 2 : 0;

    this.beginArena(sx, sy);
    this.drawArena(sim, opt.time);
    this.drawTemporalField(sim, opt);
    this.drawOrbs(sim, opt.time);
    this.drawGhosts(sim, opt);
    this.drawPlayer(sim, opt);
    this.drawParticles(fx);
    c.restore();

    this.drawTexts(fx);
    if (opt.hud) this.drawHud(sim, opt);
    if (joy?.active) this.drawJoystick(joy);

    if (fx.flash > 0) {
      c.globalAlpha = Math.min(fx.flash, 1) * 0.5;
      c.fillStyle = fx.flashColor;
      c.fillRect(0, 0, this.w, this.h);
      c.globalAlpha = 1;
    }
    if (fx.glitch > 0) this.drawGlitch(fx.glitch);
  }

  private drawArena(sim: Sim, time: number) {
    const c = this.ctx;

    // Dot grid
    c.fillStyle = "rgba(255,255,255,0.07)";
    for (let x = 50; x < ARENA_W; x += 50) {
      for (let y = 50; y < ARENA_H; y += 50) c.fillRect(x - 1, y - 1, 2, 2);
    }

    // Border, with the loop timer tracing around it clockwise.
    c.lineWidth = 2 / this.scale;
    c.strokeStyle = "rgba(255,255,255,0.14)";
    c.strokeRect(0, 0, ARENA_W, ARENA_H);

    const progress = sim.loopTick / LOOP_TICKS;
    const urgent = sim.orbsThisLoop < sim.quota && LOOP_TICKS - sim.loopTick < TICK_RATE * 3;
    const color = urgent && Math.floor(time * 8) % 2 === 0 ? DANGER : ACCENT;
    this.tracePerimeter(progress, color, 3 / this.scale);
  }

  private tracePerimeter(t: number, color: string, width: number) {
    const c = this.ctx;
    const per = 2 * (ARENA_W + ARENA_H);
    let remain = t * per;
    const pts: [number, number][] = [[0, 0]];
    const corners: [number, number, number][] = [
      [ARENA_W, 0, ARENA_W],
      [ARENA_W, ARENA_H, ARENA_H],
      [0, ARENA_H, ARENA_W],
      [0, 0, ARENA_H],
    ];
    let [px, py] = [0, 0];
    for (const [x, y, len] of corners) {
      if (remain >= len) {
        pts.push([x, y]);
        remain -= len;
        [px, py] = [x, y];
      } else {
        const f = remain / len;
        pts.push([px + (x - px) * f, py + (y - py) * f]);
        break;
      }
    }
    c.save();
    c.strokeStyle = color;
    c.lineWidth = width;
    c.shadowColor = color;
    c.shadowBlur = 12;
    c.beginPath();
    c.moveTo(pts[0][0], pts[0][1]);
    for (const [x, y] of pts.slice(1)) c.lineTo(x, y);
    c.stroke();
    c.restore();
  }

  private drawOrbs(sim: Sim, time: number) {
    const c = this.ctx;
    const quotaMet = sim.orbsThisLoop >= sim.quota;
    for (let i = 0; i < sim.orbs.length; i++) {
      const o = sim.orbs[i];
      if (!o.alive) continue;
      const pulse = 1 + Math.sin(time * 5 + i * 1.7) * 0.15;
      const r = ORB_RADIUS * pulse;
      c.save();
      c.translate(o.x, o.y);
      c.rotate(time * 1.5 + i);
      c.shadowColor = quotaMet ? ACCENT : "#fff";
      c.shadowBlur = 16;
      c.fillStyle = quotaMet ? "rgba(0,240,255,0.55)" : "#fff";
      c.beginPath();
      c.moveTo(0, -r);
      c.lineTo(r, 0);
      c.lineTo(0, r);
      c.lineTo(-r, 0);
      c.closePath();
      c.fill();
      c.restore();
    }
  }

  /**
   * A quiet visual map of the timeline: every active echo bends the arena's
   * signal around the player. It makes the central idea readable at a glance
   * without adding a new rule or changing deterministic simulation.
   */
  private drawTemporalField(sim: Sim, opt: RenderOptions) {
    const c = this.ctx;
    const active = sim.activeGhosts;
    const px = sim.prevX + (sim.px - sim.prevX) * opt.alpha;
    const py = sim.prevY + (sim.py - sim.prevY) * opt.alpha;

    c.save();
    c.strokeStyle = ACCENT;
    c.lineWidth = 1;
    for (let ring = 0; ring < 3; ring++) {
      const radius = 38 + ring * 27 + ((opt.time * 20 + ring * 11) % 27);
      c.globalAlpha = 0.035 + active.length * 0.008;
      c.setLineDash([2, 9]);
      c.lineDashOffset = -opt.time * 12 - ring * 5;
      c.beginPath();
      c.arc(px, py, radius, 0, Math.PI * 2);
      c.stroke();
    }
    c.setLineDash([]);

    // Echoes form a temporary constellation with the living player.
    if (active.length > 0) {
      c.globalAlpha = Math.min(0.055 + active.length * 0.012, 0.16);
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(px, py);
      active.forEach((g) => {
        const [x, y] = this.ghostRenderPos(sim, g, opt.alpha);
        c.lineTo(x, y);
        c.moveTo(px, py);
      });
      c.stroke();
      active.forEach((g, i) => {
        const [x, y] = this.ghostRenderPos(sim, g, opt.alpha);
        c.globalAlpha = 0.14 + ((i + 1) / active.length) * 0.12;
        c.beginPath();
        c.arc(x, y, PLAYER_RADIUS + 5 + Math.sin(opt.time * 3 + i) * 2, 0, Math.PI * 2);
        c.stroke();
      });
    }
    c.restore();
  }

  private ghostIndex(sim: Sim): number {
    return sim.dead ? sim.loopTick : Math.max(sim.loopTick - 1, 0);
  }

  ghostRenderPos(sim: Sim, g: Ghost, alpha: number): [number, number] {
    const i = this.ghostIndex(sim);
    const j = Math.max(i - 1, 0);
    const a = sim.dead ? 1 : alpha;
    return [
      g.path[j * 2] + (g.path[i * 2] - g.path[j * 2]) * a,
      g.path[j * 2 + 1] + (g.path[i * 2 + 1] - g.path[j * 2 + 1]) * a,
    ];
  }

  private drawGhosts(sim: Sim, opt: RenderOptions) {
    const c = this.ctx;
    const active = sim.activeGhosts;
    const n = active.length;
    const idx = this.ghostIndex(sim);
    const grace = sim.graceActive && !sim.dead;

    active.forEach((g, k) => {
      const recency = (k + 1) / n;
      let alpha = 0.3 + 0.6 * recency;
      if (grace) alpha *= 0.25 + 0.2 * Math.sin(opt.time * 40 + k);

      // Faint preview of where this ghost is about to go.
      c.save();
      c.strokeStyle = ACCENT;
      c.globalAlpha = alpha * 0.18;
      c.lineWidth = 2;
      c.setLineDash([3, 7]);
      c.beginPath();
      const end = Math.min(idx + PREVIEW_TICKS, LOOP_TICKS - 1);
      c.moveTo(g.path[idx * 2], g.path[idx * 2 + 1]);
      for (let t = idx + 3; t <= end; t += 3) c.lineTo(g.path[t * 2], g.path[t * 2 + 1]);
      c.stroke();
      c.restore();

      // Trail
      this.drawTrail(g.path, idx, ACCENT, alpha * 0.5, PLAYER_RADIUS * 1.4);

      const [x, y] = this.ghostRenderPos(sim, g, opt.alpha);
      c.save();
      c.globalAlpha = alpha;
      c.shadowColor = ACCENT;
      c.shadowBlur = 18;
      c.fillStyle = "rgba(0,240,255,0.18)";
      c.strokeStyle = ACCENT;
      c.lineWidth = 2;
      c.beginPath();
      c.arc(x, y, PLAYER_RADIUS, 0, Math.PI * 2);
      c.fill();
      c.stroke();
      c.restore();

      // Graze tether: the "SYNC" link between you and your past.
      if (g.inGraze && !sim.dead) {
        const px = sim.prevX + (sim.px - sim.prevX) * opt.alpha;
        const py = sim.prevY + (sim.py - sim.prevY) * opt.alpha;
        c.save();
        c.strokeStyle = ACCENT;
        c.lineWidth = 2;
        c.shadowColor = ACCENT;
        c.shadowBlur = 10;
        c.beginPath();
        c.moveTo(x, y);
        c.lineTo(px, py);
        c.stroke();
        c.globalAlpha = 0.35;
        c.beginPath();
        c.arc(x, y, PLAYER_RADIUS * 2 + GRAZE_MARGIN, 0, Math.PI * 2);
        c.stroke();
        c.restore();
      }
    });
  }

  private drawTrail(path: Float64Array, idx: number, color: string, alpha: number, width: number) {
    const c = this.ctx;
    const start = Math.max(idx - TRAIL_TICKS, 0);
    if (idx - start < 2) return;
    c.save();
    c.strokeStyle = color;
    c.lineCap = "round";
    for (let t = start + 1; t <= idx; t++) {
      const f = (t - start) / (idx - start);
      c.globalAlpha = alpha * f * 0.6;
      c.lineWidth = width * f;
      c.beginPath();
      c.moveTo(path[(t - 1) * 2], path[(t - 1) * 2 + 1]);
      c.lineTo(path[t * 2], path[t * 2 + 1]);
      c.stroke();
    }
    c.restore();
  }

  private drawPlayer(sim: Sim, opt: RenderOptions) {
    const c = this.ctx;
    if (sim.dead) return;
    const idx = Math.max(sim.loopTick - 1, 0);
    if (sim.loopTick > 1) this.drawTrail(sim.currentPath, idx, "#fff", 0.8, PLAYER_RADIUS * 1.5);

    const x = sim.prevX + (sim.px - sim.prevX) * opt.alpha;
    const y = sim.prevY + (sim.py - sim.prevY) * opt.alpha;
    c.save();
    c.shadowColor = "#fff";
    c.shadowBlur = 22;
    c.fillStyle = "#fff";
    c.beginPath();
    c.arc(x, y, PLAYER_RADIUS, 0, Math.PI * 2);
    c.fill();
    // A small directional cut makes the living player feel distinct from a ghost.
    const dx = sim.px - sim.prevX;
    const dy = sim.py - sim.prevY;
    if (dx || dy) {
      const a = Math.atan2(dy, dx);
      c.rotate(a);
      c.fillStyle = ACCENT;
      c.beginPath();
      c.moveTo(PLAYER_RADIUS + 7, 0);
      c.lineTo(PLAYER_RADIUS + 1, -4);
      c.lineTo(PLAYER_RADIUS + 1, 4);
      c.closePath();
      c.fill();
    }
    c.restore();
  }

  private drawParticles(fx: Fx) {
    const c = this.ctx;
    for (const p of fx.particles) {
      c.globalAlpha = Math.max(p.life / p.maxLife, 0);
      c.fillStyle = p.color;
      c.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    c.globalAlpha = 1;
  }

  private drawTexts(fx: Fx) {
    const c = this.ctx;
    c.textAlign = "center";
    c.textBaseline = "middle";
    for (const t of fx.texts) {
      const f = t.life / t.maxLife;
      if (t.banner) {
        // Snap in, hold, fade out.
        const inT = 1 - Math.min((1 - f) * 8, 1);
        const size = t.size * (this.w < 600 ? 0.7 : 1) * (1 + inT * 0.4);
        c.globalAlpha = Math.min(f * 3, 1) * (1 - inT * 0.7);
        c.font = `800 ${size}px ${FONT}`;
        c.fillStyle = t.color;
        c.shadowColor = t.color;
        c.shadowBlur = 24;
        c.fillText(t.text, this.w / 2, this.cy);
        c.shadowBlur = 0;
      } else {
        const [x, y] = this.toScreen(t.x, t.y);
        c.globalAlpha = Math.min(f * 2, 1);
        c.font = `700 ${t.size}px ${FONT}`;
        c.fillStyle = t.color;
        c.fillText(t.text, x, y);
      }
    }
    c.globalAlpha = 1;
  }

  private drawHud(sim: Sim, opt: RenderOptions) {
    const c = this.ctx;
    const small = this.w < 600;
    const pad = 16;
    const top = Math.max(this.arenaTop - (small ? 52 : 66), 8);
    const big = small ? 22 : 30;
    const label = small ? 9 : 11;

    c.textBaseline = "top";

    // Score + combo (left)
    c.textAlign = "left";
    c.fillStyle = "#6b6b6b";
    c.font = `700 ${label}px ${FONT}`;
    c.fillText(opt.label ?? "SCORE", pad, top);
    c.fillStyle = "#fff";
    c.font = `800 ${big}px ${FONT}`;
    c.fillText(sim.score.toLocaleString("en-US"), pad, top + label + 4);
    if (sim.combo > 1) {
      c.fillStyle = ACCENT;
      c.font = `800 ${label + 3}px ${FONT}`;
      c.fillText(`SYNC x${sim.combo}`, pad, top + label + big + 8);
    }

    // Loop + time left (center)
    c.textAlign = "center";
    c.fillStyle = "#6b6b6b";
    c.font = `700 ${label}px ${FONT}`;
    c.fillText(`LOOP ${String(sim.loop).padStart(2, "0")}`, this.w / 2, top);
    const left = Math.max((LOOP_TICKS - sim.loopTick) / TICK_RATE, 0);
    const urgent = sim.orbsThisLoop < sim.quota && left < 3;
    c.fillStyle = urgent ? DANGER : "#fff";
    c.font = `800 ${big}px ${FONT}`;
    c.fillText(left.toFixed(1), this.w / 2, top + label + 4);

    // Orb quota + forget charges (right)
    c.textAlign = "right";
    c.fillStyle = "#6b6b6b";
    c.font = `700 ${label}px ${FONT}`;
    c.fillText("ORBS", this.w - pad, top);
    const pip = small ? 12 : 15;
    for (let i = 0; i < sim.quota; i++) {
      const x = this.w - pad - i * (pip + 6) - pip / 2;
      const y = top + label + 6 + pip / 2;
      const filled = i < sim.orbsThisLoop;
      c.save();
      c.translate(x, y);
      c.rotate(Math.PI / 4);
      c.fillStyle = filled ? ACCENT : "transparent";
      c.strokeStyle = filled ? ACCENT : urgent ? DANGER : "#fff";
      c.lineWidth = 2;
      c.fillRect(-pip / 2.8, -pip / 2.8, pip / 1.4, pip / 1.4);
      c.strokeRect(-pip / 2.8, -pip / 2.8, pip / 1.4, pip / 1.4);
      c.restore();
    }
    const extra = sim.orbsThisLoop - sim.quota;
    if (extra > 0) {
      c.fillStyle = ACCENT;
      c.font = `700 ${label}px ${FONT}`;
      c.fillText(`+${extra}`, this.w - pad - sim.quota * (pip + 6) - 4, top + label + 6 + pip / 4);
    }
    c.fillStyle = sim.forgetCharges > 0 ? "#fff" : "#6b6b6b";
    c.font = `700 ${label}px ${FONT}`;
    c.fillText(`FORGET ${"◆".repeat(sim.forgetCharges)}${"◇".repeat(3 - sim.forgetCharges)}`, this.w - pad, top + label + pip + 14);
  }

  private drawJoystick(joy: Joystick) {
    const c = this.ctx;
    c.save();
    c.strokeStyle = "rgba(255,255,255,0.25)";
    c.lineWidth = 2;
    c.beginPath();
    c.arc(joy.ox, joy.oy, JOY_RADIUS, 0, Math.PI * 2);
    c.stroke();
    c.fillStyle = "rgba(255,255,255,0.35)";
    c.beginPath();
    c.arc(joy.x, joy.y, 22, 0, Math.PI * 2);
    c.fill();
    c.restore();
  }

  /** Displace horizontal slices of the frame for a digital-glitch look. */
  private drawGlitch(amount: number) {
    const c = this.ctx;
    const slices = Math.ceil(amount * 12);
    c.save();
    c.setTransform(1, 0, 0, 1, 0, 0);
    for (let i = 0; i < slices; i++) {
      const y = Math.random() * this.canvas.height;
      const h = (4 + Math.random() * 30) * this.dpr;
      const dx = (Math.random() - 0.5) * 60 * amount * this.dpr;
      c.drawImage(this.canvas, 0, y, this.canvas.width, h, dx, y, this.canvas.width, h);
    }
    c.globalCompositeOperation = "screen";
    c.globalAlpha = amount * 0.35;
    c.fillStyle = DANGER;
    c.fillRect(0, Math.random() * this.canvas.height, this.canvas.width, 3 * this.dpr);
    c.restore();
  }
}
