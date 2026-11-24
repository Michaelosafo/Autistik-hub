-- SPORT provider switch: football-data.org v4.
-- The existing sport_cache and sport_predictions tables remain compatible.
-- Run this migration in Supabase SQL Editor after deploying the code.
create index if not exists sport_predictions_created_at_idx
  on public.sport_predictions (created_at desc);

comment on table public.sport_cache is
  'Server-only cache for SPORT provider responses. football-data.org cache keys use the football-data: prefix.';
comment on table public.sport_predictions is
  'Server-only SPORT model predictions and manually recorded results.';
