import { encodeInputs, decodeInputs } from "../engine/replay";
import type { RunSummary } from "../engine/sim";

// The shared leaderboard lives in Supabase. Clients can only read it; runs are
// submitted to the submit-run edge function, which re-simulates them to verify
// the score. Without Supabase settings it falls back to this browser's storage.

export interface LeaderboardEntry {
  id: string | null;
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

// Publishable keys are meant to ship in the page: the database only allows
// reads, and writes go through score verification. Env vars override them.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://doaxrnvcnqkdwaubkhki.supabase.co";
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "sb_publishable_RHOfqqDoUkg78XUsINeAGg_YIl2N2CD";

export const online = !!(SUPABASE_URL && SUPABASE_KEY);

async function api(path: string, init: RequestInit = {}) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.message || `HTTP ${res.status}`);
  return data;
}

// ---------- Local fallback (used when Supabase isn't configured) ----------

const LOCAL_KEY = "echo.localRuns";
const MAX_RUNS = 50;

interface LocalRun extends LeaderboardEntry {
  id: string;
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
  const encoded = encodeInputs(inputs);
  if (online) {
    try {
      // The edge function re-simulates the inputs and computes the score itself.
      const data = await api("/functions/v1/submit-run", {
        method: "POST",
        body: JSON.stringify({ name, day, inputs: encoded }),
      });
      return { ok: true, entry: data.entry, rank: data.rank, overallRank: data.overallRank };
    } catch (err) {
      return { ok: false, error: err instanceof TypeError ? "Could not reach the leaderboard." : String((err as Error).message) };
    }
  }

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
    inputs: encoded,
  };
  const runs = [...readLocal(), entry].sort((a, b) => b.score - a.score);
  if (!writeLocal(runs)) return { ok: false, error: "Could not save: browser storage is unavailable." };
  const rank = bestPerName(runs.filter((r) => r.day === day)).findIndex((r) => r.name === name) + 1;
  const overallRank = bestPerName(runs).findIndex((r) => r.name === name) + 1;
  return { ok: true, entry, rank, overallRank };
}

export async function fetchTop(day: string, limit = 20, scope: LeaderboardScope = "daily"): Promise<LeaderboardEntry[]> {
  if (online) {
    return api(
      scope === "daily"
        ? `/rest/v1/leaderboard?select=id,name,score,loops,orbs,max_combo,day,created_at` +
            `&day=eq.${encodeURIComponent(day)}&order=score.desc,created_at.asc&limit=${limit}`
        : `/rest/v1/overall_leaderboard?select=id,name,score,games_played,created_at` +
            `&order=score.desc,created_at.asc&limit=${limit}`,
    );
  }
  const runs = readLocal();
  return bestPerName(scope === "daily" ? runs.filter((r) => r.day === day) : runs).slice(0, limit);
}

export async function fetchReplay(id: string): Promise<ReplayData> {
  if (online && !id.startsWith("local-")) {
    const [row] = await api(`/rest/v1/runs?select=seed,inputs,name&id=eq.${encodeURIComponent(id)}`);
    if (!row) throw new Error("Replay not found");
    return { seed: Number(row.seed), inputs: decodeInputs(row.inputs), name: row.name };
  }
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
