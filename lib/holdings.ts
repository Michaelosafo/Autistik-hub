import { balances } from "@/lib/wallet-server";
import { WCHAINS } from "@/lib/wallet-chains";
import { supabaseService } from "@/lib/supabase/server";

export type Shown = { symbol: string; name: string; logo: string | null; amount: number; valueUsd: number | null };

/**
 * What a member's linked wallet holds, if the viewer may see it (the member's own choice: only me, followers,
 * everyone, or their private link). The database decides; the address never leaves the server.
 * null = not allowed (or no wallet); [] = allowed but nothing held or the lookup failed.
 */
export async function sharedHoldings(memberId: string, viewerId: string, key?: string | null): Promise<Shown[] | null> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  const { data: addr, error } = await supabaseService().rpc("holdings_wallet", { p_id: memberId, p_viewer: viewerId, p_key: key && /^[0-9a-f]{32}$/.test(key) ? key : null });
  if (error || typeof addr !== "string") return null;
  try {
    const list = await Promise.race([balances(WCHAINS.bsc, addr, []), new Promise<never>((_, no) => setTimeout(() => no(new Error("slow")), 8000))]);
    return list.filter((h) => h.amount > 0)
      .sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0))
      .slice(0, 12)
      .map((h) => ({ symbol: h.symbol, name: h.name, logo: h.logo ?? null, amount: h.amount, valueUsd: h.valueUsd }));
  } catch {
    return [];
  }
}
