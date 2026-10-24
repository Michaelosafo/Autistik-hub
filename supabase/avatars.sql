-- Profile pictures (Display → your profile picture in the left panel, /me).
-- Each member uploads into their own folder of the public "avatars" bucket: avatars/<their user id>/<file>.
-- profiles.avatar_url can only point at that member's own folder, so nobody can show someone else's image or a
-- link to another site. Safe to run more than once.

alter table public.profiles add column if not exists avatar_url text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do update set public = true, file_size_limit = 2097152, allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

drop policy if exists "avatars readable" on storage.objects;
create policy "avatars readable" on storage.objects for select using (bucket_id = 'avatars');
drop policy if exists "avatars upload own" on storage.objects;
create policy "avatars upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "avatars update own" on storage.objects;
create policy "avatars update own" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "avatars delete own" on storage.objects;
create policy "avatars delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create or replace function public.avatar_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.avatar_url is null or new.avatar_url is not distinct from old.avatar_url then return new; end if;
  if auth.uid() is null then return new; end if; -- server (service role)
  if new.avatar_url !~ ('^https://[a-z0-9]+\.supabase\.co/storage/v1/object/public/avatars/' || old.id::text || '/[A-Za-z0-9._-]+(\?[A-Za-z0-9=&._-]*)?$') then
    raise exception 'Upload your picture with the Change photo button.' using errcode = 'P0001';
  end if;
  return new;
end; $$;
drop trigger if exists avatar_guard on public.profiles;
create trigger avatar_guard before update of avatar_url on public.profiles for each row execute function public.avatar_guard();
