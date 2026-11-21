"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * AUTISTIK Dice: play chips only (no real money). A shared round every 30 seconds: put chips in the pot, everyone
 * rolls two dice when the round closes, and the highest total takes the whole pot (ties split it). Alone at the
 * table? The House matches your stake. Rolls and chips are handled on the server (/api/dice).
 */
type Bet = { alias: string; stake: number; d1: number; d2: number; payout: number; me: boolean };
type State = {
  now: number;
  round: { id: number; endsAt: number; pot: number; players: { alias: string; stake: number; me: boolean }[] };
  results: { id: number; pot: number; winners: string[]; bets: Bet[] }[];
  leaders: { alias: string; chips: number; won: number; played: number }[];
  me: null | { chips: number; won: number; played: number; canRefill: boolean; inRound: boolean };
};
const STAKES = [10, 50, 100, 250, 500];
const PIPS: Record<number, [number, number][]> = {
  1: [[50, 50]], 2: [[28, 28], [72, 72]], 3: [[26, 26], [50, 50], [74, 74]], 4: [[28, 28], [72, 28], [28, 72], [72, 72]],
  5: [[27, 27], [73, 27], [50, 50], [27, 73], [73, 73]], 6: [[28, 24], [72, 24], [28, 50], [72, 50], [28, 76], [72, 76]],
};
const fmt = (n: number) => n.toLocaleString("en-US");

function Die({ v, rolling, big }: { v: number; rolling?: boolean; big?: boolean }) {
  const [face, setFace] = useState(v || 1);
  useEffect(() => {
    if (!rolling) { setFace(v || 1); return; }
    const id = setInterval(() => setFace(1 + Math.floor(Math.random() * 6)), 90);
    return () => clearInterval(id);
  }, [rolling, v]);
  return (
    <svg viewBox="0 0 100 100" className={"dz-die" + (rolling ? " rolling" : "") + (big ? " big" : "")} role="img" aria-label={rolling ? "rolling" : `${face}`}>
      <rect x="4" y="4" width="92" height="92" rx="20" />
      {PIPS[face].map(([x, y], i) => <circle key={i} cx={x} cy={y} r="9" />)}
    </svg>
  );
}

export default function DiceGame({ signedIn }: { signedIn: boolean }) {
  const [s, setS] = useState<State | null>(null);
  const [stake, setStake] = useState(50);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [now, setNow] = useState(Date.now());
  const [reveal, setReveal] = useState<{ id: number; done: boolean } | null>(null);
  const skew = useRef(0);
  const watched = useRef<number | null>(null);
  const seen = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/dice", { cache: "no-store" });
      const d: State = await r.json();
      skew.current = d.now - Date.now();
      setS(d);
      const top = d.results[0];
      if (top && seen.current !== top.id) {
        // A round I was in (or the last one, the first time) just rolled: play the roll.
        if (seen.current !== null || watched.current === top.id) {
          setReveal({ id: top.id, done: false });
          setTimeout(() => setReveal({ id: top.id, done: true }), 1600);
        }
        seen.current = top.id;
      }
      if (d.me?.inRound) watched.current = d.round.id;
    } catch { /* keep the last view */ }
  }, []);

  useEffect(() => { load(); const id = setInterval(load, 2000); return () => clearInterval(id); }, [load]);
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(id); }, []);

  async function post(body: object) {
    setBusy(true); setMsg("");
    try {
      const r = await fetch("/api/dice", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) setMsg(d.error || "That didn't work. Try again.");
      else if ("round" in d) { watched.current = d.round; setMsg(`You're in with ${fmt(stake)} chips. Good luck!`); }
      await load();
    } finally { setBusy(false); }
  }

  const left = s ? Math.max(0, Math.ceil((s.round.endsAt - (now + skew.current)) / 1000)) : 30;
  const last = s?.results[0];
  const rolling = !!reveal && reveal.id === last?.id && !reveal.done;
  const myLast = last?.bets.find((b) => b.me);
  const canBet = signedIn && s?.me && !s.me.inRound && left > 2;

  return (
    <div className="dz stack">
      <header className="dz-head">
        <div>
          <div className="dz-kick">AUTISTIK · PLAY</div>
          <h1>🎲 Dice</h1>
          <p className="muted">Put chips in the pot. Everyone rolls two dice. <b>Highest roll takes it all.</b></p>
        </div>
        <span className="dz-chipnote">Play chips · no real money</span>
      </header>

      <section className="dz-table">
        <div className="dz-pot">
          <span className="dz-lbl">Pot</span>
          <b>{fmt(s?.round.pot || 0)}</b>
          <span className="dz-lbl">chips</span>
        </div>
        <div className="dz-timer" style={{ ["--p" as any]: `${(left / 30) * 100}%` }}>
          <b>{left}s</b><small>{left > 2 ? "to join" : "rolling…"}</small>
        </div>
        <ul className="dz-players">
          {!s?.round.players.length && <li className="muted">No one in yet. Be first: if you're alone, the House matches your stake.</li>}
          {s?.round.players.map((p) => <li key={p.alias} className={p.me ? "me" : ""}><span>{p.alias}{p.me ? " (you)" : ""}</span><b>{fmt(p.stake)}</b></li>)}
        </ul>
      </section>

      {signedIn ? (
        <section className="dz-bet card stack">
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <b>Your chips: {fmt(s?.me?.chips ?? 0)}</b>
            {s?.me?.canRefill && <button type="button" className="btn small" disabled={busy} onClick={() => post({ action: "refill" })}>Get 1,000 free chips</button>}
          </div>
          <div className="dz-stakes" role="group" aria-label="Stake">
            {STAKES.map((v) => <button key={v} type="button" aria-pressed={stake === v} onClick={() => setStake(v)}>{v}</button>)}
            <input inputMode="numeric" aria-label="Other stake" placeholder="Other" value={STAKES.includes(stake) ? "" : String(stake)} onChange={(e) => { const v = Math.floor(Number(e.target.value.replace(/\D/g, ""))); if (v > 0) setStake(v); }} />
          </div>
          <button type="button" className="dz-go" disabled={!canBet || busy || (s?.me?.chips ?? 0) < stake} onClick={() => post({ stake })}>
            {s?.me?.inRound ? "You're in · waiting for the roll" : left <= 2 ? "Rolling… next round in a moment" : `Put in ${fmt(stake)} chips`}
          </button>
          {msg && <p className="dz-msg" role="status">{msg}</p>}
          <small className="muted">Free chips come back once a day when you're under 100. Chips have no money value.</small>
        </section>
      ) : (
        <section className="card stack"><b>Sign in to get 1,000 free chips and play.</b><Link className="btn primary" href="/login?next=/dice">Sign in</Link></section>
      )}

      {last && (
        <section className={"dz-result card stack" + (rolling ? " rolling" : "")} aria-live="polite">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <b>Last roll</b>
            <span className="muted">Pot {fmt(last.pot)}</span>
          </div>
          {!rolling && (
            <div className="dz-win">🏆 {last.winners.join(" & ")} {last.winners.length > 1 ? "split" : "takes"} <b>{fmt(last.pot)}</b> chips
              {myLast && <span className={myLast.payout > 0 ? "up" : "down"}> · you {myLast.payout > 0 ? `won ${fmt(myLast.payout - myLast.stake)}` : `lost ${fmt(myLast.stake)}`}</span>}
            </div>
          )}
          <ul className="dz-rolls">
            {last.bets.map((b) => (
              <li key={b.alias} className={(b.me ? "me " : "") + (!rolling && b.payout > 0 ? "won" : "")}>
                <span className="dz-name">{b.alias}{b.me ? " (you)" : ""}</span>
                <span className="dz-dice"><Die v={b.d1} rolling={rolling} /><Die v={b.d2} rolling={rolling} /></span>
                <b>{rolling ? "…" : b.d1 + b.d2}</b>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="dz-grid">
        <section className="card stack">
          <b>Recent rounds</b>
          <ul className="dz-hist">
            {(s?.results || []).slice(1).map((r) => <li key={r.id}><span>🏆 {r.winners.join(" & ")}</span><b>{fmt(r.pot)}</b></li>)}
            {(s?.results.length || 0) <= 1 && <li className="muted">Rounds you play show here.</li>}
          </ul>
        </section>
        <section className="card stack">
          <b>Top players</b>
          <ol className="dz-hist">
            {(s?.leaders || []).map((l, i) => <li key={l.alias + i}><span>{i + 1}. {l.alias}</span><b>{fmt(l.chips)}</b></li>)}
            {!s?.leaders.length && <li className="muted">No players yet.</li>}
          </ol>
        </section>
      </div>
    </div>
  );
}
