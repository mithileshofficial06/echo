import { encodeInputs, decodeInputs } from "../engine/replay";
import type { RunSummary } from "../engine/sim";

// The leaderboard lives entirely in this browser: no server, no database, no keys.

export interface LeaderboardEntry {
  id: string;
  name: string;
  score: number;
  loops: number;
  orbs: number;
  max_combo: number;
  day: string;
  created_at: string;
  games_played?: number;
}

export type LeaderboardScope = "daily" | "overall";

export interface SubmitResult {
  ok: boolean;
  entry?: LeaderboardEntry;
  rank?: number;
  overallRank?: number;
  error?: string;
}

export interface ReplayData {
  seed: number;
  inputs: Uint8Array;
  name: string;
}

const LOCAL_KEY = "echo.localRuns";
const MAX_RUNS = 50;

interface LocalRun extends LeaderboardEntry {
  seed: number;
  inputs: string;
}

function readLocal(): LocalRun[] {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) || "[]");
  } catch {
    return [];
  }
}

function writeLocal(runs: LocalRun[]): boolean {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(runs.slice(0, MAX_RUNS)));
    return true;
  } catch {
    return false; // storage full or unavailable
  }
}

/** Best run per name, highest first, with how many runs each name has played. */
function bestPerName(runs: LocalRun[]): LeaderboardEntry[] {
  const best = new Map<string, LeaderboardEntry>();
  const played = new Map<string, number>();
  for (const r of runs) {
    played.set(r.name, (played.get(r.name) ?? 0) + 1);
    const cur = best.get(r.name);
    if (!cur || r.score > cur.score) best.set(r.name, r);
  }
  return [...best.values()]
    .map((r) => ({ ...r, games_played: played.get(r.name) }))
    .sort((a, b) => b.score - a.score || a.created_at.localeCompare(b.created_at));
}

export async function submitRun(
  name: string,
  day: string,
  seed: number,
  inputs: Uint8Array,
  summary: RunSummary,
): Promise<SubmitResult> {
  const entry: LocalRun = {
    id: `local-${Date.now()}`,
    name,
    score: summary.score,
    loops: summary.loops,
    orbs: summary.orbs,
    max_combo: summary.maxCombo,
    day,
    created_at: new Date().toISOString(),
    seed,
    inputs: encodeInputs(inputs),
  };
  const runs = [...readLocal(), entry].sort((a, b) => b.score - a.score);
  if (!writeLocal(runs)) return { ok: false, error: "Could not save: browser storage is unavailable." };
  const rank = bestPerName(runs.filter((r) => r.day === day)).findIndex((r) => r.name === name) + 1;
  const overallRank = bestPerName(runs).findIndex((r) => r.name === name) + 1;
  return { ok: true, entry, rank, overallRank };
}

export async function fetchTop(day: string, limit = 20, scope: LeaderboardScope = "daily"): Promise<LeaderboardEntry[]> {
  const runs = readLocal();
  return bestPerName(scope === "daily" ? runs.filter((r) => r.day === day) : runs).slice(0, limit);
}

export async function fetchReplay(id: string): Promise<ReplayData> {
  const run = readLocal().find((r) => r.id === id);
  if (!run) throw new Error("Replay not found");
  return { seed: run.seed, inputs: decodeInputs(run.inputs), name: run.name };
}

// ---------- Personal best + player name ----------

export function getBest(): number {
  try {
    return Number(localStorage.getItem("echo.best") || 0);
  } catch {
    return 0;
  }
}

export function setBest(score: number) {
  try {
    localStorage.setItem("echo.best", String(score));
  } catch {
    /* ignore */
  }
}

export function getName(): string {
  try {
    return localStorage.getItem("echo.name") || "";
  } catch {
    return "";
  }
}

export function setName(name: string) {
  try {
    localStorage.setItem("echo.name", name);
  } catch {
    /* ignore */
  }
}

export function cleanName(raw: string): string {
  return raw.replace(/[^\p{L}\p{N} _.-]/gu, "").trim().slice(0, 16);
}
