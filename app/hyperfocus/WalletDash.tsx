"use client";
import { fmtAmount } from "@/lib/num-format";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import WalletLoader from "@/components/wallet/WalletLoader";
import SendTokens from "@/components/live/SendTokens";
import { getState, pickWallet, subscribe } from "@/lib/connect";

const OrdersAdmin = dynamic(() => import("@/components/wallet/OrdersAdmin"), { ssr: false });

type Member = { evm?: string | null; sol?: string | null } | null;
type Holding = { chain: string; chainName: string; address: string; symbol: string; name: string; logo: string | null; amount: number; valueUsd: number | null; native: boolean; raced: boolean };
type Rewards = { signedIn: boolean; points: number; need: number; rank: number };

const usd = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const amt = (n: number) => (n >= 1e9 ? (n / 1e9).toFixed(2) + "B" : n >= 1e6 ? (n / 1e6).toFixed(2) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "k" : n >= 1 ? n.toFixed(2) : fmtAmount(n));
const short = (a: string) => (a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);
const showTab = (t: string) => { try { history.replaceState(null, "", "#" + t); } catch {} (window as any).HFShowTab?.(t); };

/**
 * The Wallet tab of Hyperfocus: a dashboard of everything the member holds (every connected wallet, every network),
 * their rewards, shortcuts to the rest of the hub, and the full AUTISTIK wallet (send, receive, trade, orders) below it.
 * It sits just under the page's tabs and shows only while the Wallet tab is open.
 */
export default function WalletDash({ appId, member, start, admin, rewards, feeNote }: {
  appId: string | null; member: Member; start: any; admin: boolean; rewards: Rewards; feeNote: string;
}) {
  const [tab, setTab] = useState<string>("wallet");
  const conn = useSyncExternalStore(subscribe, getState, getState);
  const [evm, setEvm] = useState("");
  const [list, setList] = useState<Holding[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [recv, setRecv] = useState(false);

  // Follow the page's tabs; hide the plain wallet card the game page shows when this dashboard isn't there.
  useEffect(() => {
    const on = (e: any) => setTab(String(e.detail || "wallet"));
    window.addEventListener("hf-tab", on);
    setTab((window as any).HFTab || "wallet");
    document.getElementById("tab-wallet")?.classList.add("dashed");
    return () => window.removeEventListener("hf-tab", on);
  }, []);

  useEffect(() => {
    const prov: any = conn.current?.provider;
    if (!prov) { setEvm(""); return; }
    prov.request({ method: "eth_accounts" }).then((a: string[]) => setEvm(a?.[0] || "")).catch(() => setEvm(""));
  }, [conn.current]);

  const sol = String((conn.sol?.account as any)?.address || "");
  const addrs = useMemo(() => [...new Set([evm, sol, member?.evm || "", member?.sol || ""].filter(Boolean).map((a) => (a.startsWith("0x") ? a.toLowerCase() : a)))], [evm, sol, member?.evm, member?.sol]);

  useEffect(() => {
    if (!addrs.length) { setList(null); return; }
    let live = true;
    setBusy(true);
    Promise.all(addrs.map((a) => fetch("/api/hyperfocus/lookup?q=" + encodeURIComponent(a)).then((r) => r.json()).catch(() => null)))
      .then((rs) => {
        if (!live) return;
        const all: Holding[] = [];
        rs.forEach((d: any) => { if (d?.kind === "wallet") all.push(...d.holdings); });
        setList(all.sort((a, b) => (b.valueUsd ?? -1) - (a.valueUsd ?? -1)));
      })
      .finally(() => live && setBusy(false));
    return () => { live = false; };
  }, [addrs.join("|")]);

  if (tab !== "wallet") return null;
  const total = (list || []).reduce((s, h) => s + (h.valueUsd || 0), 0);
  const natives = (list || []).filter((h) => h.native);
  const coins = (list || []).filter((h) => !h.native).slice(0, 8);
  const chains = new Set((list || []).map((h) => h.chainName)).size;
  const pct = rewards.need ? Math.min(100, Math.round((rewards.points / rewards.need) * 100)) : 0;

  const tiles: { label: string; note: string; href?: string; tab?: string; play?: boolean }[] = [
    { label: "Scanner", note: "Any wallet or token: holders, 100x club, sellers", tab: "scanner" },
    { label: "Race", note: "Race every holder of a coin in 3D", tab: "race" },
    { label: "Win $AUTISTIK", note: "$0.50 entry, top 5 split the pot", play: true },
    { label: "Offline swap", note: "Swap face to face, no internet", tab: "swap" },
    { label: "Swap", note: "Best price on any network", href: "/swap" },
    { label: "Watchlist", note: "Coins you follow", href: "/analytics/pins" },
    { label: "Token scanner", note: "Deep safety and whale checks", href: "/analytics" },
    { label: "Stake", note: "Earn BNB from fees", href: "/stake" },
    { label: "Susu", note: "Save every day, get it all at the end", href: "/susu" },
    { label: "Lockers", note: "Lock liquidity or team tokens", href: "/lockers" },
    { label: "Launchpad", note: "Launch your own coin", href: "/launchpad" },
    { label: "Pro", note: "Signals, whale radar, reports", href: "/pro" },
  ];

  return (
    <div className="hfd stack">
      <style>{CSS}</style>
      <section className="hfd-hero card">
        <div className="hfd-total">
          <small>Your wallet</small>
          <b>{list ? usd(total) : addrs.length ? "Loading…" : "$0.00"}</b>
          <span>{addrs.length ? `${addrs.map(short).join(" · ")}${list ? ` · ${list.length} coin${list.length === 1 ? "" : "s"} on ${chains} network${chains === 1 ? "" : "s"}` : ""}` : "Connect a wallet to see everything you hold."}</span>
        </div>
        <div className="hfd-acts">
          {!addrs.length && <button className="btn primary" onClick={() => pickWallet({ fresh: true })}>Connect a wallet</button>}
          <a className="btn primary" href="#hfd-wallet">Send</a>
          <button className="btn" onClick={() => setRecv(true)}>Receive</button>
          <Link className="btn" href="/swap">Swap</Link>
          <button className="btn" onClick={() => document.getElementById("bPlayTop")?.click()}>Play</button>
        </div>
        {natives.length > 0 && (
          <div className="hfd-chips">
            {natives.map((h) => (
              <span key={h.chain + h.address} className="hfd-chip"><b>{h.symbol}</b> {amt(h.amount)}<small>{h.valueUsd != null ? usd(h.valueUsd) : ""} · {h.chainName}</small></span>
            ))}
          </div>
        )}
        {busy && <p className="hfd-muted">Updating balances…</p>}
      </section>

      {recv && <Receive evm={evm || member?.evm || ""} sol={sol || member?.sol || ""} onClose={() => setRecv(false)} />}

      {/* Race a friend: the game fills this with its invite card (copy link, see who joined, start) */}
      <div id="hfInviteMount" className="hf hfd-invite" />

      <div className="hfd-grid">
        <section className="card">
          <h3 className="hfd-h">Your coins</h3>
          {coins.length ? (
            <ul className="hfd-coins">
              {coins.map((h) => (
                <li key={h.chain + h.address}>
                  {h.logo ? <img src={h.logo} alt="" /> : <i />}
                  <span className="hfd-c"><b>{h.symbol}</b><small>{h.chainName}{h.raced ? " · racing" : ""}</small></span>
                  <span className="hfd-v"><b>{h.valueUsd != null ? usd(h.valueUsd) : "—"}</b><small>{amt(h.amount)}</small></span>
                  {["bsc", "ethereum", "base", "solana"].includes(h.chain) && (
                    <a className="hfd-race" href={`/hyperfocus?chain=${h.chain}&ca=${encodeURIComponent(h.address)}#race`}>Race</a>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="hfd-muted">{addrs.length ? (list ? "Only the network coins above, or tiny balances." : "Loading…") : "Your coins show here once a wallet is connected."}</p>
          )}
        </section>

        <section className="card hfd-rew">
          <h3 className="hfd-h">Rewards</h3>
          {rewards.signedIn ? (
            <>
              <div className="hfd-pts"><b>{rewards.points}</b><small>points · {rewards.need} to qualify for the $AUTISTIK airdrop{rewards.rank ? ` · rank #${rewards.rank}` : ""}</small></div>
              <div className="hfd-bar"><span style={{ width: pct + "%" }} /></div>
              <Link className="btn" href="/rewards">Open rewards</Link>
            </>
          ) : (
            <>
              <p className="hfd-muted">Take part in the community to earn points and share each $AUTISTIK airdrop.</p>
              <Link className="btn" href="/login?next=/hyperfocus">Sign in to track your points</Link>
            </>
          )}
        </section>
      </div>

      <section className="hfd-tiles">
        {tiles.map((t) => t.href ? (
          <Link key={t.label} href={t.href} className="hfd-tile"><b>{t.label}</b><small>{t.note}</small></Link>
        ) : (
          <button key={t.label} className="hfd-tile" onClick={() => (t.play ? document.getElementById("bPlayTop")?.click() : showTab(t.tab!))}><b>{t.label}</b><small>{t.note}</small></button>
        ))}
      </section>

      <details className="card" style={{ padding: "10px 14px" }}>
        <summary style={{ cursor: "pointer", fontWeight: 700 }}>Send $AUTISTIK to a member by name</summary>
        <div style={{ marginTop: 10 }}><SendTokens /></div>
      </details>
      <div id="hfd-wallet"><WalletLoader appId={appId} member={member as any} start={start} /></div>
      {admin && <OrdersAdmin />}
      <p className="muted" style={{ fontSize: ".82em" }}>{feeNote}</p>
    </div>
  );
}

const NETS = [
  { id: "bsc", name: "BNB Chain", kind: "evm", tokens: "BNB and BEP-20 tokens like $AUTISTIK", color: "#F0B90B" },
  { id: "ethereum", name: "Ethereum", kind: "evm", tokens: "ETH and ERC-20 tokens", color: "#627EEA" },
  { id: "base", name: "Base", kind: "evm", tokens: "ETH on Base and Base tokens", color: "#2F6BFF" },
  { id: "solana", name: "Solana", kind: "sol", tokens: "SOL and SPL tokens", color: "#9945FF" },
] as const;

/** Receive: pick a network, show its address as a QR code with copy and share. */
function Receive({ evm, sol, onClose }: { evm: string; sol: string; onClose: () => void }) {
  const [net, setNet] = useState<(typeof NETS)[number]["id"]>(evm ? "bsc" : sol ? "solana" : "bsc");
  const [qr, setQr] = useState("");
  const [copied, setCopied] = useState(false);
  const n = NETS.find((x) => x.id === net)!;
  const address = n.kind === "sol" ? sol : evm;

  useEffect(() => {
    setQr(""); setCopied(false);
    if (!address) return;
    import("qrcode").then((m) => m.toDataURL(address, { margin: 1, width: 240, color: { dark: "#14151a", light: "#ffffff" } })).then(setQr).catch(() => setQr(""));
  }, [address]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  const copy = async () => {
    try { await navigator.clipboard.writeText(address); setCopied(true); setTimeout(() => setCopied(false), 1600); }
    catch { const el = document.getElementById("hfr-addr"); if (el) { const r = document.createRange(); r.selectNodeContents(el); const sel = getSelection(); sel?.removeAllRanges(); sel?.addRange(r); } }
  };
  const share = async () => { try { await (navigator as any).share({ title: `My ${n.name} address`, text: address }); } catch {} };

  return (
    <div className="hfr-bg" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="hfr card" role="dialog" aria-modal="true" aria-labelledby="hfr-title">
        <div className="hfr-top">
          <div><small>Receive</small><h3 id="hfr-title">Your {n.name} address</h3></div>
          <button className="hfr-x" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="hfr-nets" role="radiogroup" aria-label="Network">
          {NETS.map((x) => (
            <button key={x.id} role="radio" aria-checked={net === x.id} onClick={() => setNet(x.id)} style={{ ["--nc" as any]: x.color }}>
              <i aria-hidden="true" />{x.name}
            </button>
          ))}
        </div>
        {address ? (
          <>
            <div className="hfr-qr">{qr ? <img src={qr} alt={`QR code for your ${n.name} address`} width={240} height={240} /> : <span>Making QR code…</span>}</div>
            <div className="hfr-addr"><code id="hfr-addr">{address}</code></div>
            <div className="hfr-acts">
              <button className="btn primary" onClick={copy}>{copied ? "Copied ✓" : "Copy address"}</button>
              {typeof navigator !== "undefined" && (navigator as any).share && <button className="btn" onClick={share}>Share</button>}
            </div>
            <p className="hfr-warn" style={{ ["--nc" as any]: n.color }}>Only send <b>{n.tokens}</b> on <b>{n.name}</b> to this address. Coins sent on another network can be lost.</p>
          </>
        ) : (
          <div className="hfr-empty">
            <p>Connect a {n.kind === "sol" ? "Solana" : "BNB Chain, Ethereum or Base"} wallet to see your address here.</p>
            <button className="btn primary" onClick={() => { onClose(); pickWallet({ fresh: true }); }}>Connect a wallet</button>
          </div>
        )}
      </div>
    </div>
  );
}

const CSS = `
.hfr-bg{position:fixed;inset:0;z-index:400;display:grid;place-items:center;padding:16px;background:rgba(10,8,20,.55);backdrop-filter:blur(6px)}
.hfr{width:min(420px,100%);max-height:calc(100dvh - 32px);overflow:auto;display:flex;flex-direction:column;gap:14px;padding:20px !important;border-radius:24px;box-shadow:0 30px 70px -20px rgba(0,0,0,.5)}
.hfr-top{display:flex;justify-content:space-between;align-items:flex-start;gap:10px}
.hfr-top small{display:block;font-size:.72em;font-weight:800;letter-spacing:.14em;text-transform:uppercase;opacity:.65}
.hfr-top h3{margin:2px 0 0;font-size:1.15em}
.hfr-x{border:0;background:color-mix(in srgb,currentColor 8%,transparent);color:inherit;width:34px;height:34px;border-radius:50%;cursor:pointer;font-size:1rem}
.hfr-nets{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}
.hfr-nets button{display:flex;align-items:center;gap:8px;padding:9px 10px;border-radius:12px;border:1.5px solid color-mix(in srgb,currentColor 14%,transparent);background:none;color:inherit;font:inherit;font-weight:700;font-size:.88em;cursor:pointer;text-align:left}
.hfr-nets button i{width:10px;height:10px;border-radius:50%;background:var(--nc);flex:none}
.hfr-nets button[aria-checked=true]{border-color:var(--nc);background:color-mix(in srgb,var(--nc) 14%,transparent)}
.hfr-nets button:focus-visible,.hfr-x:focus-visible{outline:2px solid #ffb300;outline-offset:2px}
.hfr-qr{align-self:center;display:grid;place-items:center;width:264px;max-width:100%;aspect-ratio:1;padding:12px;border-radius:20px;background:#fff;color:#14151a;box-shadow:0 0 0 1px color-mix(in srgb,currentColor 10%,transparent)}
.hfr-qr img{display:block;width:100%;height:auto}
.hfr-addr{padding:10px 12px;border-radius:12px;background:color-mix(in srgb,currentColor 6%,transparent);text-align:center}
.hfr-addr code{font-size:.86em;word-break:break-all;line-height:1.45}
.hfr-acts{display:flex;gap:8px}.hfr-acts .btn{flex:1;justify-content:center}
.hfr-warn{margin:0;padding:10px 12px;border-radius:12px;font-size:.84em;line-height:1.45;border-left:4px solid var(--nc);background:color-mix(in srgb,var(--nc) 10%,transparent)}
.hfr-empty{display:flex;flex-direction:column;gap:10px;align-items:flex-start}
.hfr-empty p{margin:0;opacity:.8}
.hfd{max-width:1320px;margin:0 auto 18px}
.hfd .card{padding:16px}
.hfd-hero{display:flex;flex-wrap:wrap;gap:14px;align-items:flex-end;justify-content:space-between;background:linear-gradient(135deg,color-mix(in srgb,#ffb300 16%,transparent),transparent 60%)}
.hfd-total small{display:block;font-size:.8em;opacity:.75;text-transform:uppercase;letter-spacing:.08em}
.hfd-total b{display:block;font-size:clamp(28px,6vw,44px);line-height:1.1}
.hfd-total span{font-size:.85em;opacity:.8;word-break:break-all}
.hfd-acts{display:flex;flex-wrap:wrap;gap:8px}
.hfd-chips{flex-basis:100%;display:flex;flex-wrap:wrap;gap:8px}
.hfd-chip{border:1px solid color-mix(in srgb,currentColor 18%,transparent);border-radius:12px;padding:6px 10px;font-size:.9em}
.hfd-chip small{display:block;opacity:.7;font-size:.8em}
.hfd-muted{opacity:.75;font-size:.9em;margin:6px 0 0}
.hfd-grid{display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr);gap:12px}
@media (max-width:760px){.hfd-grid{grid-template-columns:1fr}}
.hfd-h{margin:0 0 8px;font-size:1em}
.hfd-coins{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
.hfd-coins li{display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid color-mix(in srgb,currentColor 10%,transparent)}
.hfd-coins img,.hfd-coins i{width:26px;height:26px;border-radius:50%;flex:none;background:color-mix(in srgb,currentColor 12%,transparent)}
.hfd-c{flex:1;min-width:0}.hfd-c small,.hfd-v small{display:block;opacity:.7;font-size:.8em}
.hfd-v{text-align:right}
.hfd-race{font-size:.8em;font-weight:700;padding:4px 10px;border-radius:999px;border:1px solid currentColor;text-decoration:none}
.hfd-pts b{font-size:32px;display:block;line-height:1}
.hfd-pts small{opacity:.75;font-size:.85em}
.hfd-bar{height:8px;border-radius:4px;background:color-mix(in srgb,currentColor 12%,transparent);margin:10px 0;overflow:hidden}
.hfd-bar span{display:block;height:100%;background:#ffb300}
.hfd-invite.hf{padding:0;background:transparent}
.hfd-tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
.hfd-tile{display:flex;flex-direction:column;gap:3px;text-align:left;padding:12px;border-radius:14px;border:1px solid color-mix(in srgb,currentColor 14%,transparent);background:none;color:inherit;text-decoration:none;cursor:pointer;font:inherit}
.hfd-tile b{font-size:.98em}.hfd-tile small{opacity:.72;font-size:.8em;line-height:1.3}
.hfd-tile:hover{border-color:#ffb300}
`;
