# ECHO

**Every move you make comes back to haunt you.**

ECHO is a browser arcade game about surviving your own past. Each loop lasts 10 seconds. When a loop ends, it replays as a ghost, an *echo*, alongside every loop before it. Collect orbs, don't touch your past selves, and see how many loops you can survive.

## How to play

| | |
|---|---|
| ◆ **Collect** | Grab enough orbs before the 10-second loop ends, or you fade. The quota rises as you go. |
| ◯ **Meet your past** | Every finished loop replays as an echo. All of them at once. Touch one and the run is over. |
| ≋ **Sync** | Brush past an echo without touching it to build combo. Combo multiplies orb points. |
| ✕ **Forget** | Erase your oldest echo. You earn one charge every 3 loops. |

**Controls:** `WASD` / arrows to move, `Space` to forget, `Esc` to pause, `M` to mute.
**Mobile:** drag anywhere to move, tap **FORGET**. Portrait screens get a rotated arena.

## What makes it different

- **The music loops with you.** A loop is exactly 4 bars at 96 BPM. Every living echo adds a layer to the track, and forgetting one removes it. All audio is synthesized live with WebAudio, so the game ships no audio files.
- **Your run becomes a picture.** On game over, every loop's path is painted into a *memory*, a unique image you can save and share.
- **The leaderboard is made of echoes too.** Everyone in the world plays the same daily seed. Every run on the global board is stored as its input log and can be watched as a full replay.
- **Fully deterministic.** A fixed 60 Hz timestep and a seeded RNG mean the same seed and inputs always produce the same run, which is what makes replays and score verification possible.
- **Scores can't be faked.** The client never sends a score, only its inputs. A Supabase edge function re-runs the exact same simulation code on the server and records the score it computes.

## Tech

- **Next.js + TypeScript + Canvas 2D**, with no game framework. About 16 KB of game JS gzipped.
- **WebAudio** for all music and sound effects.
- **Supabase** (Postgres + an edge function) for the global leaderboard. Clients can only read; row-level security blocks direct writes.
- **Static hosting.** The app prerenders to a single static page, so it deploys to Vercel (or any Next.js host) with zero configuration.

```
src/
  engine/     deterministic simulation: sim, seeded RNG, input log encoding
  render/     canvas renderer, effects, memory image
  audio/      WebAudio music sequencer and sfx
  net/        leaderboard client (Supabase, with a localStorage fallback)
  ui/         DOM helpers and the first-run coach
  game.ts     fixed-timestep game controller
  main.ts     app shell and screens
supabase/
  migrations/            runs, players, leaderboard views, record_run()
  functions/submit-run/  verifies a run by re-simulating it, then records it
```

## Development

```bash
npm install
npm run dev               # http://localhost:3000  (add ?bot to let a bot play)
npm run build             # production build
npm run start             # serve the production build
npm run test:determinism  # replays 50 bot runs and checks they re-simulate identically
npm run build:engine      # re-bundle the engine into the edge function after changing src/engine
```

## Deploy

There is nothing to configure. Import the repository into Vercel and it
detects Next.js automatically. The game talks to ECHO's Supabase project out
of the box; its publishable key is safe to ship because the database only
accepts writes from the verifying edge function.

To run your own leaderboard, create a Supabase project, apply
`supabase/migrations`, deploy `supabase/functions/submit-run` (with JWT
verification off, since it verifies runs itself), and set the variables in
`.env.example`. Set `NEXT_PUBLIC_SUPABASE_URL` to an empty value to keep
scores in the browser only.

First-time players get a guided tour through loop one. To see it again,
remove `echo.tutorialSeen` from the site's localStorage.

