-- Sport board (owner only, server side): API cache and saved predictions.
create table if not exists public.sport_cache (key text primary key, data jsonb not null, at timestamptz not null default now());
create table if not exists public.sport_predictions (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  home text not null, away text not null, league text,
  kickoff timestamptz,
  xg_home numeric, xg_away numeric,
  p_home numeric, p_draw numeric, p_away numeric, p_btts numeric, p_o25 numeric,
  pick text, result text, note text
);
alter table public.sport_cache enable row level security;
alter table public.sport_predictions enable row level security;
revoke all on public.sport_cache, public.sport_predictions from anon, authenticated;
