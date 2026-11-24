-- Sense of Scale: initial schema.
-- Content is authored in git (content/scales/*.json) and synced here by scripts/sync.mjs.
-- Only the server (secret / service_role key) touches these tables; browsers go through /api.

-- ---------- Content ----------
create table public.scales (
  id          text primary key,
  field       text not null,
  name        text not null,
  question    text not null,
  unit        text not null default '',
  type        text not null check (type in ('lin', 'log')),
  min         double precision not null,
  max         double precision not null,
  spec        jsonb not null default '{}'::jsonb,  -- step, tickStart, ticks, display
  updated_at  timestamptz not null default now(),
  check (min < max),
  check (type = 'lin' or min > 0)
);

create table public.items (
  id          text primary key,                    -- "<scale_id>/<slug>"
  scale_id    text not null references public.scales (id) on delete cascade,
  name        text not null,
  value       double precision not null,
  source      text not null,
  quote       text,
  fact        text,
  familiar    boolean not null default false,
  disputed    boolean not null default false,
  status      text not null default 'draft' check (status in ('draft', 'checked', 'verified', 'rejected')),
  updated_at  timestamptz not null default now()
);
create index items_scale_id_idx on public.items (scale_id);

-- ---------- Published puzzles ----------
-- `scales` is a frozen snapshot of exactly what players get, so later content edits never change a past puzzle.
create table public.puzzles (
  date        date primary key,
  number      integer not null unique check (number > 0),
  scales      jsonb not null,
  created_at  timestamptz not null default now()
);

-- One row for each player and day (in whichever mode they chose). ~1M rows a year at a few thousand
-- players a day; no partitioning needed yet.
create table public.results (
  date         date not null references public.puzzles (date),
  player_id    uuid not null,
  mode         text not null default 'hard' check (mode in ('easy', 'hard')),
  answer       jsonb not null,                       -- hard: { itemId: t }, easy: { scaleId: [itemId, ...] }
  score        integer not null check (score >= 0),
  item_scores  jsonb not null,
  created_at   timestamptz not null default now(),
  primary key (date, player_id)
);

-- Rolled up every minute by pg_cron, so busy moments don't make every player's request scan results.
create table public.daily_stats (
  date        date not null references public.puzzles (date),
  mode        text not null check (mode in ('easy', 'hard')),
  plays       integer not null default 0,
  mean        double precision,
  histogram   jsonb not null default '{}'::jsonb,  -- { "<score div 50>": count }
  updated_at  timestamptz not null default now(),
  primary key (date, mode)
);

-- ---------- Lock it down: no direct browser access ----------
alter table public.scales      enable row level security;
alter table public.items       enable row level security;
alter table public.puzzles     enable row level security;
alter table public.results     enable row level security;
alter table public.daily_stats enable row level security;
revoke all on public.scales, public.items, public.puzzles, public.results, public.daily_stats from anon, authenticated;

-- ---------- Stats rollup ----------
create or replace function public.refresh_daily_stats(since date default (now() at time zone 'utc')::date - 2)
returns void
language sql
security definer
set search_path = ''
as $$
  with buckets as (
    select date, mode, score / 50 as b, count(*) as c, sum(score) as total
    from public.results
    where date >= since
    group by date, mode, score / 50
  )
  insert into public.daily_stats (date, mode, plays, mean, histogram, updated_at)
  select date, mode, sum(c), sum(total)::double precision / sum(c), jsonb_object_agg(b::text, c), now()
  from buckets
  group by date, mode
  on conflict (date, mode) do update
    set plays = excluded.plays, mean = excluded.mean, histogram = excluded.histogram, updated_at = excluded.updated_at;
$$;
revoke execute on function public.refresh_daily_stats(date) from public, anon, authenticated;

-- ---------- Analytics: how hard each item really is ----------
create or replace view public.item_difficulty
with (security_invoker = true) as
select
  e.key                    as item_id,
  r.mode,
  count(*)                 as plays,
  avg((e.value)::numeric)  as avg_points
from public.results r, jsonb_each_text(r.item_scores) e
group by e.key, r.mode;
revoke all on public.item_difficulty from anon, authenticated;

-- pg_cron: enable the extension in the dashboard (Database → Extensions) if this fails, then rerun the line.
create extension if not exists pg_cron;
select cron.schedule('refresh-daily-stats', '* * * * *', $$ select public.refresh_daily_stats(); $$);
