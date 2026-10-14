import Launchpad, { type LaunchRow } from "@/components/Launchpad";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Launch Pad · AUTISTIK Hub" };

export default async function LaunchpadPage() {
  const sb = supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  const { data } = await sb.from("launches").select("chain,token,pair,name,symbol,created_at").order("created_at", { ascending: false }).limit(20);
  return (
    <div className="stack">
      <div className="page-head">
        <div className="label">AUTISTIK Launch Pad</div>
        <h1>Launch your own token</h1>
        <p className="muted">Tell Autistik about your token and sign one transaction. It goes live on PancakeSwap, Uniswap or Robinhood Chain with its liquidity locked forever, then shows up on DexScreener.</p>
      </div>
      <Launchpad signedIn={!!user} recent={(data as LaunchRow[]) || []} />
    </div>
  );
}
