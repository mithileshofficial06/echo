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
  type LeaderboardScope,
} from "./net/leaderboard";
import { Renderer } from "./render/renderer";
import { downloadCanvas, memoryId, renderTapestry } from "./render/tapestry";
import { bindActions, el, escapeHtml, fmt } from "./ui/dom";

type Kind = "daily" | "practice";
type Screen = "menu" | "how" | "identity" | "play" | "paused" | "over" | "board" | "replay";

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
  private boardScope: LeaderboardScope = "overall";

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
    return this.screen === "menu" || this.screen === "how" || this.screen === "identity" || this.screen === "board";
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
        <div class="menu-haze" aria-hidden="true"></div>
        <div class="menu-shell">
          <header class="signal-head">
            <div class="wordmark"><span class="wordmark-mark">E</span> ECHO <i>/</i> ARCHIVE</div>
            <div class="signal-state"><span></span> TEMPORAL LINK STABLE</div>
            <div class="signal-id">SYS.09 // ${this.day.replaceAll("-", ".")}</div>
          </header>
          <main class="hero-grid">
            <section class="hero-copy">
              <div class="eyebrow"><span>01</span> SURVIVAL PROTOCOL</div>
              <h1 class="title" data-text="ECHO">ECHO</h1>
              <p class="tag">Your last ten seconds are not history.<br>They are the next thing hunting you.</p>
              <div class="hero-facts">
                <div><b>10.00</b><span>SECONDS / LOOP</span></div>
                <div><b>∞</b><span>PAST SELVES</span></div>
                <div><b>01</b><span>WAY OUT</span></div>
              </div>
            </section>
            <section class="echo-vessel" aria-label="Animated echo field">
              <div class="vessel-label top">LIVE MEMORY MAP</div>
              <div class="vessel-label bottom">DO NOT COLLIDE WITH YOURSELF</div>
              <div class="orbit orbit-one"></div><div class="orbit orbit-two"></div><div class="orbit orbit-three"></div>
              <div class="echo-node node-one"></div><div class="echo-node node-two"></div><div class="echo-node node-three"></div>
              <div class="core-node"></div><div class="vessel-cross"></div>
            </section>
          </main>
          <section class="launch-deck">
            <div class="deck-intro"><span>SELECT ENTRY</span><b>THE LOOP IS ALREADY RUNNING.</b></div>
            <div class="buttons menu-buttons">
              <button class="primary" data-act="daily"><span>PLAY THE DAILY LOOP</span><small>${this.day} <b>→</b></small></button>
              <button data-act="practice"><span>CREATE PRIVATE LOOP</span><small>RANDOM SEED <b>→</b></small></button>
            </div>
            <div class="deck-links">
              <button data-act="board">⌁ &nbsp; LEADERBOARD</button>
              <button data-act="how">? &nbsp; HOW IT WORKS</button>
              <button class="link" data-act="mute">${sound.muted ? "SOUND OFF" : "SOUND ON"}</button>
            </div>
          </section>
          <footer class="menu-footer">
            <span>${best ? `PERSONAL BEST // ${fmt(best)}` : "NO MEMORY RECORDED YET"}</span>
            <span class="keys"><kbd>ENTER</kbd> BEGIN &nbsp; <kbd>WASD</kbd> MOVE &nbsp; <kbd>SPACE</kbd> FORGET</span>
          </footer>
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
    if (!getName()) {
      this.showIdentity(kind);
      return;
    }
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
    // Dev-only: ?bot lets the attract bot play a real run (for testing late loops).
      const devBot = process.env.NODE_ENV === "development" && new URLSearchParams(location.search).has("bot");
    this.game = new Game(renderer, input, sound, {
      seed,
      source: devBot ? createBot() : undefined,
      onEvent: (e, sim) => this.onGameEvent(e, sim, tutorial),
      onOver: (r) => this.showGameOver(r),
    });
    this.showHint(
      tutorial ? "Collect ◆ orbs. You need 1 before the loop ends." : `${kind === "daily" ? "DAILY " + this.day : "PRACTICE"}`,
      tutorial ? 5000 : 1800,
    );
  }

  /** Names are collected before the run so verified daily scores can save automatically. */
  private showIdentity(kind: Kind) {
    this.screen = "identity";
    this.ensureAttract();
    const node = el(`
      <div class="screen identity-screen">
        <div class="identity-card">
          <div class="identity-index">PLAYER REGISTRY // REQUIRED</div>
          <h2>NAME YOUR ECHO</h2>
          <p>Every verified daily run is saved to this name. It is shown on the global leaderboard.</p>
          <form class="identity-form">
            <input name="name" maxlength="16" autocomplete="nickname" placeholder="ENTER A NAME" autofocus />
            <button class="primary" type="submit">BEGIN LOOP <small>→</small></button>
          </form>
          <div class="identity-note">Use 1–16 letters, numbers, spaces, dots, dashes, or underscores.</div>
          <button class="link" data-act="back">BACK</button>
        </div>
      </div>`);
    const form = node.querySelector<HTMLFormElement>("form")!;
    const field = form.querySelector<HTMLInputElement>("input")!;
    const note = node.querySelector<HTMLElement>(".identity-note")!;
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const name = cleanName(field.value).toUpperCase();
      if (!name) {
        note.textContent = "A name is required to enter the archive.";
        note.classList.add("bad");
        field.focus();
        return;
      }
      setName(name);
      this.click();
      this.startRun(kind);
    });
    bindActions(node, { back: () => this.showMenu() }, () => this.click());
    this.setLayer(node);
    setTimeout(() => field.focus(), 0);
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
                ? `<div class="status">Preparing verified score for ${escapeHtml(name)}…</div>`
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

    this.setLayer(node);
    if (kind === "daily") {
      // A player has already registered their name before the run starts, so
      // every daily game can save itself as soon as it is over.
      void (async () => {
        status.className = "status";
        status.textContent = online ? "Verifying score and updating global placement…" : "Saving on this device…";
        const res = await submitRun(name, day, sim.seed, inputs, s);
        if (this.screen !== "over" || this.layer !== node) return;
        if (res.ok) {
          status.className = "status good";
          const ranks = [res.rank && `TODAY #${res.rank}`, res.overallRank && `ALL-TIME #${res.overallRank}`].filter(Boolean).join("  ·  ");
          status.textContent = `${ranks || "SAVED"}${online ? " · global score updated" : " · saved on this device"}`;
        } else {
          status.className = "status bad";
          status.textContent = res.error || "Could not save score. Check your connection and retry.";
        }
      })();
    }
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

  async showBoard(day: string, scope: LeaderboardScope = "overall") {
    this.screen = "board";
    this.boardDay = day;
    this.boardScope = scope;
    this.ensureAttract();
    const today = dailyKey();
    const node = el(`
      <div class="screen board-screen">
        <div class="board">
          <div class="board-head">
            <button data-act="prev" ${scope === "overall" ? "disabled" : ""}>‹</button>
            <div>
              <h2>${scope === "overall" ? "GLOBAL ARCHIVE" : "DAILY LOOP"}</h2>
              <div class="day">${scope === "overall" ? "ALL-TIME PLACEMENT" : `${day === today ? "TODAY · " : ""}${day}`}</div>
            </div>
            <button data-act="next" ${scope === "overall" || day >= today ? "disabled" : ""}>›</button>
          </div>
          <div class="board-tabs"><button class="${scope === "overall" ? "on" : ""}" data-act="overall">ALL-TIME</button><button class="${scope === "daily" ? "on" : ""}" data-act="dailyboard">TODAY</button></div>
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
        prev: () => this.showBoard(shiftDay(day, -1), "daily"),
        next: () => this.showBoard(shiftDay(day, 1), "daily"),
        overall: () => this.showBoard(day, "overall"),
        dailyboard: () => this.showBoard(today, "daily"),
        play: () => this.startRun("daily"),
        back: () => this.showMenu(),
      },
      () => this.click(),
    );
    this.setLayer(node);

    const list = node.querySelector<HTMLElement>(".board-list")!;
    let rows: LeaderboardEntry[];
    try {
      rows = await fetchTop(day, 25, scope);
    } catch {
      list.innerHTML = `<div class="empty">Couldn't load the leaderboard.</div>`;
      return;
    }
    if (this.screen !== "board" || this.boardDay !== day || this.boardScope !== scope) return;
    if (!rows.length) {
          list.innerHTML = `<div class="empty">No ${scope === "overall" ? "players" : "runs"} yet. Be the first echo.</div>`;
      return;
    }
    const me = getName();
    list.innerHTML = "";
    rows.forEach((r, i) => {
      const row = el(`
        <div class="board-row ${me && r.name === me ? "me" : ""}">
          <span class="rank">${String(i + 1).padStart(2, "0")}</span>
          <span class="name">${escapeHtml(r.name)}</span>
          <span class="loops">${scope === "overall" ? `${r.games_played ?? 0} runs` : `${r.loops} loops`}</span>
          <span class="score">${fmt(r.score)}</span>
          ${scope === "daily" ? `<button title="Watch replay" aria-label="Watch replay">▶</button>` : `<span></span>`}
        </div>`);
      row.querySelector("button")?.addEventListener("click", async () => {
        this.click();
        try {
          const rep = await fetchReplay(r.id);
          this.startReplay(rep.seed, rep.inputs, rep.name, () => this.showBoard(day, scope));
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
      case "identity":
        if (k === "Escape") this.showMenu();
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
