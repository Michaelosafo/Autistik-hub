-- Members can change their own @handle. The handle_guard trigger still checks it (3-20 letters/digits/_, free,
-- no team words), and the "edit own profile" policy still limits this to your own row.
grant update (handle) on public.profiles to authenticated;
