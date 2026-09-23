import type { ScreenRect } from "../render/renderer";
import { el } from "./dom";

/** What the spotlight wraps: a DOM element, a live screen rect (canvas things), or nothing. */
export type CoachTarget = HTMLElement | (() => ScreenRect | null) | null;

export interface CoachStep {
  target: CoachTarget;
  text: string;
  /** Small label above the text, e.g. "STEP 2 / 5". */
  kicker?: string;
  /** Label of the continue button. Without it the step waits for the game to move on. */
  action?: string;
  /** Darken everything outside the spotlight (default true). */
  dim?: boolean;
  shape?: "rect" | "circle";
  /** Don't read this step aloud (short, repeated nudges). */
  quiet?: boolean;
}

const PAD = 10;
const GAP = 16;

/**
 * First-run guide: a spotlight that follows a target, a speech bubble that
 * types itself out, and optional narration so new players are told what to
 * do instead of reading a wall of rules.
 */
export class Coach {
  private root = el(`
    <div class="coach" aria-live="polite">
      <div class="coach-spot"></div>
      <div class="coach-bubble" role="dialog">
        <div class="coach-top">
          <span class="coach-kicker"></span>
          <button class="coach-voice" type="button" title="Toggle narration"></button>
        </div>
        <p class="coach-text"></p>
        <div class="coach-actions">
          <button class="link coach-skip" type="button">SKIP TUTORIAL</button>
          <button class="primary coach-next" type="button"></button>
        </div>
      </div>
    </div>`);
  private spot = this.root.querySelector<HTMLElement>(".coach-spot")!;
  private bubble = this.root.querySelector<HTMLElement>(".coach-bubble")!;
  private kicker = this.root.querySelector<HTMLElement>(".coach-kicker")!;
  private textEl = this.root.querySelector<HTMLElement>(".coach-text")!;
  private nextBtn = this.root.querySelector<HTMLButtonElement>(".coach-next")!;
  private voiceBtn = this.root.querySelector<HTMLButtonElement>(".coach-voice")!;
  private step: CoachStep | null = null;
  private onNext: (() => void) | null = null;
  private raf = 0;
  private typeTimer = 0;
  private voiceOn = true;

  constructor(
    parent: HTMLElement,
    private canSpeak: () => boolean,
    onSkip: () => void,
  ) {
    try {
      this.voiceOn = localStorage.getItem("echo.voice") !== "0";
    } catch {
      /* ignore */
    }
    this.renderVoice();
    parent.append(this.root);
    this.nextBtn.addEventListener("click", () => this.advance());
    this.root.querySelector(".coach-skip")!.addEventListener("click", () => {
      this.hide();
      onSkip();
    });
    this.voiceBtn.addEventListener("click", () => {
      this.voiceOn = !this.voiceOn;
      try {
        localStorage.setItem("echo.voice", this.voiceOn ? "1" : "0");
      } catch {
        /* ignore */
      }
      this.renderVoice();
      if (this.voiceOn && this.step) this.speak(this.step.text);
      else this.silence();
    });
    // Capture phase so Enter/Space continue the guide instead of reaching the game or menu.
    window.addEventListener(
      "keydown",
      (e) => {
        if (!this.step?.action || e.repeat || e.target instanceof HTMLInputElement) return;
        if (e.code !== "Enter" && e.code !== "Space" && e.code !== "NumpadEnter") return;
        e.preventDefault();
        e.stopImmediatePropagation();
        this.advance();
      },
      true,
    );
  }

  get active(): boolean {
    return this.step !== null;
  }

  show(step: CoachStep, onNext?: () => void) {
    this.step = step;
    this.onNext = onNext ?? null;
    this.root.classList.add("on");
    this.root.classList.toggle("dim", step.dim ?? true);
    this.root.classList.toggle("no-target", !step.target);
    // Without dimming the game is live: dock a compact bubble at the bottom so it never covers the path.
    this.root.classList.toggle("docked", step.dim === false);
    this.spot.classList.toggle("circle", step.shape === "circle");
    this.kicker.textContent = step.kicker ?? "LIVE COACH";
    this.nextBtn.hidden = !step.action;
    this.nextBtn.innerHTML = step.action ? `${step.action} <small>ENTER</small>` : "";
    this.bubble.classList.remove("pop");
    void this.bubble.offsetWidth;
    this.bubble.classList.add("pop");
    this.typeOut(step.text);
    if (!step.quiet) this.speak(step.text);
    // On small screens the target can sit below the fold of a scrolling menu.
    if (step.target instanceof HTMLElement) step.target.scrollIntoView({ block: "center", behavior: "smooth" });
    cancelAnimationFrame(this.raf);
    this.track();
  }

  /** Play steps one after another, then call done. */
  sequence(steps: CoachStep[], done: () => void) {
    const run = (i: number) => {
      if (i >= steps.length) return done();
      this.show({ ...steps[i], kicker: steps[i].kicker ?? `STEP ${i + 1} / ${steps.length}` }, () => run(i + 1));
    };
    run(0);
  }

  hide() {
    this.step = null;
    this.onNext = null;
    this.root.classList.remove("on");
    cancelAnimationFrame(this.raf);
    clearInterval(this.typeTimer);
    this.silence();
  }

  private advance() {
    if (!this.step?.action) return;
    const next = this.onNext;
    this.silence();
    next?.();
  }

  private typeOut(text: string) {
    clearInterval(this.typeTimer);
    let i = 0;
    this.textEl.textContent = "";
    this.textEl.classList.add("typing");
    this.typeTimer = window.setInterval(() => {
      i += 2;
      this.textEl.textContent = text.slice(0, i);
      if (i >= text.length) {
        clearInterval(this.typeTimer);
        this.textEl.classList.remove("typing");
      }
    }, 22);
  }

  private speak(text: string) {
    this.silence();
    if (!this.voiceOn || !this.canSpeak() || !("speechSynthesis" in window)) return;
    const u = new SpeechSynthesisUtterance(text.replace(/[◆]/g, ""));
    const voices = speechSynthesis.getVoices();
    u.voice =
      voices.find((v) => /en[-_](US|GB)/i.test(v.lang) && /natural|google|samantha|aria|jenny/i.test(v.name)) ??
      voices.find((v) => v.lang.startsWith("en")) ??
      null;
    u.rate = 1.04;
    u.pitch = 0.95;
    speechSynthesis.speak(u);
  }

  private silence() {
    if ("speechSynthesis" in window) speechSynthesis.cancel();
  }

  private renderVoice() {
    this.voiceBtn.textContent = this.voiceOn ? "VOICE ON" : "VOICE OFF";
    this.voiceBtn.classList.toggle("off", !this.voiceOn);
  }

  /** Follow the target every frame: it may be a moving orb or a resized button. */
  private track = () => {
    const t = this.step?.target;
    const r = !t ? null : t instanceof HTMLElement ? rectOf(t) : t();
    this.place(r);
    this.raf = requestAnimationFrame(this.track);
  };

  private place(r: ScreenRect | null) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    this.spot.style.opacity = r ? "1" : "0";
    if (r) {
      Object.assign(this.spot.style, {
        left: `${r.x - PAD}px`,
        top: `${r.y - PAD}px`,
        width: `${r.w + PAD * 2}px`,
        height: `${r.h + PAD * 2}px`,
      });
    }

    const bw = this.bubble.offsetWidth;
    const bh = this.bubble.offsetHeight;
    let x: number;
    let y: number;
    if (!r || this.step?.dim === false) {
      x = (vw - bw) / 2;
      y = vh - bh - 40;
    } else {
      x = r.x + r.w / 2 - bw / 2;
      const below = r.y + r.h + PAD + GAP;
      const above = r.y - PAD - GAP - bh;
      y = below + bh < vh - 12 ? below : above > 12 ? above : vh - bh - 16;
    }
    x = Math.min(Math.max(x, 12), vw - bw - 12);
    this.bubble.style.left = `${Math.round(x)}px`;
    this.bubble.style.top = `${Math.round(y)}px`;
  }
}

function rectOf(node: HTMLElement): ScreenRect | null {
  if (!node.isConnected) return null;
  const b = node.getBoundingClientRect();
  return { x: b.left, y: b.top, w: b.width, h: b.height };
}
