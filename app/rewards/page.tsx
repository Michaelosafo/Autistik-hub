import Link from "next/link";
import WalletLink from "@/components/WalletLink";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Rewards · AUTISTIK Hub" };

export default async function Rewards() {
  const sb = supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  const { data: settings } = await sb.from("app_settings").select("*").eq("id", 1).single();
  const need = settings?.qualify_points ?? 50;
  let me: any = null, board: any[] = [], wallet: string | null = null, rank = 0;
  if (user) {
    const { data } = await sb.from("member_points").select("*").order("points", { ascending: false }).limit(200);
    board = (data || []).filter((r: any) => r.points > 0);
    me = (data || []).find((r: any) => r.user_id === user.id) || { points: 0, posts: 0, sessions: 0, support: 0 };
    rank = board.findIndex((r: any) => r.user_id === user.id) + 1;
    const { data: w } = await sb.from("wallets").select("address").eq("user_id", user.id).maybeSingle();
    wallet = w?.address ?? null;
  }
  const pts = me?.points ?? 0;

  return (
    <div className="stack">
      <div className="page-head">
        <div className="label">Rewards · {settings?.round_name || "Round 1"}</div>
        <h1>Community airdrops</h1>
        <p className="muted">$AUTISTIK airdrops reward taking part, and holding. You never need to share anything about your health to qualify.</p>
      </div>
      {!user ? (
        <div className="joincta" data-g="learn"><div><b>Sign in to earn points</b><p className="muted" style={{ fontSize: ".9em" }}>Points come from posting, saving seats at sessions and getting support from others.</p></div><Link className="btn g" href="/login">Sign in / Join</Link></div>
      ) : (
        <div className="grid2">
          <div className="card stack">
            <h2>Your points</h2>
            <div className="row" style={{ justifyContent: "space-between" }}><span className="stat"><b>{pts}</b><span className="muted">this round</span></span><span className="muted">{rank ? `#${rank} of ${board.length}` : ""}</span></div>
            <div className="meter"><i style={{ width: `${Math.min(100, (pts / need) * 100)}%` }} /></div>
            <p className="muted" style={{ fontSize: ".88em" }}>{pts >= need ? "You qualify for this round's participation pool." : `${need - pts} more points to qualify for the participation pool.`}</p>
            <table><tbody>
              <tr><td>Post in a group channel</td><td className="num">+5 <span className="muted">(max 10 posts / round)</span></td></tr>
              <tr><td>Save a seat at a session</td><td className="num">+10</td></tr>
              <tr><td>Your posts get support from others</td><td className="num">+1 each <span className="muted">(max 50)</span></td></tr>
            </tbody></table>
          </div>
          <WalletLink uid={user.id} initial={wallet} />
        </div>
      )}
      <div className="card stack">
        <h2>How each round works</h2>
        <div className="grid2" style={{ gap: 12 }}>
          <div><h3>Participation pool</h3><p className="muted" style={{ fontSize: ".92em" }}>Members with {need}+ points and a linked wallet share the pool, weighted by points. Points reset each round.</p></div>
          <div><h3>Holder pool</h3><p className="muted" style={{ fontSize: ".92em" }}>A snapshot of $AUTISTIK holders is taken on a date announced in advance on Telegram and X.</p></div>
          <div><h3>Claim it yourself</h3><p className="muted" style={{ fontSize: ".92em" }}>When a round closes, eligible wallets claim their $AUTISTIK here. You only pay a small BNB gas fee.</p></div>
        </div>
        <p className="muted" style={{ fontSize: ".85em" }}>Pool sizes and dates are set by the AUTISTIK team and announced publicly. Points have no cash value and don&apos;t guarantee an airdrop. Nothing here is financial advice.</p>
      </div>
      {user && (
        <div className="card stack">
          <h2>Top contributors</h2>
          <div className="scroll"><table>
            <thead><tr><th>#</th><th>Member</th><th>Posts</th><th>Sessions</th><th>Points</th></tr></thead>
            <tbody>
              {!board.length && <tr><td colSpan={5} className="muted">No points yet this round.</td></tr>}
              {board.slice(0, 10).map((r: any, i: number) => (
                <tr key={r.user_id}><td className="num">{i + 1}</td><td>{r.alias}{r.user_id === user.id ? " (you)" : ""}</td><td className="num">{r.posts}</td><td className="num">{r.sessions}</td><td className="num">{r.points}</td></tr>
              ))}
            </tbody>
          </table></div>
        </div>
      )}
    </div>
  );
}
