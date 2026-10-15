import { supabaseServer } from "@/lib/supabase/server";

/**
 * Where the visitor stands with the admin area. The database decides (supabase/admin-lock.sql):
 * - owner: signed in with the owner's confirmed email, which is on the private owner list
 * - admin: the owner AND has entered their 2-step code this session; every admin rule in the database needs this
 */
export async function adminState(): Promise<{ owner: boolean; admin: boolean }> {
  try {
    const sb = supabaseServer();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return { owner: false, admin: false };
    const [{ data: owner }, { data: admin }] = await Promise.all([sb.rpc("is_owner"), sb.rpc("is_admin")]);
    return { owner: owner === true, admin: owner === true && admin === true };
  } catch {
    return { owner: false, admin: false };
  }
}
