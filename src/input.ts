import { IN_DOWN, IN_FORGET, IN_LEFT, IN_RIGHT, IN_UP } from "./engine/constants";

const KEY_UP = ["ArrowUp", "KeyW"];
const KEY_DOWN = ["ArrowDown", "KeyS"];
const KEY_LEFT = ["ArrowLeft", "KeyA"];
const KEY_RIGHT = ["ArrowRight", "KeyD"];
const KEY_FORGET = ["Space", "KeyE", "ShiftLeft", "ShiftRight"];

const JOY_DEADZONE = 14;
export const JOY_RADIUS = 56;

export interface Joystick {
  active: boolean;
  ox: number;
  oy: number;
  x: number;
  y: number;
}

/**
 * Collects keyboard and touch input and turns it into the sim's per-tick bitmask.
 * Directions are read in screen space and converted to arena space, so
 * controls stay correct when the arena is rotated on portrait screens.
 */
export class Input {
  private keys = new Set<string>();
  private joyId: number | null = null;
  private forgetTouch = false;
  readonly joy: Joystick = { active: false, ox: 0, oy: 0, x: 0, y: 0 };
  touchUsed = false;
  /** Set by the renderer: true when the arena is drawn rotated 90°. */
  rotated = false;

  constructor(private forgetButton: HTMLElement) {
    if (window.matchMedia("(pointer: coarse)").matches) this.markTouch();
    window.addEventListener("touchstart", () => this.markTouch(), { passive: true });
    window.addEventListener("keydown", (e) => {
      // Never steal keys from text fields (e.g. typing a name with W/A/S/D in it).
      if (e.target instanceof HTMLInputElement) return;
      if ([...KEY_UP, ...KEY_DOWN, ...KEY_LEFT, ...KEY_RIGHT, "Space"].includes(e.code)) {
        e.preventDefault();
      }
      this.keys.add(e.code);
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => this.keys.clear());

    const canvas = document.getElementById("game")!;
    canvas.addEventListener("pointerdown", (e) => this.onDown(e));
    window.addEventListener("pointermove", (e) => this.onMove(e));
    window.addEventListener("pointerup", (e) => this.onUp(e));
    window.addEventListener("pointercancel", (e) => this.onUp(e));

    forgetButton.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      this.forgetTouch = true;
    });
    const release = () => (this.forgetTouch = false);
    forgetButton.addEventListener("pointerup", release);
    forgetButton.addEventListener("pointerleave", release);
    forgetButton.addEventListener("pointercancel", release);
  }

  private onDown(e: PointerEvent) {
    if (e.pointerType === "mouse" || this.joyId !== null) return;
    this.markTouch();
    this.joyId = e.pointerId;
    Object.assign(this.joy, { active: true, ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY });
  }

  private markTouch() {
    this.touchUsed = true;
    document.body.classList.add("touch");
  }

  private onMove(e: PointerEvent) {
    if (e.pointerId !== this.joyId) return;
    const dx = e.clientX - this.joy.ox;
    const dy = e.clientY - this.joy.oy;
    const d = Math.hypot(dx, dy);
    // Drag the origin along so the stick never feels "stuck" past its edge.
    if (d > JOY_RADIUS) {
      this.joy.ox = e.clientX - (dx / d) * JOY_RADIUS;
      this.joy.oy = e.clientY - (dy / d) * JOY_RADIUS;
    }
    this.joy.x = e.clientX;
    this.joy.y = e.clientY;
  }

  private onUp(e: PointerEvent) {
    if (e.pointerId !== this.joyId) return;
    this.joyId = null;
    this.joy.active = false;
  }

  private held(codes: string[]): boolean {
    return codes.some((c) => this.keys.has(c));
  }

  /** Current input as the sim bitmask. */
  read(): number {
    let sx = 0;
    let sy = 0;
    if (this.held(KEY_LEFT)) sx -= 1;
    if (this.held(KEY_RIGHT)) sx += 1;
    if (this.held(KEY_UP)) sy -= 1;
    if (this.held(KEY_DOWN)) sy += 1;

    if (this.joy.active) {
      const dx = this.joy.x - this.joy.ox;
      const dy = this.joy.y - this.joy.oy;
      if (Math.hypot(dx, dy) > JOY_DEADZONE) {
        // Snap to one of 8 directions.
        const sector = Math.round(Math.atan2(dy, dx) / (Math.PI / 4));
        const a = sector * (Math.PI / 4);
        sx = Math.round(Math.cos(a));
        sy = Math.round(Math.sin(a));
      }
    }

    // Screen -> arena. Arena is rotated +90° on portrait: screen = (-ay, ax).
    const ax = this.rotated ? sy : sx;
    const ay = this.rotated ? -sx : sy;

    let bits = 0;
    if (ax < 0) bits |= IN_LEFT;
    if (ax > 0) bits |= IN_RIGHT;
    if (ay < 0) bits |= IN_UP;
    if (ay > 0) bits |= IN_DOWN;
    if (this.held(KEY_FORGET) || this.forgetTouch) bits |= IN_FORGET;
    return bits;
  }

  pressed(code: string): boolean {
    return this.keys.has(code);
  }

  clear() {
    this.keys.clear();
    this.forgetTouch = false;
    this.joyId = null;
    this.joy.active = false;
  }

  setForgetVisible(visible: boolean) {
    this.forgetButton.style.display = visible ? "" : "none";
  }
}
