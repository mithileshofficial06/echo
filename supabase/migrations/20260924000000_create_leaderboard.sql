-- ECHO shared leaderboard.
-- Clients can only read. Every write goes through the submit-run edge function,
-- which re-simulates the run's inputs and calls record_run with the result.

-- Every verified daily run, with the input log that replays it.
create table public.runs (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 16),
  day date not null,
  seed bigint not null,
  score integer not null check (score >= 0),
  loops integer not null check (loops >= 0),
  orbs integer not null check (orbs >= 0),
  max_combo integer not null check (max_combo >= 0),
  ticks integer not null check (ticks >= 0),
  inputs text not null,
  created_at timestamptz not null default now()
);

create index runs_day_score_idx on public.runs (day, score desc);
create index runs_day_name_idx on public.runs (day, name);

alter table public.runs enable row level security;
create policy "Runs are publicly readable" on public.runs for select using (true);

-- One profile per name (names are uppercased by the edge function).
create table public.players (
  name text primary key check (char_length(name) between 1 and 16),
  best_score integer not null default 0 check (best_score >= 0),
  best_run_id uuid references public.runs (id) on delete set null,
  total_score bigint not null default 0 check (total_score >= 0),
  games_played integer not null default 0 check (games_played >= 0),
  total_loops integer not null default 0 check (total_loops >= 0),
  last_played_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index players_best_score_idx on public.players (best_score desc, last_played_at asc);
create index players_best_run_idx on public.players (best_run_id);

alter table public.players enable row level security;
create policy "Player profiles are publicly readable" on public.players for select using (true);

-- Daily board: each player's best run of the day.
create view public.leaderboard
with (security_invoker = true) as
select distinct on (day, name)
  id, name, score, loops, orbs, max_combo, day, created_at
from public.runs
order by day, name, score desc, created_at asc;

-- All-time board: each player's best run ever. `id` is that run, so it can be replayed.
create view public.overall_leaderboard
with (security_invoker = true) as
select
  best_run_id as id,
  name,
  best_score as score,
  total_score,
  games_played,
  total_loops,
  last_played_at as created_at
from public.players;

-- Stores a verified run, updates the player's profile and returns the new
-- ranks, all in one transaction so concurrent submissions stay consistent.
create function public.record_run(
  p_name text,
  p_day date,
  p_seed bigint,
  p_score integer,
  p_loops integer,
  p_orbs integer,
  p_max_combo integer,
  p_ticks integer,
  p_inputs text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  run public.runs;
  profile public.players;
  day_best integer;
  day_rank integer;
  overall_rank integer;
begin
  insert into public.runs (name, day, seed, score, loops, orbs, max_combo, ticks, inputs)
  values (p_name, p_day, p_seed, p_score, p_loops, p_orbs, p_max_combo, p_ticks, p_inputs)
  returning * into run;

  insert into public.players (name, best_score, best_run_id, total_score, games_played, total_loops)
  values (p_name, p_score, run.id, p_score, 1, p_loops)
  on conflict (name) do update set
    best_run_id = case when excluded.best_score > players.best_score then excluded.best_run_id else players.best_run_id end,
    best_score = greatest(players.best_score, excluded.best_score),
    total_score = players.total_score + excluded.total_score,
    games_played = players.games_played + 1,
    total_loops = players.total_loops + excluded.total_loops,
    last_played_at = now()
  returning * into profile;

  select max(r.score) into day_best from public.runs r where r.day = p_day and r.name = p_name;

  select count(distinct r.name) + 1 into day_rank
  from public.runs r
  where r.day = p_day and r.name <> p_name and r.score > day_best;

  select count(*) + 1 into overall_rank
  from public.players p
  where p.name <> p_name and p.best_score > profile.best_score;

  return jsonb_build_object(
    'entry', jsonb_build_object(
      'id', run.id, 'name', run.name, 'score', run.score, 'loops', run.loops,
      'orbs', run.orbs, 'max_combo', run.max_combo, 'day', run.day, 'created_at', run.created_at
    ),
    'rank', day_rank,
    'overallRank', overall_rank,
    'profile', jsonb_build_object(
      'name', profile.name, 'best_score', profile.best_score, 'total_score', profile.total_score,
      'games_played', profile.games_played, 'total_loops', profile.total_loops
    )
  );
end;
$$;

revoke all on function public.record_run(text, date, bigint, integer, integer, integer, integer, integer, text)
  from public, anon, authenticated;
grant execute on function public.record_run(text, date, bigint, integer, integer, integer, integer, integer, text)
  to service_role;
