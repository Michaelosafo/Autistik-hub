-- Let members save and change their sticker reaction (applied 2026-11-15)
grant insert (tik_id, kind) on public.tik_likes to authenticated;
grant update (kind) on public.tik_likes to authenticated;
