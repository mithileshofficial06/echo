-- Every submitted daily run. Rows are only written by the submit-run edge
-- function (service role) after it re-simulates the inputs and checks the score.
create table public.runs (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 16),
  day date not null,
  seed bigint not null,
  score integer not null check (score >= 0),
  loops integer not null,
  orbs integer not null,
  max_combo integer not null,
  ticks integer not null,
  inputs text not null,
  verified boolean not null default true,
  created_at timestamptz not null default now()
);

create index runs_day_score_idx on public.runs (day, score desc);

alter table public.runs enable row level security;

-- Anyone can read the board and watch replays. No insert/update/delete
-- policies: clients can't write directly.
create policy "Runs are publicly readable" on public.runs
  for select using (true);

-- One row per player per day: their best run.
create view public.leaderboard
with (security_invoker = true) as
select distinct on (day, name)
  id, name, score, loops, orbs, max_combo, day, created_at, verified
from public.runs
order by day, name, score desc, created_at asc;
