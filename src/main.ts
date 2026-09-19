import "./style.css";
import { Sound } from "./audio/sound";
import { createBot } from "./bot";
import { orbQuota } from "./engine/constants";
import { dailyKey, dailySeed } from "./engine/rng";
import type { DeathCause, Sim, SimEvent } from "./engine/sim";
import { Game, replaySource, type GameResult } from "./game";
import { Input } from "./input";
import {
  cleanName,
  fetchReplay,
  fetchTop,
  getBest,
  getName,
  online,
  setBest,
  setName,
  submitRun,
  type LeaderboardEntry,
} from "./net/leaderboard";
import { Renderer } from "./render/renderer";
import { downloadCanvas, memoryId, renderTapestry } from "./render/tapestry";
import { bindActions, el, escapeHtml, fmt } from "./ui/dom";

type Kind = "daily" | "practice";
type Screen = "menu" | "how" | "play" | "paused" | "over" | "board" | "replay";

const canvas = document.getElementById("game") as HTMLCanvasElement;
const ui = document.getElementById("ui")!;

const forgetBtn = el<HTMLButtonElement>(`<button id="forget-btn" class="hud-btn">FORGET</button>`);
const pauseBtn = el<HTMLButtonElement>(`<button id="pause-btn" class="hud-btn">II</button>`);
const hint = el(`<div id="hint"></div>`);

const renderer = new Renderer(canvas);
const input = new Input(forgetBtn);
const sound = new Sound();

class App {
  screen: Screen = "menu";
  game: Game | null = null;
  private layer: HTMLElement | null = null;
  private kind: Kind = "daily";
  private day = dailyKey();
  private lastDeath: { cause: DeathCause; loop?: number } | null = null;
  private hintTimer = 0;
  private runsPlayed = 0;
  private boardDay = dailyKey();

  constructor() {
    ui.append(forgetBtn, pauseBtn, hint);
    pauseBtn.addEventListener("click", () => this.pause());
    try {
      this.runsPlayed = Number(localStorage.getItem("echo.runs") || 0);
    } catch {
      /* ignore */
    }
    window.addEventListener("keydown", (e) => this.onKey(e));
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.pause();
    });
    this.showMenu();
  }

  // ---------- Frame loop ----------

  private last = performance.now();

  frame = (now: number) => {
    const dt = now - this.last;
    this.last = now;
    this.game?.frame(dt, now / 1000);
    requestAnimationFrame(this.frame);
  };

  // ---------- Layers ----------

  private setLayer(node: HTMLElement | null) {
    this.layer?.remove();
    this.layer = node;
    if (node) ui.append(node);
    document.body.classList.toggle("playing", this.screen === "play");
  }

  /** A bot plays silently behind menus. */
  private startAttract() {
    this.game?.stop();
    this.game = new Game(renderer, input, sound, {
      seed: (Math.random() * 2 ** 32) >>> 0,
      source: createBot(),
      silent: true,
      hideJoystick: true,
      hud: false,
      onOver: () => {
        if (this.screen !== "play" && this.screen !== "paused" && this.screen !== "replay") {
          setTimeout(() => this.isMenuLike() && this.startAttract(), 600);
        }
      },
    });
  }

  private isMenuLike(): boolean {
    return this.screen === "menu" || this.screen === "how" || this.screen === "board";
  }

  private ensureAttract() {
    if (!this.game || this.game.state === "over" || !this.game.isAttract) this.startAttract();
  }

  // ---------- Menu ----------

  showMenu() {
    this.screen = "menu";
    this.ensureAttract();
    const best = getBest();
    const node = el(`
      <div class="screen menu">
        <h1 class="title" data-text="ECHO">ECHO</h1>
        <p class="tag">every move you make comes back to haunt you</p>
        <div class="buttons">
          <button class="primary" data-act="daily">PLAY DAILY <small>${this.day}</small></button>
          <button data-act="practice">PRACTICE <small>random seed</small></button>
          <button data-act="board">LEADERBOARD</button>
          <button data-act="how">HOW TO PLAY</button>
        </div>
        <div class="meta">
          ${best ? `<span>BEST <b>${fmt(best)}</b></span>` : ""}
          <button class="link" data-act="mute">${sound.muted ? "SOUND OFF" : "SOUND ON"}</button>
          <span class="keys"><kbd>ENTER</kbd> play</span>
        </div>
      </div>`);
    bindActions(
      node,
      {
        daily: () => this.startRun("daily"),
        practice: () => this.startRun("practice"),
        board: () => this.showBoard(this.day),
        how: () => this.showHow(),
        mute: () => {
          sound.toggleMute();
          this.showMenu();
        },
      },
      () => this.click(),
    );
    this.setLayer(node);
    if (!this.runsPlayed) node.querySelector<HTMLElement>('[data-act="how"]')!.innerHTML = `HOW TO PLAY <small>new? start here</small>`;
  }

  showHow() {
    this.screen = "how";
    this.ensureAttract();
    const node = el(`
      <div class="screen how">
        <h2>HOW TO PLAY</h2>
        <div class="rules">
          <div class="rule"><div class="icon">◆</div><b>COLLECT</b>
            <p>Every loop lasts 10 seconds. Grab enough orbs before it ends or you fade away.</p></div>
          <div class="rule"><div class="icon">◯</div><b>MEET YOUR PAST</b>
            <p>When a loop ends, it replays as an echo. Every past loop plays at once. Touch one and it's over.</p></div>
          <div class="rule"><div class="icon">≋</div><b>SYNC</b>
            <p>Brush past an echo without touching it to build combo. Higher combo, more points per orb.</p></div>
          <div class="rule"><div class="icon">✕</div><b>FORGET</b>
            <p>Erase your oldest echo. You earn one charge every 3 loops. Choose wisely.</p></div>
        </div>
        <div class="meta">
          <span><kbd>WASD</kbd> / <kbd>ARROWS</kbd> move</span>
          <span><kbd>SPACE</kbd> forget</span>
          <span><kbd>ESC</kbd> pause</span>
          <span>touch: drag anywhere · tap FORGET</span>
        </div>
        <div class="row">
          <button class="primary" data-act="play">PLAY DAILY</button>
          <button data-act="back">BACK</button>
        </div>
      </div>`);
    bindActions(node, { play: () => this.startRun("daily"), back: () => this.showMenu() }, () => this.click());
    this.setLayer(node);
  }

  // ---------- Playing ----------

  startRun(kind: Kind) {
    sound.unlock();
    this.kind = kind;
    this.day = dailyKey();
    this.lastDeath = null;
    const seed = kind === "daily" ? dailySeed(this.day) : (Math.random() * 2 ** 32) >>> 0;
    this.game?.stop();
    input.clear();
    this.screen = "play";
    this.setLayer(null);

    const tutorial = this.runsPlayed < 2;
    this.game = new Game(renderer, input, sound, {
      seed,
      onEvent: (e, sim) => this.onGameEvent(e, sim, tutorial),
      onOver: (r) => this.showGameOver(r),
    });
    this.showHint(
      tutorial ? "Collect ◆ orbs. You need 1 before the loop ends." : `${kind === "daily" ? "DAILY " + this.day : "PRACTICE"}`,
      tutorial ? 5000 : 1800,
    );
  }

  private onGameEvent(e: SimEvent, sim: Sim, tutorial: boolean) {
    if (e.type === "death") this.lastDeath = { cause: e.cause, loop: e.ghost?.loop };
    if (e.type !== "loop") return;
    const quotaUp = orbQuota(e.loop) > orbQuota(e.loop - 1);
    const touch = input.touchUsed;
    if (tutorial && e.loop === 2) {
      this.showHint("That's you, 10 seconds ago. Don't touch it. Brush past it for SYNC.", 5500);
    } else if (e.charged && sim.forgetCharges === 1 && (tutorial || e.loop === 4)) {
      this.showHint(`FORGET charged: ${touch ? "tap FORGET" : "press SPACE"} to erase your oldest echo.`, 4500);
    } else if (quotaUp) {
      this.showHint(`Quota up: ${orbQuota(e.loop)} orbs per loop.`, 3000);
    }
  }

  private showHint(text: string, ms: number) {
    hint.textContent = text;
    hint.classList.add("show");
    clearTimeout(this.hintTimer);
    this.hintTimer = window.setTimeout(() => hint.classList.remove("show"), ms);
  }

  pause() {
    if (this.screen !== "play" || !this.game || this.game.state !== "running") return;
    this.game.pause();
    this.screen = "paused";
    const node = el(`
      <div class="screen dimmed">
        <h2>PAUSED</h2>
        <div class="buttons">
          <button class="primary" data-act="resume">RESUME <small>ESC</small></button>
          <button data-act="restart">RESTART <small>R</small></button>
          <button data-act="quit">QUIT TO MENU</button>
        </div>
      </div>`);
    bindActions(
      node,
      {
        resume: () => this.resume(),
        restart: () => this.startRun(this.kind),
        quit: () => {
          this.game?.stop();
          this.game = null;
          this.showMenu();
        },
      },
      () => this.click(),
    );
    this.setLayer(node);
  }

  resume() {
    if (this.screen !== "paused" || !this.game) return;
    input.clear();
    this.screen = "play";
    this.setLayer(null);
    this.game.resume();
  }

  // ---------- Game over ----------

  private showGameOver(result: GameResult) {
    const { sim, inputs } = result;
    const s = sim.summary();
    this.screen = "over";
    hint.classList.remove("show");
    this.runsPlayed++;
    try {
      localStorage.setItem("echo.runs", String(this.runsPlayed));
    } catch {
      /* ignore */
    }

    const prevBest = getBest();
    const newBest = s.score > prevBest;
    if (newBest) setBest(s.score);

    const kind = this.kind;
    const day = this.day;
    const mode = kind === "daily" ? `DAILY ${day}` : "PRACTICE";
    const name = getName();
    const tapestry = renderTapestry(sim, { mode, name: name || undefined });

    const death = this.lastDeath;
    const cause =
      death?.cause === "fade"
        ? "FADED · NOT ENOUGH ORBS"
        : `CAUGHT BY LOOP ${String(death?.loop ?? 0).padStart(2, "0")}`;

    const node = el(`
      <div class="screen over">
        <div class="over-grid">
          <div class="memory"><img alt="Memory of this run: every loop's path" /></div>
          <div class="panel">
            <div class="cause">${cause}</div>
            <div class="big-score">${fmt(s.score)}${newBest && s.score > 0 ? `<span class="badge">NEW BEST</span>` : ""}</div>
            <div class="stats">
              <div class="stat"><span>LOOPS</span><b>${s.loops}</b></div>
              <div class="stat"><span>ORBS</span><b>${s.orbs}</b></div>
              <div class="stat"><span>BEST SYNC</span><b>x${s.maxCombo}</b></div>
              <div class="stat"><span>FORGETS</span><b>${s.forgets}</b></div>
            </div>
            ${
              kind === "daily"
                ? `<form class="submit">
                     <input name="name" maxlength="16" placeholder="YOUR NAME" autocomplete="nickname" value="${escapeHtml(name)}" />
                     <button class="primary" type="submit">SUBMIT</button>
                   </form>`
                : `<div class="status">Practice runs aren't ranked. Play DAILY to get on the board.</div>`
            }
            <div class="status" data-status></div>
            <div class="actions">
              <button class="primary" data-act="retry">RETRY <small>R</small></button>
              <button data-act="save">SAVE MEMORY</button>
              <button data-act="replay">WATCH REPLAY</button>
              <button data-act="menu">MENU</button>
            </div>
          </div>
        </div>
      </div>`);

    node.querySelector("img")!.src = tapestry.toDataURL("image/png");
    const status = node.querySelector<HTMLElement>("[data-status]")!;

    bindActions(
      node,
      {
        retry: () => this.startRun(kind),
        save: () => downloadCanvas(tapestry, `echo-memory-${memoryId(sim)}.png`),
        replay: () =>
          this.startReplay(sim.seed, inputs, name || "YOU", () => this.showGameOver(result)),
        menu: () => this.showMenu(),
      },
      () => this.click(),
    );

    const form = node.querySelector<HTMLFormElement>("form.submit");
    form?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const field = form.querySelector("input")!;
      const clean = cleanName(field.value).toUpperCase();
      if (!clean) {
        status.className = "status bad";
        status.textContent = "Enter a name first.";
        field.focus();
        return;
      }
      setName(clean);
      const btn = form.querySelector("button")!;
      btn.disabled = true;
      field.disabled = true;
      status.className = "status";
      status.textContent = online ? "Verifying run…" : "Saving…";
      const res = await submitRun(clean, day, sim.seed, inputs, s);
      if (res.ok) {
        status.className = "status good";
        status.textContent = `${res.rank ? `RANK #${res.rank} TODAY` : "SUBMITTED"}${online ? " · verified by replay" : " · saved on this device (offline)"}`;
        form.remove();
      } else {
        status.className = "status bad";
        status.textContent = res.error || "Submit failed.";
        btn.disabled = false;
        field.disabled = false;
      }
    });

    this.setLayer(node);
    // Keep the frozen final frame behind the overlay.
  }

  // ---------- Replay ----------

  private startReplay(seed: number, inputs: Uint8Array, name: string, back: () => void) {
    sound.unlock();
    this.game?.stop();
    this.screen = "replay";
    const game = new Game(renderer, input, sound, {
      seed,
      source: replaySource(inputs),
      hideJoystick: true,
      label: `REPLAY · ${name.toUpperCase()}`,
      onOver: () => setTimeout(() => this.screen === "replay" && this.game === game && back(), 900),
    });
    this.game = game;

    const bar = el(`
      <div class="replay-bar">
        <button data-speed="1" class="on">1×</button>
        <button data-speed="2">2×</button>
        <button data-speed="4">4×</button>
        <button data-act="exit">EXIT <small>ESC</small></button>
      </div>`);
    bar.querySelectorAll<HTMLButtonElement>("[data-speed]").forEach((b) =>
      b.addEventListener("click", () => {
        game.speed = Number(b.dataset.speed);
        bar.querySelectorAll("[data-speed]").forEach((x) => x.classList.toggle("on", x === b));
      }),
    );
    this.replayBack = () => {
      game.stop();
      back();
    };
    bindActions(bar, { exit: this.replayBack }, () => this.click());
    this.setLayer(bar);
  }

  private replayBack: (() => void) | null = null;

  // ---------- Leaderboard ----------

  async showBoard(day: string) {
    this.screen = "board";
    this.boardDay = day;
    this.ensureAttract();
    const today = dailyKey();
    const node = el(`
      <div class="screen board-screen">
        <div class="board">
          <div class="board-head">
            <button data-act="prev">‹</button>
            <div>
              <h2>DAILY LOOP</h2>
              <div class="day">${day === today ? "TODAY · " : ""}${day}</div>
            </div>
            <button data-act="next" ${day >= today ? "disabled" : ""}>›</button>
          </div>
          <div class="board-list"><div class="empty">Loading…</div></div>
          <div class="meta">${online ? "Every score is verified by replaying the run." : "Offline mode: scores are saved on this device only."}</div>
          <div class="row">
            <button class="primary" data-act="play">PLAY TODAY</button>
            <button data-act="back">BACK</button>
          </div>
        </div>
      </div>`);
    bindActions(
      node,
      {
        prev: () => this.showBoard(shiftDay(day, -1)),
        next: () => this.showBoard(shiftDay(day, 1)),
        play: () => this.startRun("daily"),
        back: () => this.showMenu(),
      },
      () => this.click(),
    );
    this.setLayer(node);

    const list = node.querySelector<HTMLElement>(".board-list")!;
    let rows: LeaderboardEntry[];
    try {
      rows = await fetchTop(day, 25);
    } catch {
      list.innerHTML = `<div class="empty">Couldn't load the leaderboard.</div>`;
      return;
    }
    if (this.screen !== "board" || this.boardDay !== day) return;
    if (!rows.length) {
      list.innerHTML = `<div class="empty">No runs yet. Be the first echo.</div>`;
      return;
    }
    const me = getName();
    list.innerHTML = "";
    rows.forEach((r, i) => {
      const row = el(`
        <div class="board-row ${me && r.name === me ? "me" : ""}">
          <span class="rank">${String(i + 1).padStart(2, "0")}</span>
          <span class="name">${escapeHtml(r.name)}</span>
          <span class="loops">${r.loops} loops</span>
          <span class="score">${fmt(r.score)}</span>
          <button title="Watch replay" aria-label="Watch replay">▶</button>
        </div>`);
      row.querySelector("button")!.addEventListener("click", async () => {
        this.click();
        try {
          const rep = await fetchReplay(r.id);
          this.startReplay(rep.seed, rep.inputs, rep.name, () => this.showBoard(day));
        } catch {
          row.querySelector("button")!.textContent = "✕";
        }
      });
      list.append(row);
    });
  }

  // ---------- Input ----------

  private onKey(e: KeyboardEvent) {
    if (e.target instanceof HTMLInputElement) return;
    if (e.repeat) return;
    const k = e.code;
    if (k === "KeyM") {
      sound.toggleMute();
      if (this.screen === "menu") this.showMenu();
      return;
    }
    switch (this.screen) {
      case "play":
        if (k === "Escape" || k === "KeyP") this.pause();
        break;
      case "paused":
        if (k === "Escape" || k === "KeyP") this.resume();
        else if (k === "KeyR") this.startRun(this.kind);
        break;
      case "menu":
        if (k === "Enter") this.startRun("daily");
        break;
      case "over":
        if (k === "KeyR" || k === "Enter") this.startRun(this.kind);
        else if (k === "Escape") this.showMenu();
        break;
      case "replay":
        if (k === "Escape") this.replayBack?.();
        break;
      case "how":
      case "board":
        if (k === "Escape") this.showMenu();
        else if (k === "Enter") this.startRun("daily");
        break;
    }
  }

  private click() {
    sound.unlock();
    sound.click();
  }
}

function shiftDay(day: string, delta: number): string {
  const d = new Date(day + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + delta);
  return dailyKey(d);
}

const app = new App();
requestAnimationFrame(app.frame);
