-- Applied 2026-11-07 (migrations notifications_allow_query_links, tik_notify_never_blocks).
-- TIK likes and replies notify with links like /mood?tik=<id>. The old check refused "?" and "=", so the
-- notification insert failed and took the like or reply down with it.
alter table public.notifications drop constraint notifications_link_check;
alter table public.notifications add constraint notifications_link_check
  check (link is null or link ~ '^/([A-Za-z0-9_-][A-Za-z0-9/_-]*)?(\?[A-Za-z0-9_=&-]*)?$');

-- A notification problem must never stop a like or a reply from saving.
create or replace function public.tik_notify()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
declare owner uuid; who text; snippet text;
begin
  begin
    if tg_table_name = 'tik_likes' then
      select author_id, left(body, 80) into owner, snippet from public.tiks where id = new.tik_id;
      if owner is null or owner = new.user_id then return new; end if;
      if exists (select 1 from public.notifications where user_id = owner and link = '/mood?tik=' || new.tik_id and title like '%liked your Tik' and created_at > now() - interval '1 day'
                 and body = (select alias from public.profiles where id = new.user_id)) then return new; end if;
      select alias into who from public.profiles where id = new.user_id;
      insert into public.notifications (user_id, title, body, link) values (owner, coalesce(who, 'Someone') || ' liked your Tik', coalesce(who, 'Someone'), '/mood?tik=' || new.tik_id);
    elsif new.reply_to is not null then
      select author_id into owner from public.tiks where id = new.reply_to;
      if owner is null or owner = new.author_id then return new; end if;
      select alias into who from public.profiles where id = new.author_id;
      insert into public.notifications (user_id, title, body, link) values (owner, coalesce(who, 'Someone') || ' replied to your Tik', left(new.body, 140), '/mood?tik=' || new.reply_to);
    end if;
  exception when others then
    raise warning 'tik_notify skipped: %', sqlerrm;
  end;
  return new;
end $function$;
