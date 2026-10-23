-- AUTISTIK badges: gold ✓ TEAM (Hub staff) and violet ✓ VERIFIED (approved members). Members can apply; only the
-- owner (admin, with 2-step verification) approves. Safe to run more than once.

alter table public.profiles add column if not exists is_verified boolean not null default false;

-- Nobody can give themselves a badge.
create or replace function public.profile_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  new.alias := btrim(regexp_replace(new.alias, '\s+', ' ', 'g'));
  if new.color !~ '^#[0-9A-Fa-f]{6}$' then
    raise exception 'Pick one of the colours shown.' using errcode = 'P0001';
  end if;
  if not public.is_admin() then
    new.is_team := old.is_team;
    new.team_title := old.team_title;
    new.is_verified := old.is_verified;
  end if;
  if not public.is_admin() and not old.is_team and new.alias ~* '(admin|moderator|\ymod\y|official|autistik|support team|hub team|\yteam\y|\ystaff\y|\ydev\y|founder)' then
    raise exception 'That name is reserved for the Hub team. Please pick another.' using errcode = 'P0001';
  end if;
  if new.alias is distinct from old.alias and exists (select 1 from public.profiles p where lower(p.alias) = lower(new.alias) and p.id <> new.id) then
    raise exception 'Another member already has that name. Please pick another.' using errcode = 'P0001';
  end if;
  return new;
end; $$;
revoke all on function public.profile_guard() from public, anon, authenticated;

create table if not exists public.badge_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('verified', 'team')),
  reason text not null check (char_length(reason) between 10 and 600),
  link text check (link is null or char_length(link) <= 300),
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  note text,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create unique index if not exists badge_one_pending on public.badge_applications (user_id) where status = 'pending';
alter table public.badge_applications enable row level security;
drop policy if exists "own applications" on public.badge_applications;
create policy "own applications" on public.badge_applications for select to authenticated using (user_id = auth.uid() or public.is_admin());
drop policy if exists "apply" on public.badge_applications;
create policy "apply" on public.badge_applications for insert to authenticated
  with check (user_id = auth.uid() and status = 'pending' and note is null and decided_at is null);

-- Owner decides. Approving gives the badge; team applications also take a title like "Host".
create or replace function public.review_badge(p_id uuid, p_approve boolean, p_title text default null, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare a public.badge_applications;
begin
  if not public.is_admin() then raise exception 'Admins only.' using errcode = '42501'; end if;
  select * into a from public.badge_applications where id = p_id and status = 'pending';
  if not found then raise exception 'That application was already decided.' using errcode = 'P0001'; end if;
  update public.badge_applications set status = case when p_approve then 'approved' else 'declined' end,
    note = nullif(btrim(coalesce(p_note, '')), ''), decided_at = now() where id = p_id;
  if p_approve then
    if a.kind = 'team' then
      update public.profiles set is_team = true, team_title = coalesce(nullif(btrim(coalesce(p_title, '')), ''), 'Team') where id = a.user_id;
    else
      update public.profiles set is_verified = true where id = a.user_id;
    end if;
  end if;
end; $$;
revoke all on function public.review_badge(uuid, boolean, text, text) from public, anon;
grant execute on function public.review_badge(uuid, boolean, text, text) to authenticated;

-- Admin can also give or take a verified badge directly.
create or replace function public.set_verified(p_id uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only.' using errcode = '42501'; end if;
  update public.profiles set is_verified = p_on where id = p_id;
end; $$;
revoke all on function public.set_verified(uuid, boolean) from public, anon;
grant execute on function public.set_verified(uuid, boolean) to authenticated;
