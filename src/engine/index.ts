// Entry point bundled into the Supabase edge function, so the server
// verifies runs with exactly the same simulation code the game uses.
export { simulate } from "./sim";
export { decodeInputs } from "./replay";
export { dailyKey, dailySeed } from "./rng";
export { TICK_RATE } from "./constants";
