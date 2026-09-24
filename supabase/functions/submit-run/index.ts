// Verifies and stores a daily run.
// The client only sends a name, the day and its input log. The score is
// computed here by re-simulating the run, so it can't be faked.
import { dailyKey, dailySeed, decodeInputs, simulate, TICK_RATE } from "./engine.js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const MAX_TICKS = TICK_RATE * 60 * 30; // 30 minutes
const MAX_ENCODED = 200_000;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: { name?: unknown; day?: unknown; inputs?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const name = String(body.name ?? "")
    .replace(/[^\p{L}\p{N} _.-]/gu, "")
    .trim()
    .slice(0, 16)
    .toUpperCase();
  if (!name) return json({ error: "Name required" }, 400);

  // Accept today, or yesterday for runs that crossed midnight UTC.
  const day = String(body.day ?? "");
  const now = new Date();
  const yesterday = new Date(now.getTime() - 86_400_000);
  if (day !== dailyKey(now) && day !== dailyKey(yesterday)) {
    return json({ error: "That daily loop has closed." }, 400);
  }

  const encoded = String(body.inputs ?? "");
  if (!encoded || encoded.length > MAX_ENCODED) return json({ error: "Invalid run" }, 400);

  let inputs: Uint8Array;
  try {
    inputs = decodeInputs(encoded);
  } catch {
    return json({ error: "Invalid run" }, 400);
  }
  if (inputs.length > MAX_TICKS) return json({ error: "Run too long" }, 400);

  const seed = dailySeed(day);
  const result = simulate(seed, inputs);
  // Every real run ends in a death, on exactly its last input.
  if (!result.dead || inputs.length > result.ticks + 1) {
    return json({ error: "Run did not verify" }, 400);
  }

  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/record_run`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      p_name: name,
      p_day: day,
      p_seed: seed,
      p_score: result.score,
      p_loops: result.loops,
      p_orbs: result.orbs,
      p_max_combo: result.maxCombo,
      p_ticks: result.ticks,
      p_inputs: encoded,
    }),
  });
  if (!res.ok) return json({ error: "Could not save run" }, 500);
  return json(await res.json());
});
