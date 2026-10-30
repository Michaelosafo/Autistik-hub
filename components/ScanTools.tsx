"use client";
import RecentDevs from "@/components/RecentDevs";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import AnalyticsScan from "@/components/AnalyticsScan";

const ICONS: Record<string, JSX.Element> = {
  token: <><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></>,
  dev: <><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" /></>,
  arena: <><circle cx="12" cy="12" r="9" /><path d="M12 7l3 2-1 4h-4l-1-4zM12 3v4M21 12h-4M3 12h4M12 21v-4" /></>,
  hot: <path d="M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 1-9z" />,
  pins: <path d="M12 21s-7-6-7-11a7 7 0 0 1 14 0c0 5-7 11-7 11zM12 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4z" />,
};
const TOOLS = [
  { k: "token", name: "Token scan", blurb: "Safety, holders, buy or sell read" },
  { k: "dev", name: "Dev wallet", blurb: "Past tokens, bonded, chance to do well" },
  { k: "arena", name: "Game arena", blurb: "Holders on a pitch", href: "/arena" },
  { k: "hot", name: "Hot coins", blurb: "Momentum right now", href: "/momentum" },
  { k: "pins", name: "My pins", blurb: "Your alerts", href: "/analytics/pins" },
] as const;

const EVM_NETS = [{ k: "bsc", n: "BNB Chain" }, { k: "ethereum", n: "Ethereum" }, { k: "base", n: "Base" }, { k: "arbitrum", n: "Arbitrum" }, { k: "polygon", n: "Polygon" }];

/** The scanner's tools as buttons at the top: pick one, paste an address, see the overview. */
export default function ScanTools({ signedIn }: { signedIn: boolean }) {
  const [tool, setTool] = useState<"token" | "dev">("token");
  return (
    <div className="stack" style={{ gap: 12 }}>
      <nav className="scan-tools" aria-label="Scanner tools">
        {TOOLS.map((t) => {
          const inner = <><i aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{ICONS[t.k]}</svg></i><span><b>{t.name}</b><small>{t.blurb}</small></span></>;
          return "href" in t
            ? <Link key={t.k} href={t.href}>{inner}</Link>
            : <button key={t.k} type="button" aria-pressed={tool === t.k} onClick={() => setTool(t.k)}>{inner}</button>;
        })}
      </nav>
      {tool === "token" ? <AnalyticsScan signedIn={signedIn} /> : <DevScan />}
    </div>
  );
}

function DevScan() {
  const router = useRouter();
  const [wallet, setWallet] = useState("");
  const [net, setNet] = useState("bsc");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const sol = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet.trim());
  function go(e: React.FormEvent) {
    e.preventDefault();
    const w = wallet.trim();
    if (!sol && !/^0x[0-9a-fA-F]{40}$/.test(w)) { setErr("Paste a wallet address (0x… or a Solana address)."); return; }
    setBusy(true); setErr("");
    router.push(`/analytics/dev/${sol ? "solana" : net}/${w}`);
  }
  return (
    <form className="scan-form pro" onSubmit={go}>
      <div className="net-pills" role="radiogroup" aria-label="Network">
        {sol ? <span className="net-pill on">Solana</span> : EVM_NETS.map((n) => <button key={n.k} type="button" role="radio" aria-checked={net === n.k} className={"net-pill" + (net === n.k ? " on" : "")} onClick={() => setNet(n.k)}>{n.n}</button>)}
      </div>
      <div className="scan-row">
        <input value={wallet} onChange={(e) => setWallet(e.target.value)} placeholder="Paste a dev wallet address" aria-label="Dev wallet address" spellCheck={false} autoComplete="off" />
        <button className="btn primary" type="submit" disabled={busy || !wallet.trim()}>{busy ? "Checking their history…" : "Check dev"}</button>
      </div>
      {err && <p className="scan-err" role="alert">{err}</p>}
      <RecentDevs names={{ ...Object.fromEntries(EVM_NETS.map((n) => [n.k, n.n])), solana: "Solana" }} />
    </form>
  );
}
