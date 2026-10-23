-- Table permissions for signed-in members (row-level security still decides which rows). These were missing on the
-- live database, which made "Follow", joining a live session and badge applications fail with "Couldn't save".
grant select, insert, delete on public.follows to authenticated;
grant select, insert, delete on public.session_joins to authenticated;
grant select, insert on public.badge_applications to authenticated;
