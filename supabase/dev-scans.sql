-- Dev wallet scanner cache (lib/dev-history.ts)
create table if not exists public.dev_scans (chain text not null, wallet text not null, report jsonb not null, scanned_at timestamptz not null default now(), primary key (chain, wallet));
alter table public.dev_scans enable row level security;
revoke all on public.dev_scans from public, anon, authenticated;
grant all on public.dev_scans to service_role;
