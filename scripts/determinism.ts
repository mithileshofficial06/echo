// Plays random bot runs, then re-simulates from the encoded input log
// and checks the results match exactly. Run with: npm run test:determinism
import { Sim, simulate } from "../src/engine/sim";
import { InputLog, decodeInputs, encodeInputs } from "../src/engine/replay";
import { Rng } from "../src/engine/rng";
import { ARENA_H, ARENA_W, IN_DOWN, IN_LEFT, IN_RIGHT, IN_UP } from "../src/engine/constants";

let failures = 0;

for (let run = 0; run < 50; run++) {
  const seed = (run * 2654435761) >>> 0;
  const sim = new Sim(seed);
  const log = new InputLog();
  const bot = new Rng(run + 1);
  let input = 0;

  while (!sim.dead && sim.tick < 60 * 60 * 5) {
    // Head for the nearest orb with some noise, occasionally press forget.
    const target = sim.orbs.find((o) => o.alive);
    if (sim.tick % 6 === 0) {
      input = 0;
      const tx = target ? target.x : ARENA_W / 2;
      const ty = target ? target.y : ARENA_H / 2;
      if (tx < sim.px - 4) input |= IN_LEFT;
      if (tx > sim.px + 4) input |= IN_RIGHT;
      if (ty < sim.py - 4) input |= IN_UP;
      if (ty > sim.py + 4) input |= IN_DOWN;
      if (bot.next() < 0.15) input = 1 << Math.floor(bot.next() * 4);
      if (bot.next() < 0.02) input |= 16;
    }
    log.push(input);
    sim.step(input);
  }

  const original = sim.summary();
  const decoded = decodeInputs(encodeInputs(log.toArray()));
  const replayed = simulate(seed, decoded);

  const same = JSON.stringify(original) === JSON.stringify({ ...replayed, dead: undefined });
  if (!same || replayed.dead !== sim.dead) {
    failures++;
    console.log("MISMATCH", run, original, replayed);
  } else if (run < 5) {
    console.log(`run ${run}: loops=${original.loops} score=${original.score} bytes=${encodeInputs(log.toArray()).length}`);
  }
}

console.log(failures === 0 ? "All 50 runs deterministic." : `${failures} failures`);
process.exit(failures === 0 ? 0 : 1);
