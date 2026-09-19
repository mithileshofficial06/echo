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
- **The leaderboard is made of echoes too.** Everyone plays the same daily seed. Every run on the board can be watched as a full replay.
- **Scores can't be faked.** The game is fully deterministic (fixed 60 Hz timestep and a seeded RNG). The client only submits its input log. The server re-simulates the whole run with the same engine code and computes the score itself.

## Tech

- **Vite + TypeScript + Canvas 2D**, with no game framework. About 16 KB of JS gzipped.
- **WebAudio** for all music and sound effects.
- **Supabase** for the leaderboard: a Postgres `runs` table (public read, no client writes) and a `submit-run` edge function that verifies runs.
- **Vercel** for static hosting.

```
src/
  engine/     deterministic simulation: sim, seeded RNG, input log encoding
  render/     canvas renderer, effects, memory image
  audio/      WebAudio music sequencer and sfx
  net/        leaderboard client (Supabase REST, offline fallback)
  ui/         DOM helpers
  game.ts     fixed-timestep game controller
  main.ts     app shell and screens
supabase/
  migrations/ runs table + leaderboard view
  functions/submit-run/  server-side run verification
```

## Development

```bash
npm install
npm run dev               # http://localhost:5173  (add ?bot to let a bot play)
npm run build             # production build to dist/
npm run test:determinism  # replays 50 bot runs and checks they re-simulate identically
```

The game works fully offline; scores are then saved on the device. To enable the global leaderboard, copy `.env.example` to `.env.local` and fill in your Supabase URL and anon key.

### Backend setup

1. Apply `supabase/migrations/*.sql` to your Supabase project.
2. Run `npm run build:engine` to bundle the game engine into the edge function.
3. Deploy `supabase/functions/submit-run`. It uses the built-in `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` secrets.
