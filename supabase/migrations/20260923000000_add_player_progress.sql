-- Public player profiles are updated only by the verified edge function.
-- Names are canonicalized to uppercase there, so each name has one profile.
create table public.players (
  name text primary key check (char_length(name) between 1 and 16),
  best_score integer not null default 0 check (best_score >= 0),
  total_score bigint not null default 0 check (total_score >= 0),
  games_played integer not null default 0 check (games_played >= 0),
  total_loops integer not null default 0 check (total_loops >= 0),
  last_played_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.players enable row level security;
create policy "Player profiles are publicly readable" on public.players for select using (true);

-- Keeps profile writes atomic even when a player finishes runs in multiple tabs.
create or replace function public.record_player_progress(
  player_name text,
  run_score integer,
  run_loops integer
)
returns public.players
language plpgsql
security definer
set search_path = public
as $$
declare
  updated public.players;
begin
  insert into public.players (name, best_score, total_score, games_played, total_loops)
  values (player_name, run_score, run_score, 1, run_loops)
  on conflict (name) do update set
    best_score = greatest(players.best_score, excluded.best_score),
    total_score = players.total_score + excluded.total_score,
    games_played = players.games_played + 1,
    total_loops = players.total_loops + excluded.total_loops,
    last_played_at = now()
  returning * into updated;
  return updated;
end;
$$;

revoke all on function public.record_player_progress(text, integer, integer) from public, anon, authenticated;
grant execute on function public.record_player_progress(text, integer, integer) to service_role;

create index players_best_score_idx on public.players (best_score desc, last_played_at asc);

-- A stable all-time board. `score` intentionally mirrors best_score so the
-- client can display daily and all-time entries using the same score column.
create or replace view public.overall_leaderboard
with (security_invoker = true) as
select
  name,
  best_score as score,
  total_score,
  games_played,
  total_loops,
  last_played_at as created_at
from public.players;
