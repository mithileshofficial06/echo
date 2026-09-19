import { ARENA_H, ARENA_W } from "../engine/constants";
import { hashString } from "../engine/rng";
import type { Sim } from "../engine/sim";
import { ACCENT, DANGER, FONT } from "./renderer";

export interface TapestryInfo {
  name?: string;
  mode: string;
}

const W = 1200;
const H = 1110;

/** Memory number: stable for a given run, so the same run always gets the same ID. */
export function memoryId(sim: Sim): string {
  const n = hashString(`${sim.seed}:${sim.score}:${sim.tick}`) % 10000;
  return String(n).padStart(4, "0");
}

/**
 * Paint every loop of a run as layered light trails: oldest loops dim,
 * newest in full accent, the fatal loop in white ending in a red mark.
 */
export function renderTapestry(sim: Sim, info: TapestryInfo): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const c = canvas.getContext("2d")!;

  c.fillStyle = "#000";
  c.fillRect(0, 0, W, H);

  // Header
  c.textBaseline = "top";
  c.fillStyle = "#fff";
  c.font = `800 44px ${FONT}`;
  c.fillText("ECHO", 60, 52);
  c.fillStyle = "#6b6b6b";
  c.font = `700 20px ${FONT}`;
  c.textAlign = "right";
  c.fillText(`MEMORY #${memoryId(sim)}`, W - 60, 56);
  c.fillText(info.mode, W - 60, 84);
  c.textAlign = "left";

  // Arena
  const scale = (W - 120) / ARENA_W;
  const ox = 60;
  const oy = 140;
  c.save();
  c.translate(ox, oy);
  c.scale(scale, scale);

  c.strokeStyle = "rgba(255,255,255,0.12)";
  c.lineWidth = 1.5;
  c.strokeRect(0, 0, ARENA_W, ARENA_H);

  const paths = sim.allPaths();
  const n = paths.length;
  c.lineCap = "round";
  c.lineJoin = "round";
  c.globalCompositeOperation = "lighter";

  paths.forEach((p, i) => {
    const last = i === n - 1;
    const recency = n > 1 ? i / (n - 1) : 1;
    if (last) {
      c.strokeStyle = "#fff";
      c.globalAlpha = 0.9;
      c.lineWidth = 3;
      c.setLineDash([]);
    } else if (p.forgotten) {
      c.strokeStyle = "#6b6b6b";
      c.globalAlpha = 0.35;
      c.lineWidth = 2;
      c.setLineDash([4, 8]);
    } else {
      c.strokeStyle = ACCENT;
      c.globalAlpha = 0.18 + recency * 0.6;
      c.lineWidth = 2 + recency * 1.5;
      c.setLineDash([]);
    }
    c.shadowColor = c.strokeStyle as string;
    c.shadowBlur = last ? 14 : 8;
    c.beginPath();
    c.moveTo(p.path[0], p.path[1]);
    for (let t = 2; t < p.length; t += 2) c.lineTo(p.path[t * 2], p.path[t * 2 + 1]);
    c.lineTo(p.path[(p.length - 1) * 2], p.path[(p.length - 1) * 2 + 1]);
    c.stroke();
  });

  // Where it ended.
  c.globalCompositeOperation = "source-over";
  c.globalAlpha = 1;
  c.setLineDash([]);
  c.shadowBlur = 16;
  c.shadowColor = DANGER;
  c.strokeStyle = DANGER;
  c.lineWidth = 4;
  const ex = sim.px;
  const ey = sim.py;
  c.beginPath();
  c.moveTo(ex - 12, ey - 12);
  c.lineTo(ex + 12, ey + 12);
  c.moveTo(ex + 12, ey - 12);
  c.lineTo(ex - 12, ey + 12);
  c.stroke();
  c.restore();

  // Stats
  const s = sim.summary();
  const stats: [string, string][] = [
    ["SCORE", s.score.toLocaleString("en-US")],
    ["LOOPS", String(s.loops)],
    ["ORBS", String(s.orbs)],
    ["BEST SYNC", `x${s.maxCombo}`],
  ];
  const sy = oy + ARENA_H * scale + 44;
  const colW = (W - 120) / stats.length;
  stats.forEach(([label, value], i) => {
    const x = 60 + i * colW;
    c.fillStyle = "#6b6b6b";
    c.font = `700 18px ${FONT}`;
    c.fillText(label, x, sy);
    c.fillStyle = i === 0 ? ACCENT : "#fff";
    c.font = `800 40px ${FONT}`;
    c.fillText(value, x, sy + 28);
  });

  c.fillStyle = "#6b6b6b";
  c.font = `400 18px ${FONT}`;
  const footer = info.name ? `${info.name} · every move comes back to haunt you` : "every move comes back to haunt you";
  c.fillText(footer, 60, H - 50);

  return canvas;
}

export function downloadCanvas(canvas: HTMLCanvasElement, filename: string) {
  const a = document.createElement("a");
  a.download = filename;
  a.href = canvas.toDataURL("image/png");
  a.click();
}
