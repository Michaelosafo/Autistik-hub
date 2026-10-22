"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPublicClient, createWalletClient, custom, encodeFunctionData, erc20Abi, formatUnits, getAddress, http, parseUnits } from "viem";
import { pickWallet } from "@/lib/connect";
import { supabaseBrowser } from "@/lib/supabase/client";
import { TOKEN_ADDRESS } from "@/lib/groups";
import { WCHAINS } from "@/lib/wallet-chains";
import { txUrl } from "@/lib/explorer";
import MemberName from "@/components/members/MemberName";

const c = WCHAINS.bsc;
const pub = createPublicClient({ chain: c.viem, transport: http(c.rpc) }) as any;
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

type Audience = "session" | "followers" | "wallets" | "team";
type Row = { user_id: string; alias: string; color: string; is_team?: boolean; wallet: string; pick: boolean; sent?: string };
type Token = { address: `0x${string}`; symbol: string; decimals: number };
type Sender = { account: `0x${string}`; balance: bigint; gas: bigint; w: any };
type Result = { user_id: string; hash?: string; error?: string };

/**
 * Admin: send tokens to members' linked wallets. Pick who (everyone who joined a live session, your followers,
 * the team, or every member with a wallet), set the amount, check the confirmation screen, then sign each transfer
 * in YOUR OWN wallet. The site never holds or sees a private key: every transfer is approved by you in your wallet.
 */
export default function AdminAirdrop() {
  const sb = supabaseBrowser();
  const [ready, setReady] = useState(true);
  const [sessions, setSessions] = useState<{ id: string; title: string; starts_at: string; n: number }[]>([]);
  const [audience, setAudience] = useState<Audience>("session");
  const [sessionId, setSessionId] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [noWallet, setNoWallet] = useState(0);
  const [amount, setAmount] = useState("1000");
  const [tokenIn, setTokenIn] = useState(TOKEN_ADDRESS);
  const [token, setToken] = useState<Token | null>(null);
  const [step, setStep] = useState<"pick" | "review" | "sending" | "done">("pick");
  const [sender, setSender] = useState<Sender | null>(null);
  const [checked, setChecked] = useState(false);
  const [results, setResults] = useState<Result[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const stop = useRef(false);

  async function loadBase() {
    const [{ data: s, error }, { data: j }, { data: h }] = await Promise.all([
      sb.from("sessions").select("id,title,starts_at").lte("starts_at", new Date(Date.now() + 86400e3).toISOString()).order("starts_at", { ascending: false }).limit(30),
      sb.from("session_joins").select("session_id").limit(10000),
      sb.from("airdrop_sends").select("batch,audience,session_id,user_id,wallet,amount,tx_hash,created_at").order("created_at", { ascending: false }).limit(500),
    ]);
    if (error || !j) { setReady(false); return; }
    const n: Record<string, number> = {};
    for (const r of j) n[r.session_id] = (n[r.session_id] || 0) + 1;
    const list = (s || []).map((x: any) => ({ ...x, n: n[x.id] || 0 }));
    setSessions(list);
    if (!sessionId && list.length) setSessionId((list.find((x) => x.n) || list[0]).id);
    setHistory(h || []);
  }
  useEffect(() => { loadBase(); }, []);

  // Who gets it.
  useEffect(() => {
    if (!ready || (audience === "session" && !sessionId)) { setRows([]); return; }
    (async () => {
      let ids: string[] | null = null;
      if (audience === "session") ids = ((await sb.from("session_joins").select("user_id").eq("session_id", sessionId)).data || []).map((r: any) => r.user_id);
      if (audience === "followers") {
        const { data: { user } } = await sb.auth.getUser();
        ids = ((await sb.from("follows").select("follower_id").eq("followee_id", user?.id || "")).data || []).map((r: any) => r.follower_id);
      }
      if (audience === "team") ids = ((await sb.from("profiles").select("id").eq("is_team", true)).data || []).map((r: any) => r.id);
      const { data: w } = ids ? await sb.from("wallets").select("user_id,address").in("user_id", ids.length ? ids : [""]) : await sb.from("wallets").select("user_id,address").limit(5000);
      const wallets = new Map((w || []).map((x: any) => [x.user_id, x.address as string]));
      const who = [...wallets.keys()];
      const { data: p } = await sb.from("profiles").select("id,alias,color,is_team").in("id", who.length ? who : [""]);
      const prof = new Map((p || []).map((x: any) => [x.id, x]));
      const already = new Map<string, string>();
      if (audience === "session") for (const h of history) if (h.session_id === sessionId && h.tx_hash) already.set(h.user_id, h.batch);
      const seen = new Set<string>();
      const out: Row[] = [];
      for (const [uid, addr] of wallets) {
        if (seen.has(addr.toLowerCase())) continue;
        seen.add(addr.toLowerCase());
        const pr: any = prof.get(uid) || { alias: "Member", color: "#6141D4" };
        out.push({ user_id: uid, alias: pr.alias, color: pr.color, is_team: pr.is_team, wallet: addr, pick: !already.has(uid), sent: already.get(uid) });
      }
      out.sort((a, b) => a.alias.localeCompare(b.alias));
      setRows(out);
      setNoWallet(ids ? Math.max(0, ids.length - wallets.size) : 0);
    })();
  }, [audience, sessionId, ready, history]);

  // The token: read its name and decimals from the chain, so amounts are exact.
  useEffect(() => {
    setToken(null);
    if (!/^0x[0-9a-fA-F]{40}$/.test(tokenIn.trim())) return;
    const address = getAddress(tokenIn.trim());
    Promise.all([
      pub.readContract({ address, abi: erc20Abi, functionName: "symbol" }),
      pub.readContract({ address, abi: erc20Abi, functionName: "decimals" }),
    ]).then(([symbol, decimals]) => setToken({ address, symbol: String(symbol), decimals: Number(decimals) })).catch(() => setToken(null));
  }, [tokenIn]);

  const picked = rows.filter((r) => r.pick);
  const each = useMemo(() => { try { return token && Number(amount) > 0 ? parseUnits(amount.trim(), token.decimals) : 0n; } catch { return 0n; } }, [amount, token]);
  const total = each * BigInt(picked.length);
  const fmt = (v: bigint) => (token ? Number(formatUnits(v, token.decimals)).toLocaleString(undefined, { maximumFractionDigits: 6 }) : "…");

  async function review() {
    setMsg("");
    if (!token) { setMsg("That token address isn't a BNB Chain token."); return; }
    if (!picked.length) { setMsg("Pick at least one member."); return; }
    if (!each) { setMsg("Type an amount above 0."); return; }
    setBusy(true);
    try {
      const eth = await pickWallet();
      if (!eth) { setBusy(false); return; }
      const w = createWalletClient({ chain: c.viem, transport: custom(eth) }) as any;
      const [account] = await w.requestAddresses();
      try { await w.switchChain({ id: c.chainId }); } catch { await w.addChain({ chain: c.viem }); await w.switchChain({ id: c.chainId }); }
      const [balance, gas] = await Promise.all([
        pub.readContract({ address: token.address, abi: erc20Abi, functionName: "balanceOf", args: [account] }),
        pub.getBalance({ address: account }),
      ]);
      setSender({ account: getAddress(account), balance, gas, w });
      setChecked(false); setStep("review");
    } catch (e: any) {
      setMsg(/reject|denied/i.test(String(e?.message)) ? "You cancelled in your wallet." : e?.shortMessage || "Couldn't connect your wallet.");
    }
    setBusy(false);
  }

  async function send() {
    if (!sender || !token || !checked) return;
    stop.current = false;
    setStep("sending"); setResults([]);
    const batch = `${new Date().toISOString().slice(0, 16).replace("T", " ")} · ${picked.length} × ${amount} ${token.symbol}`;
    const label = audience === "session" ? `Live: ${sessions.find((s) => s.id === sessionId)?.title || "session"}` : audience === "followers" ? "My followers" : audience === "team" ? "Team" : "All members with a wallet";
    const out: Result[] = [];
    for (const r of picked) {
      if (stop.current) break;
      try {
        // Your wallet shows the token, the member's wallet and the amount: approve each one there.
        const hash = await sender.w.sendTransaction({
          account: sender.account, chain: c.viem, to: token.address,
          data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [getAddress(r.wallet), each] }),
        });
        out.push({ user_id: r.user_id, hash });
        await sb.from("airdrop_sends").insert({ batch, audience: label, session_id: audience === "session" ? sessionId : null, user_id: r.user_id, wallet: r.wallet, token: token.address, amount: formatUnits(each, token.decimals), tx_hash: hash });
      } catch (e: any) {
        const cancelled = /reject|denied|cancel/i.test(String(e?.message));
        out.push({ user_id: r.user_id, error: cancelled ? "Cancelled in wallet" : e?.shortMessage || "Failed" });
        if (cancelled) stop.current = true; // one "Reject" stops the rest, so you're never stuck pressing it 50 times
      }
      setResults([...out]);
    }
    setStep("done");
    loadBase();
  }

  if (!ready) return <div className="card stack" id="airdrop"><h2>Send an airdrop</h2><p className="muted">Run <span className="mono">supabase/members-live.sql</span> in Supabase to turn this on.</p></div>;

  const name = (id: string) => rows.find((r) => r.user_id === id);
  const enough = sender ? sender.balance >= total : false;
  const batches = Object.values(history.reduce((m: Record<string, any>, h: any) => {
    (m[h.batch] ||= { batch: h.batch, audience: h.audience, n: 0, at: h.created_at, amount: 0 });
    m[h.batch].n++; m[h.batch].amount += Number(h.amount) || 0; return m;
  }, {})).slice(0, 10) as any[];

  return (
    <div className="card stack airdrop" id="airdrop">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2>Send an airdrop</h2>
        <span className="badge gold">Signed in your wallet</span>
      </div>

      {step === "pick" && (
        <>
          <div className="chips" role="radiogroup" aria-label="Who gets it">
            {([["session", "Joined a live session"], ["followers", "My followers"], ["team", "Team"], ["wallets", "Every member with a wallet"]] as [Audience, string][]).map(([k, t]) => (
              <button key={k} type="button" role="radio" className="chip" aria-checked={audience === k} aria-current={audience === k ? "page" : undefined} onClick={() => setAudience(k)}>{t}</button>
            ))}
          </div>
          {audience === "session" && (
            <label className="field"><span>Session</span>
              <select value={sessionId} onChange={(e) => setSessionId(e.target.value)}>
                {!sessions.length && <option value="">No sessions yet</option>}
                {sessions.map((s) => <option key={s.id} value={s.id}>{s.title} · {new Date(s.starts_at).toLocaleDateString()} · {s.n} joined</option>)}
              </select>
            </label>
          )}
          <div className="row" style={{ gap: 10, alignItems: "flex-end" }}>
            <label className="field" style={{ flex: 1, minWidth: 140 }}><span>Amount for each member</span><input type="text" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} /></label>
            <label className="field" style={{ flex: 2, minWidth: 220 }}><span>Token on BNB Chain {token ? `· ${token.symbol}` : ""}</span><input type="text" className="mono" value={tokenIn} onChange={(e) => setTokenIn(e.target.value.trim())} /></label>
          </div>
          <div className="scroll"><table>
            <thead><tr><th><input type="checkbox" aria-label="Pick all" checked={!!rows.length && rows.every((r) => r.pick)} onChange={(e) => setRows(rows.map((r) => ({ ...r, pick: e.target.checked })))} /></th><th>Member</th><th>Wallet</th><th className="num">Amount</th></tr></thead>
            <tbody>
              {!rows.length && <tr><td colSpan={4} className="muted">Nobody with a linked wallet here yet.</td></tr>}
              {rows.map((r, i) => (
                <tr key={r.user_id}>
                  <td><input type="checkbox" aria-label={`Send to ${r.alias}`} checked={r.pick} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, pick: e.target.checked } : x)))} /></td>
                  <td><MemberName m={{ id: r.user_id, alias: r.alias, color: r.color, is_team: r.is_team }} />{r.sent && <span className="badge gold" style={{ marginLeft: 6 }} title={r.sent}>Already sent</span>}</td>
                  <td className="mono">{short(r.wallet)}</td>
                  <td className="num">{r.pick ? `${amount || 0} ${token?.symbol || ""}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
          {noWallet > 0 && <p className="muted" style={{ fontSize: ".86em" }}>{noWallet} more member{noWallet > 1 ? "s" : ""} in this group haven&apos;t connected a wallet, so they can&apos;t receive it.</p>}
          <div className="airdrop-total">
            <span><b>{picked.length}</b> member{picked.length === 1 ? "" : "s"}</span>
            <span>Total <b>{fmt(total)} {token?.symbol}</b></span>
            <button className="btn primary" type="button" disabled={busy || !picked.length || !each} onClick={review}>{busy ? "Connecting…" : "Review & connect wallet"}</button>
          </div>
        </>
      )}

      {step === "review" && sender && token && (
        <div className="stack airdrop-confirm">
          <div className="notice warn"><b>Check everything before you send.</b> Token transfers can&apos;t be undone.</div>
          <table><tbody>
            <tr><th>From (your wallet)</th><td className="mono" style={{ overflowWrap: "anywhere" }}>{sender.account}</td></tr>
            <tr><th>Network</th><td>BNB Chain</td></tr>
            <tr><th>Token</th><td>{token.symbol} <span className="mono muted">{short(token.address)}</span></td></tr>
            <tr><th>Recipients</th><td><b>{picked.length}</b></td></tr>
            <tr><th>Each gets</th><td>{fmt(each)} {token.symbol}</td></tr>
            <tr><th>Total</th><td><b>{fmt(total)} {token.symbol}</b></td></tr>
            <tr><th>Your balance</th><td className={enough ? "" : "bad"}>{fmt(sender.balance)} {token.symbol}{!enough && " · not enough"}</td></tr>
            <tr><th>BNB for fees</th><td>{Number(formatUnits(sender.gas, 18)).toFixed(4)} BNB · about 0.0001 BNB per transfer</td></tr>
          </tbody></table>
          <details><summary>See all {picked.length} recipients</summary>
            <div className="scroll"><table><tbody>
              {picked.map((r) => <tr key={r.user_id}><td>{r.alias}</td><td className="mono" style={{ overflowWrap: "anywhere" }}>{r.wallet}</td><td className="num">{fmt(each)}</td></tr>)}
            </tbody></table></div>
          </details>
          <p className="muted" style={{ fontSize: ".88em" }}>Your wallet will ask you to approve {picked.length} transfer{picked.length > 1 ? "s" : ""}, one per member. Press Reject at any time to stop the rest.</p>
          <label className="row" style={{ gap: 8, flexWrap: "nowrap", alignItems: "flex-start" }}><input type="checkbox" style={{ marginTop: 4, flex: "none" }} checked={checked} onChange={(e) => setChecked(e.target.checked)} /> I&apos;ve checked the recipients, amounts and total.</label>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn primary" type="button" disabled={!checked || !enough} onClick={send}>Send {fmt(total)} {token.symbol}</button>
            <button className="btn" type="button" onClick={() => setStep("pick")}>Back</button>
          </div>
        </div>
      )}

      {(step === "sending" || step === "done") && token && (
        <div className="stack">
          <div className="notice">{step === "sending" ? `Sending ${results.length + 1} of ${picked.length}… approve it in your wallet.` : `Done: ${results.filter((r) => r.hash).length} of ${picked.length} sent.`}</div>
          <div className="scroll"><table><tbody>
            {results.map((r) => (
              <tr key={r.user_id}><td>{name(r.user_id)?.alias}</td><td className="mono">{short(name(r.user_id)?.wallet || "")}</td>
                <td>{r.hash ? <a href={txUrl(c.explorer, r.hash)} target="_blank" rel="noopener noreferrer">Sent ✓ {r.hash.slice(0, 10)}…</a> : <span className="bad">{r.error}</span>}</td></tr>
            ))}
          </tbody></table></div>
          <div className="row" style={{ gap: 8 }}>
            {step === "sending" && <button className="btn" type="button" onClick={() => { stop.current = true; }}>Stop after this one</button>}
            {step === "done" && <button className="btn primary" type="button" onClick={() => { setStep("pick"); setResults([]); }}>New airdrop</button>}
          </div>
        </div>
      )}

      {msg && <span className="muted" role="status">{msg}</span>}

      {!!batches.length && (
        <details>
          <summary>Past airdrops</summary>
          <div className="scroll"><table>
            <thead><tr><th>When · what</th><th>Who</th><th className="num">Transfers</th></tr></thead>
            <tbody>{batches.map((b) => <tr key={b.batch}><td>{b.batch}</td><td>{b.audience}</td><td className="num">{b.n}</td></tr>)}</tbody>
          </table></div>
        </details>
      )}
      <p className="muted" style={{ fontSize: ".82em" }}>Every transfer is signed by you in your own wallet. The Hub never holds or sees a private key.</p>
    </div>
  );
}
