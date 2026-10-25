/**
 * Every name and ticker can be launched only once on the Launch Pad (any network, any letter case), so nobody can
 * copy a token that launched here. Server only. The database enforces it too (unique indexes on launches).
 */
import { LOGO_RE } from "@/lib/launchpad";
import { supabaseService } from "@/lib/supabase/server";

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

export async function namesTaken(name: string, symbol: string): Promise<{ name: boolean; symbol: boolean }> {
  const sb = supabaseService();
  const n = norm(name), t = norm(symbol);
  const [{ data: a }, { data: b }] = await Promise.all([
    n ? sb.from("launches").select("name").eq("source", "launchpad").ilike("name", n.replace(/[%_\\\\]/g, "\\\\$&")).limit(5) : Promise.resolve({ data: [] }),
    t ? sb.from("launches").select("symbol").eq("source", "launchpad").ilike("symbol", t.replace(/[%_\\\\]/g, "\\\\$&")).limit(5) : Promise.resolve({ data: [] }),
  ]);
  return {
    name: (a || []).some((r: any) => norm(r.name) === n),
    symbol: (b || []).some((r: any) => norm(r.symbol) === t),
  };
}

export function takenError(t: { name: boolean; symbol: boolean }) {
  return t.name && t.symbol ? "That name and ticker were already launched here. Pick new ones."
    : t.name ? "That name was already launched here. Pick another name."
    : t.symbol ? "That ticker was already launched here. Pick another ticker." : null;
}

/** Saves a token's picture (only one from the member's own folder in the Hub's storage). */
export async function saveLogo(chain: string, token: string, url: unknown, userId: string | null) {
  if (typeof url !== "string" || !LOGO_RE.test(url) || !userId || !url.includes(`/token-logos/${userId}/`)) return;
  await supabaseService().from("token_logos").upsert({ chain, token, url, user_id: userId }, { onConflict: "chain,token" });
}
