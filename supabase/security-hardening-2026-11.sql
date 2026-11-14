-- Security hardening (Nov 2026), from Supabase's security advisor. Already applied to the live database.
-- 1. Fixed search_path on the two private helper functions (they only build vault key names).
alter function private.ai_trader_key_name(integer) set search_path = '';
alter function private.ai_trader_w2_name(integer, text) set search_path = '';
-- 2. TIK view counting is for signed-in members only (TIK is members-only): logged-out visitors can't call it.
revoke execute on function public.tik_seen(uuid[]) from anon;
--
-- Reviewed and kept on purpose:
-- - 57 tables with RLS on and no policies: only the server (service role) can read or write them. Safest setting.
-- - member_points / launch_watch_counts are SECURITY DEFINER views: they only publish totals (leaderboard points,
--   watcher counts) and need to count everyone's rows. Nothing private is exposed.
-- - SECURITY DEFINER functions callable by members: each checks auth.uid() or is_admin() inside.
-- - is_staff / is_helper / can_see_room / live_room_summary callable logged-out: they answer false / public info.
-- - pg_net in the public schema: moving it can break scheduled jobs; it isn't exposed through the API.
