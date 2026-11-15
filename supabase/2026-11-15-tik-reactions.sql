-- TIK reactions (applied 2026-11-15)
alter table public.tik_likes add column if not exists kind text not null default 'love';
alter table public.tik_likes drop constraint if exists tik_likes_kind_check;
alter table public.tik_likes add constraint tik_likes_kind_check check (kind in ('love','haha','fire','100','wow','sad','pray','clap'));
drop policy if exists "change my tik reaction" on public.tik_likes;
create policy "change my tik reaction" on public.tik_likes for update using (user_id = auth.uid()) with check (user_id = auth.uid());
