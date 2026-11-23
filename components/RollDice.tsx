"use client";
import Link from "next/link";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { getState, pickWallet, setNetwork, subscribe, switchEvm } from "@/lib/connect";
import { Die } from "@/components/DiceGame";

/**
 * Roll the Dice: real AUTISTIK. Hold at least $10 of AUTISTIK, put $0.50 of AUTISTIK in the pot from your own wallet,
 * and when the round closes everyone rolls two dice: the highest roll takes the whole pot. Payments, rolls and
 * payouts are checked and handled on the server (/api/roll).
 */
type Roll = { alias: string; d1: number; d2: number; me: boolean };
type State = {
  open: boolean; pot: string | null; token: string; decimals: number; price: number | null;
  entryRaw: string | null; holdRaw: string | null; entryUsd: number; holdUsd: number; roundSeconds: number; refundAfterMin: number;
  round: { id: number; closesAt: string | null; now: string; players: { alias: string; address: string; me: boolean }[]; potRaw: string };
  results: { id: number; status: string; potRaw: string; winner: string | null; winnerAddr: string | null; tx: string | null; at: string; note: string | null; rolls: Roll[] }[];
};
const toks = (raw: string | null, dec: number) => (raw ? Number(BigInt(raw) / 10n ** BigInt(Math.max(0, dec - 4))) / 1e4 : 0);
const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const pad = (h: string) => h.replace(/^0x/, "").padStart(64, "0");

export default function RollDice({ signedIn }: { signedIn: boolean }) {
  const conn = useSyncExternalStore(subscribe, getState, getState);
  const [s, setS] = useState<State | null>(null);
  const [addr, setAddr] = useState("");
  const [hold, setHold] = useState<{ ok: boolean; haveRaw: string; needRaw: string } | null>(null);
  const [adult, setAdult] = useState(false);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [nowMs, setNowMs] = useState(Date.now());

  const load = useCallback(() => fetch("/api/roll", { cache: "no-store" }).then((r) => r.json()).then((d) => { if (!d.error) setS(d); }).catch(() => {}), []);
  useEffect(() => { load(); const a = setInterval(load, 5000), b = setInterval(() => setNowMs(Date.now()), 500); return () => { clearInterval(a); clearInterval(b); }; }, [load]);
  useEffect(() => {
    const p = conn.current?.provider;
    if (!p) { setAddr(""); return; }
    p.request({ method: "eth_accounts" }).then((a: string[]) => setAddr(a?.[0] || "")).catch(() => setAddr(""));
  }, [conn.current]);
  useEffect(() => {
    setHold(null);
    if (!addr || !signedIn) return;
    fetch("/api/roll", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "check", address: addr }) })
      .then((r) => r.json()).then((d) => { if (!d.error) setHold(d); }).catch(() => {});
  }, [addr, signedIn, s?.round.id]);

  const dec = s?.decimals ?? 18;
  const inRound = !!s?.round.players.some((p) => p.me);
  const left = s?.round.closesAt ? Math.max(0, Math.ceil((Date.parse(s.round.closesAt) - nowMs) / 1000)) : null;

  async function play() {
    if (!s?.pot || !s.entryRaw) return;
    if (!adult) { setMsg("Tick the box to confirm you're 18 or older."); return; }
    const p = conn.current?.provider;
    if (!p || !addr) { setNetwork("bsc").catch(() => {}); pickWallet({ fresh: true }); return; }
    setMsg("");
    try {
      if (hold && !hold.ok) throw new Error(`You need at least $${s.holdUsd} of AUTISTIK (plus the $${s.entryUsd} entry) in this wallet to play.`);
      setBusy("Switching your wallet to BNB Chain…");
      await switchEvm(p, 56);
      setBusy(`Approve the $${s.entryUsd} AUTISTIK entry in your wallet…`);
      const data = "0xa9059cbb" + pad(s.pot) + pad(BigInt(s.entryRaw).toString(16));
      const tx: string = await p.request({ method: "eth_sendTransaction", params: [{ from: addr, to: s.token, data, value: "0x0" }] });
      setBusy("Checking your entry on BNB Chain…");
      for (let i = 0; i < 6; i++) {
        const r = await fetch("/api/roll", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "join", tx, adult: true }) });
        const d = await r.json().catch(() => ({}));
        if (r.ok) { setMsg(`You're in round ${d.round}! ${d.players < 2 ? "Waiting for another player." : "Rolling when the timer ends."}`); break; }
        if (!/hasn't landed/.test(d.error || "") || i === 5) throw new Error(d.error || "Couldn't join.");
        await new Promise((x) => setTimeout(x, 3000));
      }
      load();
    } catch (e) {
      setMsg((e as any)?.code === 4001 ? "You cancelled in your wallet." : (e as Error).message);
    } finally { setBusy(""); }
  }

  const last = s?.results[0];
  return (
    <div className="dz stack">
      <header className="dz-head">
        <div>
          <div className="dz-kick">AUTISTIK · PLAY</div>
          <h1>🎲 Roll the Dice</h1>
          <p className="muted">Put <b>${s?.entryUsd ?? 0.5} of AUTISTIK</b> in the pot. Everyone rolls two dice. <b>Highest roll takes it all.</b></p>
        </div>
        <span className="dz-chipnote">Real AUTISTIK · 18+</span>
      </header>

      {s && !s.open && <div className="notice warn">Roll the Dice is closed right now. Play <Link href="/dice">Dice with free chips</Link> meanwhile.</div>}

      <section className="dz-table">
        <div className="dz-pot">
          <span className="dz-lbl">Pot</span>
          <b>{fmt(toks(s?.round.potRaw || "0", dec))}</b>
          <span className="dz-lbl">AUTISTIK{s?.price ? ` ≈ $${(toks(s.round.potRaw, dec) * s.price).toFixed(2)}` : ""}</span>
        </div>
        <div className="dz-timer" style={{ ["--p" as any]: `${left == null ? 100 : (left / (s?.roundSeconds || 60)) * 100}%` }}>
          {left == null ? (s?.round.players.length ? "Waiting for a second player" : "Waiting for players") : left > 0 ? `Rolling in ${left}s` : "Rolling…"}
        </div>
        <ul className="dz-players">
          {!s?.round.players.length && <li className="muted">No one in yet. Be first: the round starts its timer when a second player joins.</li>}
          {s?.round.players.map((p) => <li key={p.address}><b>{p.alias}{p.me ? " (you)" : ""}</b> <small className="muted">{short(p.address)}</small></li>)}
        </ul>
      </section>

      {signedIn ? (
        <section className="dz-bet card stack">
          <b>How to play</b>
          <small className="muted">1. Hold at least <b>${s?.holdUsd ?? 10} of AUTISTIK</b> on BNB Chain. 2. Pay the <b>${s?.entryUsd ?? 0.5}</b> entry ({s?.entryRaw ? fmt(toks(s.entryRaw, dec)) : "…"} AUTISTIK) from that wallet. 3. When the timer ends, the highest roll wins the whole pot, sent to their wallet. Alone for {s?.refundAfterMin ?? 30} minutes? Your entry comes back.</small>
          <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {addr ? <span>Wallet <b>{short(addr)}</b></span> : <span className="muted">No wallet connected</span>}
            <button type="button" className="btn small" onClick={() => { setNetwork("bsc").catch(() => {}); pickWallet({ fresh: true }); }}>{addr ? "Switch wallet" : "Connect wallet"}</button>
          </div>
          {hold && <small className={hold.ok ? "muted" : "aic-warn"}>{hold.ok ? "✅" : "⚠️"} This wallet holds {fmt(toks(hold.haveRaw, dec))} AUTISTIK{s?.price ? ` (≈ $${(toks(hold.haveRaw, dec) * s.price).toFixed(2)})` : ""}. {hold.ok ? "You can play." : `You need about ${fmt(toks(hold.needRaw, dec))} AUTISTIK to play.`}</small>}
          <label className="row" style={{ gap: 8, alignItems: "center" }}>
            <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} />
            <small>I'm 18 or older and I understand this is a game of chance with real money I can lose.</small>
          </label>
          <button type="button" className="dz-go" disabled={!s?.open || !!busy || inRound || (!!hold && !hold.ok)} onClick={play}>
            {inRound ? "You're in this round" : busy ? "Working…" : `🎲 Pay $${s?.entryUsd ?? 0.5} & join`}
          </button>
          {busy && <p className="dz-msg">{busy}</p>}
          {msg && <p className="dz-msg" role="status">{msg}</p>}
          <small className="muted">Only play with money you can afford to lose. Want to play without money? <Link href="/dice">Dice uses free chips</Link>.</small>
        </section>
      ) : (
        <section className="card stack"><b>Sign in to play Roll the Dice.</b><Link className="btn primary" href="/login?next=/roll">Sign in</Link></section>
      )}

      {last && (
        <section className="card stack">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <b>Last round</b>
            <span className="muted">Pot {fmt(toks(last.potRaw, dec))} AUTISTIK</span>
          </div>
          {last.status === "settled"
            ? <div className="dz-win">🏆 {last.winner} takes <b>{fmt(toks(last.potRaw, dec))}</b> AUTISTIK{last.tx ? <> · <a href={`https://bscscan.com/tx/${last.tx}`} target="_blank" rel="noreferrer">payout ↗</a></> : null}</div>
            : <div className="muted">{last.note}</div>}
          <ul className="dz-rolls">
            {last.rolls.map((r) => (
              <li key={r.alias} className={r.alias === last.winner ? "win" : ""}>
                <span className="dz-name">{r.alias}{r.me ? " (you)" : ""}</span>
                <span className="dz-dice"><Die v={r.d1} /><Die v={r.d2} /></span>
              </li>
            ))}
          </ul>
          {last.note && last.status === "settled" && <small className="muted">{last.note}</small>}
        </section>
      )}

      {(s?.results.length || 0) > 1 && (
        <section className="card stack">
          <b>Earlier rounds</b>
          <ul className="dz-hist">
            {s!.results.slice(1).map((r) => (
              <li key={r.id}>#{r.id} · {r.status === "settled" ? <>🏆 {r.winner} won {fmt(toks(r.potRaw, dec))} AUTISTIK{r.tx ? <> · <a href={`https://bscscan.com/tx/${r.tx}`} target="_blank" rel="noreferrer">tx ↗</a></> : null}</> : r.note}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
