"use client";
/**
 * Admin: the AUTISTIK Chain control room (owner only). Live status, blocks, the activity feed (every game, purchase,
 * post, tip… recorded on-chain), token & treasury (mint, send, the AUTISTIK Fund), validators, and the bridge (next).
 */
import Link from "next/link";
import { useEffect, useState } from "react";

const UNIT = 1e9;
const atk = (u?: number | null) => (u == null ? "–" : (u / UNIT).toLocaleString("en-US", { maximumFractionDigits: 4 }));
const ago = (ms: number) => { const s = (Date.now() - ms) / 1000; return s < 60 ? `${Math.max(0, Math.round(s))}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : `${Math.floor(s / 3600)}h ago`; };
const short = (s?: string) => (s ? `${s.slice(0, 9)}…${s.slice(-4)}` : "–");
const KIND: Record<string, string> = { game: "🎮", buy: "🛍️", sell: "💸", post: "💬", tip: "💝", stake: "🔒", reward: "🏆", donate: "🤝", other: "✨", transfer: "➡️", mint: "🪙", burn: "🔥", name: "🏷️", validator: "🛡️", owner: "👑" };

type Status = { chain_id: string; height: number; working_on: number; round: number; last_time: number; last_txs: number; supply: number; max_supply: number; validators: number; total_power: number; mempool: number; peers: number; owner: string; fund: string; fund_balance: number | null; min_fee: number; uptime_s: number; owner_key: boolean; owner_matches: boolean | null; setup?: boolean };
type Act = { height: number; time: number; hash: string; type: string; kind?: string; from: string; to?: string; amount?: number; fee: number; data?: string };

async function api(path: string, body?: unknown) {
  const r = await fetch(`/api/chain/${path}`, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "Something went wrong.");
  return j;
}

type Tab = "overview" | "activity" | "treasury" | "validators" | "bridge";

export default function ChainAdmin() {
  const [tab, setTab] = useState<Tab>("overview");
  const [st, setSt] = useState<Status | null>(null);
  const [err, setErr] = useState("");
  const [blocks, setBlocks] = useState<any[]>([]);
  const [acts, setActs] = useState<Act[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [filter, setFilter] = useState("");
  const [vals, setVals] = useState<{ pubkey: string; power: number; address: string }[]>([]);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState("");

  const load = async () => {
    try {
      const s = await api("status");
      setSt(s); setErr("");
      if (s.setup) return;
      const [b, a, v] = await Promise.all([api("blocks?limit=12"), api(`activity?limit=60${filter ? `&kind=${filter}` : ""}`), api("validators")]);
      setBlocks(b.blocks || []); setActs(a.activity || []); setCounts(a.counts || {}); setVals(v.validators || []);
    } catch (e) { setErr((e as Error).message); }
  };
  useEffect(() => { load(); const t = setInterval(load, 3000); return () => clearInterval(t); }, [filter]);

  const act = async (name: string, path: string, body: unknown, done: string) => {
    setBusy(name); setMsg("");
    try { const r = await api(path, body); setMsg(`${done} Transaction ${short(r.hash)} — final in about a second.`); setTimeout(load, 1500); }
    catch (e) { setMsg((e as Error).message); }
    setBusy("");
  };

  if (st?.setup) return <Setup ownerKey={st as any} />;

  return (
    <div className="stack chain">
      <div className="page-head chain-hero">
        <Link href="/admin" className="muted">← Admin</Link>
        <h1>⛓️ AUTISTIK Chain</h1>
        <p className="muted">Your own blockchain: instant finality, every action on AUTISTIK recorded in the open, and half of every fee going to the AUTISTIK Fund. Only you can see this page.</p>
      </div>
      {err && <div className="card chain-err"><b>Can&apos;t reach the chain.</b> <small>{err}</small></div>}

      <nav className="chain-tabs" role="tablist">
        {([["overview", "📊 Overview"], ["activity", "⚡ Activity"], ["treasury", "🪙 Token & treasury"], ["validators", "🛡️ Validators"], ["bridge", "🌉 Bridge"]] as [Tab, string][]).map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>
        ))}
      </nav>
      {msg && <div className="card chain-msg" role="status">{msg}</div>}

      {tab === "overview" && st && (
        <>
          <section className="chain-stats">
            <div><small>Block height</small><b>{st.height.toLocaleString()}</b><em>{st.last_time ? ago(st.last_time) : "–"}</em></div>
            <div><small>Status</small><b className={Date.now() - st.last_time < 15000 ? "up" : "down"}>{Date.now() - st.last_time < 15000 ? "● Live" : "● Stalled"}</b><em>round {st.round} · {st.mempool} waiting</em></div>
            <div><small>Validators</small><b>{st.validators}</b><em>needs &gt;2/3 of {st.total_power} power to agree</em></div>
            <div><small>Supply</small><b>{atk(st.supply)} ATK</b><em>cap {st.max_supply ? atk(st.max_supply) : "none"}</em></div>
            <div><small>AUTISTIK Fund</small><b>{atk(st.fund_balance)} ATK</b><em>half of every fee</em></div>
            <div><small>Network</small><b>{st.chain_id}</b><em>{st.peers} peers · up {Math.round(st.uptime_s / 3600)}h</em></div>
          </section>
          {!st.owner_key && <div className="card chain-warn"><b>Owner key not set.</b> <small>Add CHAIN_OWNER_KEY in Vercel to mint and manage validators from here.</small></div>}
          {st.owner_key && st.owner_matches === false && <div className="card chain-err"><b>CHAIN_OWNER_KEY isn&apos;t the chain&apos;s owner.</b> <small>Owner on chain: {st.owner}</small></div>}
          <section className="card stack">
            <b>Latest blocks</b>
            <ul className="chain-blocks">
              {blocks.map((b) => (
                <li key={b.height}><b>#{b.height}</b><span className="mono">{short(b.hash)}</span><span>{b.txs} tx</span><span className="muted">{b.signers} signed · round {b.round}</span><span className="muted">{ago(b.time)}</span></li>
              ))}
            </ul>
          </section>
        </>
      )}

      {tab === "activity" && (
        <section className="card stack">
          <div className="chain-filter">
            <button type="button" className={!filter ? "on" : ""} onClick={() => setFilter("")}>All</button>
            {["game", "buy", "sell", "post", "tip", "stake", "reward", "donate"].map((k) => <button key={k} type="button" className={filter === k ? "on" : ""} onClick={() => setFilter(k)}>{KIND[k]} {k} {counts[k] ? <em>{counts[k]}</em> : null}</button>)}
          </div>
          {!acts.length ? <small className="muted">Nothing yet. Every game, purchase, post and tip recorded on the chain shows here, live.</small> : (
            <ul className="chain-acts">
              {acts.map((a) => (
                <li key={a.hash}>
                  <span className="chain-ico" aria-hidden="true">{KIND[a.kind || a.type] || "•"}</span>
                  <span className="grow"><b>{a.kind || a.type}</b>{a.data && <> · {a.data}</>}<br /><small className="muted mono">{short(a.from)}{a.to ? ` → ${short(a.to)}` : ""} · block #{a.height} · {ago(a.time)}</small></span>
                  {a.amount ? <b>{atk(a.amount)} ATK</b> : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === "treasury" && st && <Treasury st={st} busy={busy} act={act} />}
      {tab === "validators" && <Validators vals={vals} total={st?.total_power || 0} busy={busy} act={act} />}
      {tab === "bridge" && (
        <section className="card stack">
          <b>🌉 Bridge (next step)</b>
          <p className="muted" style={{ margin: 0 }}>A bridge lets $AUTISTIK move between BNB Chain / Solana and the AUTISTIK Chain. Bridges are where most crypto hacks happen, so this one will be built as its own step: lock contracts on BNB and Solana, a group of independent signers (not one key), daily limits, and an outside security audit before any real money goes through it.</p>
          <ul className="muted" style={{ margin: 0 }}>
            <li>Lock on BNB / Solana → mint the same amount here (and burn here → release there)</li>
            <li>Several signers must agree on every transfer (e.g. 5 of 7)</li>
            <li>Per-transfer and daily caps, and an emergency pause</li>
          </ul>
        </section>
      )}
    </div>
  );
}

function Treasury({ st, busy, act }: { st: Status; busy: string; act: (n: string, p: string, b: unknown, d: string) => Promise<void> }) {
  const [to, setTo] = useState("");
  const [amt, setAmt] = useState("");
  const [look, setLook] = useState("");
  const [acct, setAcct] = useState<any>(null);
  return (
    <section className="card stack">
      <div className="chain-stats">
        <div><small>Total supply</small><b>{atk(st.supply)} ATK</b><em>cap {st.max_supply ? atk(st.max_supply) : "none"}</em></div>
        <div><small>AUTISTIK Fund</small><b>{atk(st.fund_balance)} ATK</b><em className="mono">{short(st.fund)}</em></div>
        <div><small>Owner</small><b className="mono">{short(st.owner)}</b><em>min fee {st.min_fee / UNIT} ATK</em></div>
      </div>
      <b>Mint or send ATK</b>
      <input className="ait-text" value={to} onChange={(e) => setTo(e.target.value.trim())} placeholder="To address (atk…)" aria-label="To address" />
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        <input className="ait-text" style={{ maxWidth: 180 }} inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} placeholder="Amount ATK" aria-label="Amount" />
        <button type="button" className="btn primary" disabled={!!busy || !to || !amt} onClick={() => { if (confirm(`Mint ${amt} NEW ATK to ${to}? This raises the total supply.`)) act("mint", "mint", { to, amount: amt }, `Minted ${amt} ATK.`); }}>{busy === "mint" ? "Minting…" : "🪙 Mint new"}</button>
        <button type="button" className="btn" disabled={!!busy || !to || !amt} onClick={() => { if (confirm(`Send ${amt} ATK from the owner account to ${to}?`)) act("send", "transfer", { to, amount: amt }, `Sent ${amt} ATK.`); }}>{busy === "send" ? "Sending…" : "➡️ Send from owner"}</button>
      </div>
      <b>Look up an account</b>
      <div className="row" style={{ gap: 6 }}>
        <input className="ait-text" value={look} onChange={(e) => setLook(e.target.value.trim())} placeholder="atk… or @name" aria-label="Account" />
        <button type="button" className="btn" onClick={async () => { try { setAcct(await api(`account?address=${encodeURIComponent(look)}`)); } catch (e) { setAcct({ error: (e as Error).message }); } }}>Look up</button>
      </div>
      {acct && (acct.error ? <small className="down">{acct.error}</small> : <small className="mono">{acct.address}{acct.name ? ` (@${acct.name})` : ""}: <b>{atk(acct.balance)} ATK</b> · {acct.nonce} transactions</small>)}
    </section>
  );
}

function Validators({ vals, total, busy, act }: { vals: { pubkey: string; power: number; address: string }[]; total: number; busy: string; act: (n: string, p: string, b: unknown, d: string) => Promise<void> }) {
  const [pk, setPk] = useState("");
  const [power, setPower] = useState("10");
  const safe = vals.length >= 4;
  return (
    <section className="card stack">
      <b>Validators ({vals.length})</b>
      {!safe && <small className="down">With fewer than 4 validators the chain can&apos;t survive even one bad or offline validator. Run at least 4, on different servers and providers.</small>}
      <ul className="chain-vals">
        {vals.map((v) => (
          <li key={v.pubkey}>
            <span className="mono grow">{v.pubkey.slice(0, 16)}…{v.pubkey.slice(-6)}</span>
            <span>{v.power} power · {total ? Math.round((v.power / total) * 100) : 0}%</span>
            <button type="button" className="btn small" disabled={!!busy || vals.length <= 1} onClick={() => { if (confirm("Remove this validator? Make sure the rest still hold more than 2/3 of the power and are online.")) act("rm", "validator", { pubkey: v.pubkey, power: 0 }, "Validator removed."); }}>Remove</button>
          </li>
        ))}
      </ul>
      <b>Add or change a validator</b>
      <input className="ait-text mono" value={pk} onChange={(e) => setPk(e.target.value.trim().toLowerCase())} placeholder="Validator public key (64 hex, from `autd keygen`)" aria-label="Validator public key" />
      <div className="row" style={{ gap: 6 }}>
        <input className="ait-text" style={{ maxWidth: 120 }} inputMode="numeric" value={power} onChange={(e) => setPower(e.target.value)} aria-label="Power" />
        <button type="button" className="btn primary" disabled={!!busy || !/^[0-9a-f]{64}$/.test(pk)} onClick={() => { if (confirm(`Set this validator's power to ${power}? Start its node (synced) first, or the chain may slow down.`)) act("val", "validator", { pubkey: pk, power: Number(power) }, "Validator updated."); }}>{busy === "val" ? "Saving…" : "Save validator"}</button>
      </div>
      <small className="muted">Changes take effect from the next block. Start the new node and let it catch up before giving it power.</small>
    </section>
  );
}

function Setup({ ownerKey }: { ownerKey: { ownerKey?: boolean } }) {
  return (
    <div className="stack chain">
      <div className="page-head chain-hero"><Link href="/admin" className="muted">← Admin</Link><h1>⛓️ AUTISTIK Chain</h1></div>
      <section className="card stack">
        <b>Connect your chain</b>
        <ol className="muted" style={{ margin: 0, paddingLeft: 18 }}>
          <li>Start your nodes on your servers (see <code>chain/README.md</code> in the GitHub repo).</li>
          <li>In Vercel → Settings → Environment Variables add <code>CHAIN_RPC_URL</code> (e.g. https://rpc.autistik.io).</li>
          <li>Add <code>CHAIN_OWNER_KEY</code> (the owner seed from <code>autd keygen</code>) {ownerKey.ownerKey ? "✓ set" : "— not set yet"}.</li>
          <li>Redeploy, then come back here.</li>
        </ol>
      </section>
    </div>
  );
}
