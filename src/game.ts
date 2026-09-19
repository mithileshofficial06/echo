import { TICK_MS } from "./engine/constants";
import { InputLog } from "./engine/replay";
import { Sim, type SimEvent } from "./engine/sim";
import type { Input } from "./input";
import type { Sound } from "./audio/sound";
import { Fx } from "./render/fx";
import { ACCENT, DANGER, type Renderer } from "./render/renderer";

export type GameState = "running" | "paused" | "dying" | "over";

export interface GameResult {
  sim: Sim;
  inputs: Uint8Array;
}

export interface GameOptions {
  seed: number;
  /** When set, the game plays back these inputs instead of reading the player. */
  replay?: Uint8Array;
  replayLabel?: string;
  onOver: (result: GameResult) => void;
}

const DEATH_SLOWMO_MS = 1600;

export class Game {
  readonly sim: Sim;
  readonly fx = new Fx();
  private log = new InputLog();
  private acc = 0;
  private dyingFor = 0;
  private replayIdx = 0;
  state: GameState = "running";
  /** Replay playback speed multiplier. */
  speed = 1;

  constructor(
    private renderer: Renderer,
    private input: Input,
    private sound: Sound,
    private opts: GameOptions,
  ) {
    this.sim = new Sim(opts.seed);
    this.fx.banner("LOOP 01", "#fff", 44, 70);
    sound.startLoop(0);
  }

  get isReplay(): boolean {
    return !!this.opts.replay;
  }

  pause() {
    if (this.state !== "running") return;
    this.state = "paused";
    this.sound.pause();
  }

  resume() {
    if (this.state !== "paused") return;
    this.state = "running";
    this.acc = 0;
    this.sound.resume();
  }

  frame(dtMs: number, time: number) {
    dtMs = Math.min(dtMs, 100);

    if (this.state === "running") {
      this.acc += dtMs * this.speed;
      while (this.acc >= TICK_MS && this.state === "running") {
        this.acc -= TICK_MS;
        this.tick();
      }
      this.fx.update((dtMs / TICK_MS) * this.speed);
    } else if (this.state === "dying") {
      this.dyingFor += dtMs;
      this.fx.update((dtMs / TICK_MS) * 0.3);
      if (this.dyingFor >= DEATH_SLOWMO_MS) {
        this.state = "over";
        this.opts.onOver({ sim: this.sim, inputs: this.log.toArray() });
      }
    }

    this.input.rotated = this.renderer.rotated;
    this.renderer.draw(this.sim, this.fx, this.isReplay ? null : this.input.joy, {
      alpha: this.state === "running" ? this.acc / TICK_MS : 1,
      time,
      hud: true,
      label: this.opts.replayLabel,
    });
  }

  private tick() {
    let input: number;
    if (this.opts.replay) {
      input = this.opts.replay[this.replayIdx++] ?? 0;
    } else {
      input = this.input.read();
    }
    this.log.push(input);
    const events = this.sim.step(input);
    for (const e of events) this.onEvent(e);

    // A replay that runs out of inputs without a death (shouldn't happen) just ends.
    if (this.opts.replay && this.replayIdx >= this.opts.replay.length && !this.sim.dead) {
      this.state = "over";
      this.sound.stopMusic();
      this.opts.onOver({ sim: this.sim, inputs: this.log.toArray() });
    }
  }

  private onEvent(e: SimEvent) {
    const fx = this.fx;
    const s = this.sound;
    switch (e.type) {
      case "orb":
        fx.burst(e.x, e.y, "#fff", 18, 3.5, 36);
        fx.popup(`+${e.points}`, e.x, e.y - 14, "#fff", 13);
        fx.addShake(2);
        s.orb(e.combo);
        break;
      case "quotaMet":
        fx.popup("SAFE", this.sim.px, this.sim.py - 32, ACCENT, 12, 60);
        s.quota();
        break;
      case "graze":
        fx.burst(e.x, e.y, ACCENT, 10, 2.5, 28, 2);
        fx.popup(`SYNC x${e.combo}`, e.x, e.y - 20, ACCENT, 12 + Math.min(e.combo, 10), 45);
        s.graze(e.combo);
        break;
      case "comboLost":
        if (e.combo >= 3) fx.popup(`x${e.combo} LOST`, this.sim.px, this.sim.py - 24, "#6b6b6b", 11);
        s.comboLost();
        break;
      case "forget": {
        const [x, y] = this.renderer.ghostRenderPos(this.sim, e.ghost, 1);
        fx.dissolve(x, y, ACCENT);
        fx.banner("MEMORY LOST", ACCENT, 38, 60);
        fx.addShake(8);
        fx.addFlash(0.4, ACCENT);
        s.forget();
        s.setLayers(this.sim.activeGhosts.length);
        break;
      }
      case "loop": {
        fx.banner(`LOOP ${String(e.loop).padStart(2, "0")}`, "#fff", 44, 70);
        fx.popup(`+${e.bonus}`, this.sim.px, this.sim.py - 26, ACCENT, 14, 60);
        if (e.charged) fx.popup("FORGET +1", this.sim.px, this.sim.py + 30, "#fff", 12, 70);
        fx.addFlash(0.35, ACCENT);
        // Echoes materialize at their starting points.
        for (const g of this.sim.activeGhosts) fx.burst(g.path[0], g.path[1], ACCENT, 14, 2, 30, 2);
        s.loop();
        s.startLoop(this.sim.activeGhosts.length);
        break;
      }
      case "death":
        this.state = "dying";
        this.dyingFor = 0;
        s.stopMusic(true);
        if (e.cause === "collision") {
          fx.burst(e.x, e.y, "#fff", 50, 6, 70, 3);
          fx.burst(e.x, e.y, DANGER, 40, 4, 80, 3);
          fx.addShake(20);
          fx.addFlash(0.8, DANGER);
          fx.glitch = 1;
          const loop = e.ghost ? String(e.ghost.loop).padStart(2, "0") : "??";
          fx.banner(`LOOP ${loop} GOT YOU`, DANGER, 34, 200);
          s.death();
        } else {
          fx.dissolve(e.x, e.y, "#fff");
          fx.dissolve(e.x, e.y, "#fff");
          fx.banner("NOT ENOUGH ORBS", DANGER, 32, 200);
          fx.glitch = 0.5;
          s.fade();
        }
        break;
    }
  }
}
