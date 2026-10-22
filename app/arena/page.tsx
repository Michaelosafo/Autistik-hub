import Link from "next/link";
import TokenLogo from "@/components/TokenLogo";
import AnalyticsScan from "@/components/AnalyticsScan";
import Player from "@/components/arena/Player";
import { ACHAINS, isAChain } from "@/lib/analytics";
import { TOKEN_ADDRESS } from "@/lib/groups";
import { currentUser, supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Game arena · AUTISTIK Hub", description: "Every holder of a token as a player on one pitch: watch who holds and who sells, and join the match." };

const short = (a: string) => a.slice(0, 6) + "…" + a.slice(-4);
const match = (chain: string, token: string) => `/analytics/${chain}/${token}?view=chess`;
// A few made-up players for the banner.
const CAST = [
  { w: "0xdiamond01", kit: "#12A66A", mood: "chill" as const }, { w: "0xpaperhands", kit: "#E5482F", mood: "paper" as const },
  { w: "0xsweaty77", kit: "#12A66A", mood: "ready" as const }, { w: "0xmoonboi9", kit: "#12A66A", mood: "chill" as const },
  { w: "0xjeet4242", kit: "#E5482F", mood: "paper" as const },
];

/** The game arena lobby: scan any token to open its match, or pick one you've scanned or pinned. */
export default async function ArenaLobby() {
  const user = await currentUser();
  const sb = supabaseServer();
  // Only this member's own searches and pins, like the scanner.
  const [{ data: recent }, { data: pins }] = await Promise.all([
    user ? sb.from("launch_watchers").select("chain,token,created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(6) : Promise.resolve({ data: [] as any[] }),
    user ? sb.from("token_pins").select("chain,token").eq("user_id", user.id).order("created_at", { ascending: false }).limit(6) : Promise.resolve({ data: [] as any[] }),
  ]);
  const mine = [...(pins || []), ...(recent || [])].filter((x: any, i, a) => isAChain(x.chain) && a.findIndex((y: any) => y.chain === x.chain && y.token === x.token) === i).slice(0, 8);
  const { data: info } = mine.length ? await sb.from("tracked_tokens").select("chain,token,name,symbol,image_url").in("token", mine.map((m: any) => m.token)) : { data: [] as any[] };
  const tokenOf = (chain: string, token: string) => (info || []).find((t: any) => t.chain === chain && t.token === token) || ({} as any);

  return (
    <div className="stack" style={{ maxWidth: 1020 }}>
      <section className="ga-hero">
        <div className="ga-cast" aria-hidden="true">
          <svg viewBox="-60 -125 600 135">
            {CAST.map((c, i) => <g key={c.w} transform={`translate(${i * 120} 0)`} className={"pl " + c.mood} style={{ ["--dl" as any]: `${i * 0.3}s`, opacity: c.mood === "paper" ? 0.6 : 1 }}><g className="pl-move"><Player wallet={c.w} kit={c.kit} trim={c.mood === "paper" ? "#FFE9A8" : "#fff"} number={i + 1} mood={c.mood} /></g></g>)}
          </svg>
        </div>
        <div className="ga-kicker">AUTISTIK · GAME ARENA</div>
        <h1>💎 Diamond Hands vs Paper Hands 🧻</h1>
        <p>Every holder of a token is a player on one pitch. Holders who look ready to sell start sweating, sellers fade out, and anyone who sells everything vanishes. Scan a token to kick off, then join the match from your wallet.</p>
        <AnalyticsScan signedIn={!!user} label="Scan & play" view="chess" />
      </section>

      <div className="ga-grid">
        <Link href={match("bsc", TOKEN_ADDRESS)} className="ga-match featured">
          <span className="ga-ball" aria-hidden="true">⚽</span>
          <span className="grow"><small>Featured match</small><b>$AUTISTIK</b><span>BNB Chain · every holder on the pitch</span></span>
          <span className="ga-go">Watch →</span>
        </Link>
        <Link href="/wallet" className="ga-match">
          <span className="ga-ball" aria-hidden="true">🎮</span>
          <span className="grow"><small>Your wallet</small><b>Player wallet</b><span>Buy, sell and send from the same place</span></span>
          <span className="ga-go">Open →</span>
        </Link>
      </div>

      <section className="card stack">
        <div className="row" style={{ justifyContent: "space-between" }}><h2>Your matches</h2><Link className="btn small" href="/analytics">Token scanner →</Link></div>
        {!mine.length && <div className="empty">{user ? "Scan a token above. Tokens you scan or pin show up here as matches." : "Sign in to scan tokens. Your matches show up here."}</div>}
        <div className="an-list cols">
          {mine.map((m: any) => {
            const t = tokenOf(m.chain, m.token);
            return (
              <Link key={m.chain + m.token} href={match(m.chain, m.token)} className="an-item">
                <TokenLogo src={t.image_url} symbol={t.symbol || "?"} />
                <span className="grow"><b>{t.symbol || short(m.token)}</b><small>{t.name || short(m.token)}</small></span>
                <span className="net-tag">{ACHAINS[m.chain as keyof typeof ACHAINS].name}</span>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="ga-how">
        <div><b>1</b><span><strong>Scan</strong> any token address. We find its network for you.</span></div>
        <div><b>2</b><span><strong>Watch</strong> the match: green kits hold, red kits sold some, a 💨 puff means someone sold everything.</span></div>
        <div><b>3</b><span><strong>Join</strong> with the gold button: pick an amount and buy in your wallet. Your player runs on within a minute.</span></div>
      </section>
      <p className="muted" style={{ fontSize: ".8em" }}>Data straight from the blockchain. Faces are random cartoons made from each wallet address. Nothing here is financial advice.</p>
    </div>
  );
}
