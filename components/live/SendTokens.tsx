"use client";
import { useEffect, useState } from "react";
import { createPublicClient, createWalletClient, custom, erc20Abi, formatUnits, getAddress, http, parseUnits } from "viem";
import { pickWallet } from "@/lib/connect";
import { TOKEN_ADDRESS } from "@/lib/groups";
import { WCHAINS } from "@/lib/wallet-chains";
import { txUrl } from "@/lib/explorer";

const c = WCHAINS.bsc;
const pub = createPublicClient({ chain: c.viem, transport: http(c.rpc) }) as any;
type Person = { id: string | null; alias: string; handle: string | null; color?: string; is_team?: boolean; wallet: string; member: boolean };

/**
 * Send tokens during a live session, to a member by name or @handle, or to any wallet address.
 * You sign the transfer in your own wallet; the site never holds funds. Members' wallet addresses stay hidden:
 * you pick the name, and only the transfer in your wallet shows the address.
 */
export default function SendTokens({ sessionId = "", preset }: { sessionId?: string; preset?: { id: string; alias: string; handle: string | null } }) {
  const [q, setQ] = useState(preset?.handle ? `@${preset.handle}` : "");
  const [found, setFound] = useState<Person[]>([]);
  const [to, setTo] = useState<Person | null>(null);
  const [amount, setAmount] = useState("100");
  const [tok, setTok] = useState<{ symbol: string; decimals: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [done, setDone] = useState("");

  useEffect(() => {
    const a = TOKEN_ADDRESS as `0x${string}`;
    Promise.all([pub.readContract({ address: a, abi: erc20Abi, functionName: "symbol" }), pub.readContract({ address: a, abi: erc20Abi, functionName: "decimals" })])
      .then(([s, d]: any) => setTok({ symbol: String(s), decimals: Number(d) })).catch(() => setTok({ symbol: "AUTISTIK", decimals: 18 }));
  }, []);

  useEffect(() => {
    setTo(null); setDone("");
    if (q.trim().length < 2) { setFound([]); return; }
    const t = setTimeout(async () => {
      const r = await fetch(`/api/tip/resolve?${sessionId ? `session=${sessionId}` : "scope=all"}&q=${encodeURIComponent(q.trim())}`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg(d.error || "Couldn't search."); setFound([]); return; }
      setMsg(""); setFound(d.people || []);
      if (preset && d.people?.length === 1) setTo(d.people[0]);
    }, 350);
    return () => clearTimeout(t);
  }, [q, sessionId]);

  async function send() {
    if (!to || !tok) return;
    let value: bigint;
    try { value = parseUnits(amount.trim(), tok.decimals); } catch { setMsg("Enter a number, like 100."); return; }
    if (value <= 0n) { setMsg("Enter an amount above zero."); return; }
    setBusy(true); setMsg("Check your wallet and approve the transfer…"); setDone("");
    try {
      const eth = await pickWallet();
      if (!eth) { setMsg(""); return; }
      const wc = createWalletClient({ chain: c.viem, transport: custom(eth) });
      const [account] = await wc.requestAddresses();
      try { await wc.switchChain({ id: c.viem.id }); } catch {}
      const bal = (await pub.readContract({ address: TOKEN_ADDRESS, abi: erc20Abi, functionName: "balanceOf", args: [account] })) as bigint;
      if (bal < value) { setMsg(`You only have ${Number(formatUnits(bal, tok.decimals)).toLocaleString()} ${tok.symbol} in this wallet.`); return; }
      const hash = await wc.writeContract({ account, address: TOKEN_ADDRESS as `0x${string}`, abi: erc20Abi, functionName: "transfer", args: [getAddress(to.wallet), value] });
      setMsg("Sent. Confirming on-chain…");
      fetch("/api/tip", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ hash, session: sessionId || null }) }).catch(() => {});
      setDone(hash); setMsg(""); setQ(""); setFound([]); setTo(null);
    } catch (e: any) {
      setMsg(e?.shortMessage?.includes("rejected") || /reject|denied/i.test(e?.message || "") ? "You cancelled in your wallet. Nothing was sent." : e?.shortMessage || "The transfer didn't go through.");
    } finally { setBusy(false); }
  }

  return (
    <div className="card stack" style={{ gap: 8 }}>
      <h3>Send {tok?.symbol ? `$${tok.symbol}` : "tokens"}</h3>
      <p className="muted" style={{ fontSize: ".9em" }}>{sessionId ? "Type a name or @handle of someone in this session, or paste a wallet address." : "Type the name or @handle of any AUTISTIK member. Their name always leads to their own wallet, even if they rename themselves."} You approve the transfer in your own wallet.</p>
      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, @handle or 0x… wallet" aria-label="Who to send to" />
      {!to && found.map((p, i) => (
        <button key={(p.id || p.wallet) + i} type="button" className="btn" onClick={() => setTo(p)} style={{ justifyContent: "flex-start", textAlign: "left" }}>
          <b>{p.alias}</b>{p.handle && <span className="muted"> @{p.handle}</span>}{!p.member && <span className="muted"> · wallet address</span>}
        </button>
      ))}
      {!to && q.trim().length >= 2 && !found.length && !msg && <span className="muted" style={{ fontSize: ".88em" }}>{sessionId ? "No one in this session by that name." : "No AUTISTIK member with a wallet by that name."} You can also paste a wallet address.</span>}
      {to && (
        <div className="stack" style={{ gap: 8 }}>
          <div className="notice">To: <b>{to.alias}</b>{to.handle && <> @{to.handle}</>}</div>
          <label className="row" style={{ gap: 8 }}>Amount<input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} style={{ width: 130 }} /> {tok?.symbol}</label>
          <div className="row"><button className="btn primary" type="button" disabled={busy} onClick={send}>Send {amount} {tok?.symbol}</button><button className="btn" type="button" onClick={() => setTo(null)}>Change</button></div>
        </div>
      )}
      {msg && <span className="muted" role="status">{msg}</span>}
      {done && <span className="chip-flag ok" role="status">Sent ✓ <a href={txUrl(c.explorer, done)} target="_blank" rel="noopener noreferrer">View transaction</a></span>}
    </div>
  );
}
