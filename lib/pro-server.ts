/** Server side of AUTISTIK Pro: who has it, and the price in $AUTISTIK. */
import { supabaseService } from "@/lib/supabase/server";
import { getPairStats } from "@/lib/market";
import { PRO_TOKEN } from "@/lib/pro";

/** When this member's Pro ends (null if they don't have it). Admins always have it. */
export async function proUntil(uid: string | null | undefined): Promise<string | null> {
  if (!uid) return null;
  const sb = supabaseService();
  const [{ data: pass }, { data: prof }] = await Promise.all([
    sb.from("pro_passes").select("ends_at").eq("user_id", uid).gt("ends_at", new Date().toISOString()).order("ends_at", { ascending: false }).limit(1).maybeSingle(),
    sb.from("profiles").select("is_admin").eq("id", uid).maybeSingle(),
  ]);
  if (prof?.is_admin) return "2099-01-01T00:00:00.000Z";
  return pass?.ends_at ?? null;
}
export const isPro = async (uid: string | null | undefined) => !!(await proUntil(uid));

/** The $AUTISTIK price in dollars, from its main pool. */
export async function autistikPriceUsd(): Promise<number | null> {
  const s = await getPairStats("bsc", PRO_TOKEN);
  return s?.priceUsd && s.priceUsd > 0 ? s.priceUsd : null;
}

/** How many token units (18 decimals) make `usd` dollars at `price`. */
export function unitsFor(usd: number, price: number, decimals = 18): bigint {
  // Work in millionths of a token to keep precision without floats on huge numbers.
  const micro = BigInt(Math.ceil((usd / price) * 1e6));
  return (micro * 10n ** BigInt(decimals)) / 1_000_000n;
}

/** Which of these members have Pro right now (admins included). */
export async function proUsersOf(uids: string[]): Promise<string[]> {
  if (!uids.length) return [];
  const sb = supabaseService();
  const [{ data: passes }, { data: admins }] = await Promise.all([
    sb.from("pro_passes").select("user_id").in("user_id", uids).gt("ends_at", new Date().toISOString()),
    sb.from("profiles").select("id").in("id", uids).eq("is_admin", true),
  ]);
  return [...new Set([...(passes || []).map((r: any) => r.user_id), ...(admins || []).map((r: any) => r.id)])];
}
