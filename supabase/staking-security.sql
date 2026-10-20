-- AUTISTIK Staking: where the contract lives on each chain, and pools the admin hid from the list.
create table if not exists public.staking_contracts (chain text primary key, address text not null, deployed_at timestamptz not null default now());
alter table public.staking_contracts enable row level security;
create policy "staking contracts are public" on public.staking_contracts for select using (true);
create table if not exists public.staking_hidden (chain text not null, pool_id integer not null, hidden_at timestamptz not null default now(), primary key (chain, pool_id));
alter table public.staking_hidden enable row level security;
create policy "hidden pools are public" on public.staking_hidden for select using (true);
revoke insert, update, delete, truncate on public.staking_contracts, public.staking_hidden from anon, authenticated;

-- Security-policy reports (/api/csp-report): only the directive, the blocked origin and the page path. Server-only.
create table if not exists public.csp_reports (directive text not null, blocked text not null, page text not null, disposition text not null, hits integer not null default 1, first_seen timestamptz not null default now(), last_seen timestamptz not null default now(), primary key (directive, blocked, page, disposition));
alter table public.csp_reports enable row level security;
create or replace function public.csp_report_add(p_directive text, p_blocked text, p_page text, p_disposition text) returns void language sql security definer set search_path = public as $$
  insert into public.csp_reports as r (directive, blocked, page, disposition) values (left(p_directive, 60), left(p_blocked, 200), left(p_page, 120), left(p_disposition, 12))
  on conflict (directive, blocked, page, disposition) do update set hits = r.hits + 1, last_seen = now();
$$;
revoke all on function public.csp_report_add(text, text, text, text) from public, anon, authenticated;

-- Analytics privacy: sign-in pages are no longer counted; remove old records of them, and keep visits 180 days.
delete from public.page_views where path ~ '^/(login|auth|reset-password|me)(/|$)';
select cron.schedule('autistik-retention', '17 3 * * *', $$delete from public.page_views where at < now() - interval '180 days'; delete from public.csp_reports where last_seen < now() - interval '60 days';$$);
