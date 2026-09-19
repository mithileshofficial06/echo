import { encodeInputs, decodeInputs } from "../engine/replay";
import type { RunSummary } from "../engine/sim";

export interface LeaderboardEntry {
  id: string;
  name: string;
  score: number;
  loops: number;
  orbs: number;
  max_combo: number;
  day: string;
  created_at: string;
  verified?: boolean;
}

export interface SubmitResult {
  ok: boolean;
  entry?: LeaderboardEntry;
  rank?: number;
  error?: string;
}

export interface ReplayData {
  seed: number;
  inputs: Uint8Array;
  name: string;
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const online = !!(SUPABASE_URL && SUPABASE_KEY);

function headers(): Record<string, string> {
  return {
    apikey: SUPABASE_KEY!,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    "Content-Type": "application/json",
  };
}

// ---------- Local fallback (works offline / before Supabase is configured) ----------

const LOCAL_KEY = "echo.localRuns";

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

function writeLocal(runs: LocalRun[]) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(runs.slice(0, 50)));
  } catch {
    /* storage full or unavailable */
  }
}

// ---------- Public API ----------

export async function submitRun(
  name: string,
  day: string,
  seed: number,
  inputs: Uint8Array,
  summary: RunSummary,
): Promise<SubmitResult> {
  const encoded = encodeInputs(inputs);

  if (!online) {
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
    writeLocal(runs);
    const rank = runs.filter((r) => r.day === day).findIndex((r) => r.id === entry.id) + 1;
    return { ok: true, entry, rank };
  }

  try {
    // The edge function re-simulates the inputs and computes the score itself.
    const res = await fetch(`${SUPABASE_URL}/functions/v1/submit-run`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ name, day, inputs: encoded }),
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data.error || `HTTP ${res.status}` };
    return { ok: true, entry: data.entry, rank: data.rank };
  } catch (err) {
    return { ok: false, error: "Could not reach the leaderboard." };
  }
}

export async function fetchTop(day: string, limit = 20): Promise<LeaderboardEntry[]> {
  if (!online) {
    return readLocal()
      .filter((r) => r.day === day)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
  const url =
    `${SUPABASE_URL}/rest/v1/runs?select=id,name,score,loops,orbs,max_combo,day,created_at,verified` +
    `&day=eq.${encodeURIComponent(day)}&order=score.desc,created_at.asc&limit=${limit}`;
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function fetchReplay(id: string): Promise<ReplayData> {
  if (!online || id.startsWith("local-")) {
    const run = readLocal().find((r) => r.id === id);
    if (!run) throw new Error("Replay not found");
    return { seed: run.seed, inputs: decodeInputs(run.inputs), name: run.name };
  }
  const res = await fetch(`${SUPABASE_URL}/rest/v1/runs?select=seed,inputs,name&id=eq.${encodeURIComponent(id)}`, {
    headers: headers(),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const [row] = await res.json();
  if (!row) throw new Error("Replay not found");
  return { seed: Number(row.seed), inputs: decodeInputs(row.inputs), name: row.name };
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
