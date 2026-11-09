import { supabaseServer } from "@/lib/supabase/server";

/**
 * Where the visitor stands with the admin area. The database decides (supabase/admin-lock.sql):
 * - owner: signed in with the owner's confirmed email, which is on the private owner list
 * - admin: the owner AND has entered their 2-step code this session; every owner-only rule in the database needs this
 * - helper: someone the owner made a helper admin (the owner can remove them any time)
 * - staff: admin, or a helper who has entered their 2-step code: can build and moderate, and use the AI trader,
 *   but not the money tools (fees, airdrops, staking admin, the live trading wallet) or managing admins
 */
export type AdminState = { owner: boolean; admin: boolean; helper: boolean; staff: boolean };
export async function adminState(): Promise<AdminState> {
  const none = { owner: false, admin: false, helper: false, staff: false };
  try {
    const sb = supabaseServer();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return none;
    const [{ data: owner }, { data: admin }, { data: helper }, { data: staff }] = await Promise.all([sb.rpc("is_owner"), sb.rpc("is_admin"), sb.rpc("is_helper"), sb.rpc("is_staff")]);
    const isAdmin = owner === true && admin === true;
    return { owner: owner === true, admin: isAdmin, helper: helper === true, staff: isAdmin || staff === true };
  } catch {
    return none;
  }
}

/**
 * Who can use the Launch Pad (launching and adding liquidity): everyone. Set LAUNCH_PUBLIC=0 in Vercel to put it
 * back in test mode, where only the owner (signed in with the owner's email) can use it and everyone else sees
 * "coming soon".
 */
export async function launchAccess(): Promise<{ public: boolean; allowed: boolean }> {
  if (process.env.LAUNCH_PUBLIC !== "0") return { public: true, allowed: true };
  return { public: false, allowed: (await adminState()).owner };
}
