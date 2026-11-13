-- Post views: how many different members saw each post. Run once in Supabase SQL Editor.
-- A member counts once per post (seeing it again doesn't add more), and authors don't count on their own posts.
create table if not exists public.post_views (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  seen_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create index if not exists post_views_post on public.post_views (post_id);
alter table public.post_views enable row level security;  -- no policies: only the two functions below touch it

-- The signed-in member saw these posts (called by the page as posts scroll into view).
create or replace function public.mark_post_views(ids uuid[])
returns void language sql security definer set search_path = public as $$
  insert into post_views (post_id, user_id)
  select p.id, auth.uid() from posts p
  where auth.uid() is not null and p.id = any(ids[1:100]) and not p.hidden and p.author_id <> auth.uid()
  on conflict do nothing;
$$;

-- How many members saw each of these posts.
create or replace function public.post_view_counts(ids uuid[])
returns table (post_id uuid, views bigint) language sql stable security definer set search_path = public as $$
  select v.post_id, count(*) from post_views v where v.post_id = any(ids[1:200]) group by v.post_id;
$$;

revoke all on function public.mark_post_views(uuid[]) from public, anon;
revoke all on function public.post_view_counts(uuid[]) from public, anon;
grant execute on function public.mark_post_views(uuid[]) to authenticated;
grant execute on function public.post_view_counts(uuid[]) to authenticated;
