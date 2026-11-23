-- Live rooms / chat / videos lost their table grants after hardening.sql
-- (new tables get none by default). RLS policies already gate rows; these
-- grants only let the API reach the tables, limited to the columns the app writes.

grant select on public.live_room_messages to anon, authenticated;
grant insert (room_id, body, image_url) on public.live_room_messages to authenticated;

grant select on public.live_rooms to anon, authenticated;
grant insert (title, chain, token, visibility) on public.live_rooms to authenticated;
grant update (ended_at, speakers, cohosts) on public.live_rooms to authenticated;

grant select on public.videos to anon, authenticated;
