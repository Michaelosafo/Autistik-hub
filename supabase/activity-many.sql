-- Activity of many members at once (the people you follow, or the people on a list). Same public kinds as
-- member_activity: coins scanned, launches, locks, pins, posts, live sessions and follows. Never wallets or trades.
create or replace function public.member_activity_many(p_ids uuid[], p_per int default 3, p_total int default 60) returns table (user_id uuid, at timestamptz, kind text, label text, link text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if auth.uid() is null then return; end if;
  return query
  select y.user_id, y.at, y.kind, y.label, y.link from (
    select x.*, row_number() over (partition by x.user_id order by x.at desc) rn from (
      select a.user_id, a.at, case a.kind when 'search' then 'scan' when 'report' then 'scan' else a.kind end as kind, a.label, a.link
        from public.activity_log a
        where a.user_id = any (p_ids[1:200]) and a.kind in ('search', 'report', 'launch', 'lock', 'pin', 'launchpad', 'locker')
      union all
      select p.author_id, p.created_at, 'post', left(p.body, 140), null from public.posts p where p.author_id = any (p_ids[1:200]) and not p.hidden
      union all
      select j.user_id, j.joined_at, 'live', s.title, '/live' from public.session_joins j join public.sessions s on s.id = j.session_id where j.user_id = any (p_ids[1:200])
      union all
      select f.follower_id, f.created_at, 'follow', pr.alias, '/members/' || pr.id from public.follows f join public.profiles pr on pr.id = f.followee_id where f.follower_id = any (p_ids[1:200])
    ) x
  ) y
  where y.rn <= least(greatest(p_per, 1), 30)
  order by y.at desc
  limit least(greatest(p_total, 1), 200);
end; $$;
revoke all on function public.member_activity_many(uuid[], int, int) from public, anon;
grant execute on function public.member_activity_many(uuid[], int, int) to authenticated;
