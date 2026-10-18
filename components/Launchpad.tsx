"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createPublicClient, createWalletClient, custom, formatEther, getAddress, http, parseEther, parseEventLogs } from "viem";
import { maleUtterance } from "@/lib/voice";
import { AI_LAUNCH_SESSIONS, CHAINS, LAUNCHPAD_ABI, LOCKS, MIN_HOLD_USD, dexscreenerUrl, isLive, readLimits, viemChain, type LaunchPlan, checkPlan, MAX_CREATOR_PERCENT, type LiquidityLock } from "@/lib/launchpad";
import { Handwritten, WritingNote } from "@/components/Handwriting";
import Art from "@/components/Art";
import { useStickToBottom } from "@/lib/use-stick-bottom";

type Msg = { kind: "me" | "ai" | "sys"; text: string; pending?: boolean; born?: number };
type Turn = { role: "user" | "assistant"; content: string };
type Done = { token: string; pair: string; hash: string; listed: boolean };

const HELLO = "Hi, I'm Autistik. Which chain would you like to launch on: BNB Chain, Ethereum or Robinhood Chain?";

/** Reads text out loud with the device's most natural male voice (see lib/voice.ts). */
function speak(text: string, onState: (talking: boolean) => void) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const u = maleUtterance(text, 0.97);
  u.onstart = () => onState(true);
  u.onend = u.onerror = () => onState(false);
  window.speechSynthesis.speak(u);
}

function Bot() {
  return <Art kind="robot" who="autistik" mood="motivation" className="av" />;
}
const fmt = (n: string) => BigInt(n).toLocaleString("en-US");

export default function Launchpad({ signedIn }: { signedIn: boolean }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const turns = useRef<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<LaunchPlan | null>(null);
  const [fee, setFee] = useState<bigint | null>(null);
  const [minLiq, setMinLiq] = useState<bigint | null>(null);
  const [agree, setAgree] = useState(false);
  const [status, setStatus] = useState("");
  const [launching, setLaunching] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [voice, setVoice] = useState(false);
  const [talking, setTalking] = useState(false);
  const [listening, setListening] = useState(false);
  const [canSpeak, setCanSpeak] = useState(false);
  const [canListen, setCanListen] = useState(false);
  const rec = useRef<any>(null);
  // Two ways to launch: the quick form (no AI, unlimited) or Autistik (AI, 2 sessions a day).
  const [mode, setMode] = useState<"quick" | "ai">("quick");
  const session = useRef("");
  const [sessionsLeft, setSessionsLeft] = useState<number | null>(null);
  const newSession = () => { session.current = (crypto as any).randomUUID?.() || Math.random().toString(36).slice(2) + Date.now().toString(36); };
  if (!session.current) newSession();

  useStickToBottom(box, [mode]);
  useEffect(() => { box.current?.scrollTo({ top: box.current.scrollHeight }); }, [msgs.length]);
  useEffect(() => {
    setCanSpeak("speechSynthesis" in window);
    setCanListen(!!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition));
    try { setVoice(localStorage.getItem("autistik-voice") === "on"); const m = localStorage.getItem("launch-mode"); if (m === "ai" || m === "quick") setMode(m); } catch {}
    return () => { try { window.speechSynthesis?.cancel(); rec.current?.abort(); } catch {} };
  }, []);

  function pickMode(m: "quick" | "ai") {
    setMode(m);
    try { localStorage.setItem("launch-mode", m); } catch {}
    if (m === "quick") { window.speechSynthesis?.cancel(); setTalking(false); }
  }
  function say(text: string) { if (voice) speak(text, setTalking); }
  function toggleVoice() {
    const next = !voice;
    setVoice(next);
    try { localStorage.setItem("autistik-voice", next ? "on" : "off"); } catch {}
    if (next) speak(msgs.filter((m) => m.kind === "ai" && !m.pending).slice(-1)[0]?.text || HELLO, setTalking);
    else { window.speechSynthesis?.cancel(); setTalking(false); }
  }
  // Speak your answer instead of typing it. The words go into the box so you can check them, then send.
  function listen() {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    if (listening) { rec.current?.stop(); return; }
    window.speechSynthesis?.cancel();
    const r = new SR();
    r.lang = navigator.language || "en-US";
    r.interimResults = true;
    r.onresult = (e: any) => setInput(Array.from(e.results).map((x: any) => x[0].transcript).join(" "));
    r.onerror = (e: any) => { if (e.error === "not-allowed") setMsgs((m) => [...m, { kind: "sys", text: "Allow microphone access in your browser to answer by voice." }]); };
    r.onend = () => setListening(false);
    rec.current = r;
    setListening(true);
    r.start();
  }

  // Read the live fee and minimum straight from the contract whenever the plan's chain changes.
  useEffect(() => {
    setFee(null); setMinLiq(null);
    const c = plan && CHAINS[plan.chain];
    if (!c || !isLive(c)) return;
    readLimits(createPublicClient({ chain: viemChain(c), transport: http(c.rpc) }) as any, c)
      .then(({ fee, minLiquidity }) => { setFee(fee); setMinLiq(minLiquidity); }).catch(() => {});
  }, [plan?.chain]);

  async function send(text: string) {
    text = text.trim();
    if (!text || busy) return;
    if (!signedIn) { setMsgs((m) => [...m, { kind: "sys", text: "Please sign in to talk with Autistik." }]); return; }
    setInput("");
    setMsgs((m) => [...m, { kind: "me", text }, { kind: "ai", text: "Autistik is thinking…", pending: true }]);
    turns.current.push({ role: "user", content: text });
    setBusy(true);
    try {
      const res = await fetch("/api/launchpad/agent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: turns.current, session: session.current }) });
      const data = await res.json().catch(() => ({}));
      if (typeof data.sessionsLeft === "number") setSessionsLeft(data.sessionsLeft);
      if (!res.ok) {
        turns.current.pop();
        setMsgs((m) => [...m.slice(0, -1), { kind: "sys", text: data.error || "Something went wrong. Try again." }]);
        return;
      }
      let memory = data.reply as string;
      if (data.plan) {
        const p = data.plan as LaunchPlan;
        setPlan(p); setAgree(false); setDone(null); setStatus("");
        memory += `\n\n[Launch plan shown to the creator: ${p.name} (${p.symbol}) on ${CHAINS[p.chain].name}, supply ${p.supply}, creator keeps ${p.creatorPercent}%, liquidity ${p.liquidity} ${CHAINS[p.chain].coin}, ${LOCKS[p.lock].short}]`;
      }
      turns.current.push({ role: "assistant", content: memory });
      setMsgs((m) => [...m.slice(0, -1), { kind: "ai", text: data.reply, born: Date.now() }]);
      say(data.reply);
    } catch {
      turns.current.pop();
      setMsgs((m) => [...m.slice(0, -1), { kind: "sys", text: "Couldn't reach Autistik. Check your connection." }]);
    } finally { setBusy(false); }
  }

  async function launch() {
    if (!plan) return;
    const c = CHAINS[plan.chain];
    const eth = (window as any).ethereum;
    if (!eth) { setStatus("No wallet found. Open this page in the browser inside MetaMask or Trust Wallet, or install MetaMask."); return; }
    setLaunching(true); setStatus("Check your wallet app…");
    try {
      const chain = viemChain(c);
      const wallet = createWalletClient({ chain, transport: custom(eth) });
      const pub = createPublicClient({ chain, transport: http(c.rpc) });
      const [account] = await wallet.requestAddresses();
      try { await wallet.switchChain({ id: c.chainId }); } catch { await wallet.addChain({ chain }); await wallet.switchChain({ id: c.chainId }); }

      const { fee: f, minLiquidity: m } = await readLimits(pub as any, c);
      const liquidity = parseEther(plan.liquidity);
      if (liquidity < m) { setStatus(`The pool needs at least ${formatEther(m)} ${c.coin}. Ask Autistik to change the amount.`); return; }

      // The Hub checks this wallet holds $20+ of AUTISTIK on BNB Chain and gives a 5-minute, one-use permit the contract checks.
      setStatus(`Checking this wallet holds at least $${MIN_HOLD_USD} of AUTISTIK…`);
      const er = await fetch("/api/launchpad/eligibility", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chain: c.key, wallet: account }) });
      const permit = await er.json().catch(() => ({}));
      if (!er.ok) { setStatus(permit.error || "Couldn't check your AUTISTIK balance. Try again."); say(permit.error || ""); return; }

      setStatus("Confirm the launch in your wallet…");
      const call = {
        account, address: c.launchpad!, abi: LAUNCHPAD_ABI, functionName: "launch",
        args: [{
          name: plan.name, symbol: plan.symbol, supply: BigInt(plan.supply) * 10n ** 18n,
          creatorBps: BigInt(Math.round(plan.creatorPercent * 100)), lockOption: LOCKS[plan.lock].option,
          permitDeadline: BigInt(permit.deadline || 0),
          // The fee shown now is the most this launch will pay, and it must happen within 20 minutes.
          maxFeeAccepted: f, deadline: BigInt(Math.floor(Date.now() / 1000) + 20 * 60),
        }, (permit.signature || "0x") as `0x${string}`],
        value: f + liquidity,
      } as const;
      // A launch creates two contracts in one go; some mobile wallets underestimate that, so add 25% headroom.
      const gas = ((await pub.estimateContractGas(call as any)) * 125n) / 100n;
      const hash = await wallet.writeContract({ ...call, chain, gas } as any);
      setStatus("Launching… this usually takes under a minute.");
      const receipt = await pub.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") { setStatus("The launch transaction failed. Nothing was created, but the network fee was spent."); return; }
      const ev = parseEventLogs({ abi: LAUNCHPAD_ABI, logs: receipt.logs, eventName: "Launched" })[0];
      if (!ev) { setStatus("Launched, but we couldn't read the result. Check your wallet's activity."); return; }
      const token = getAddress(ev.args.token), pair = getAddress(ev.args.pair);

      const res = await fetch("/api/launchpad/record", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chain: c.key, txHash: hash }) });
      const data = await res.json().catch(() => ({}));
      setDone({ token, pair, hash, listed: res.ok });
      setStatus("");
      say(`${plan.symbol} is live. Congratulations!`);
    } catch (e: any) {
      const reason = String(e?.shortMessage || e?.message || "");
      setStatus(/NotEligible|PermitExpired|PermitUsed/.test(reason)
        ? `The launch was refused: this wallet must hold at least $${MIN_HOLD_USD} of AUTISTIK. Press Launch again to re-check.`
        : /FeeTooHigh|TooLate/.test(reason) ? "The launch fee changed or the launch took too long. Nothing was launched. Press Launch again."
        : e?.shortMessage || "You cancelled in your wallet. Nothing was launched.");
    } finally { setLaunching(false); }
  }

  const c = plan ? CHAINS[plan.chain] : null;
  const creatorTokens = plan ? (BigInt(plan.supply) * BigInt(Math.round(plan.creatorPercent * 100))) / 10000n : 0n;

  return (
    <div className="stack">
      <div className="launch-modes" role="tablist" aria-label="How do you want to launch?">
        <button type="button" role="tab" className="sun" aria-selected={mode === "quick"} onClick={() => pickMode("quick")}>
          <span className="ln-icon" aria-hidden="true">⚡</span>
          <span className="ln-text"><b>Quick launch</b><small>One short form. Free and unlimited.</small></span>
        </button>
        <button type="button" role="tab" className="violet" aria-selected={mode === "ai"} onClick={() => pickMode("ai")}>
          <span className="ln-icon" aria-hidden="true">🤖</span>
          <span className="ln-text"><b>Launch with Autistik</b><small>Answer a few questions by text or voice. {AI_LAUNCH_SESSIONS} a day{sessionsLeft !== null ? ` · ${sessionsLeft} left today` : ""}.</small></span>
        </button>
      </div>
      <div className="kai lp">
        {mode === "quick" ? <QuickLaunch disabled={launching} onPlan={(p) => { setPlan(p); setAgree(false); setDone(null); setStatus(""); }} /> : (
        <div className="card chat lux launch-ai" data-c="autistik" data-mood="motivation">
          <div className="lux-top">
            <div className="lux-who"><button type="button" aria-selected="true" tabIndex={-1}><Bot /><span>Autistik · Launch Assistant</span></button></div>
            <span className="lux-online"><i />{talking ? "Speaking…" : "Assistant online"}</span>
            {canSpeak && (
              <button className="lux-icon" type="button" aria-pressed={voice} onClick={toggleVoice} title={voice ? "Autistik reads its questions aloud. Tap to turn off." : "Read questions aloud"}>
                {talking ? "🔊" : voice ? "🔉" : "🔈"}<span className="sr-only">Read questions aloud</span>
              </button>
            )}
            {msgs.length > 0 && (
              <button className="lux-icon" type="button" disabled={busy} title="Start over" onClick={() => { turns.current = []; newSession(); setMsgs([]); setPlan(null); setDone(null); setStatus(""); }}>
                ↺<span className="sr-only">Start over</span>
              </button>
            )}
          </div>
          <div className="msgs" ref={box} aria-live="polite">
            <div className="lux-hero launch-hello" data-small="1">
              <div className="lux-ring"><Art kind="robot" who="autistik" mood="motivation" className="lux-bot" /></div>
              <div className="lux-hello">
                <h2>Hi, I&apos;m <span className="lux-name">Autistik</span></h2>
                <p>Your launch assistant. I ask a few quick questions, build your launch plan, and you sign. 🚀</p>
                <span className="lux-here"><i />{sessionsLeft !== null ? `${sessionsLeft} of ${AI_LAUNCH_SESSIONS} launch chats left today` : "Ready to launch"}</span>
              </div>
            </div>
            <div className="msgrow"><Bot /><div className="msg ai paper">{HELLO}</div></div>
            {msgs.map((m, i) =>
              m.kind === "me" ? <div key={i} className="msg me">{m.text}</div>
              : m.kind === "sys" ? <div key={i} className="msg sys">{m.text}</div>
              : <div key={i} className="msgrow"><Bot />{m.pending ? <WritingNote name="Autistik" /> : <Handwritten text={m.text} done fresh={!!m.born && Date.now() - m.born < 20_000} />}</div>
            )}
            {listening && <div className="msg me listening">🎙️ {input || "Listening… speak now"}</div>}
          </div>
          {msgs.length === 0 && signedIn && (
            <div className="lux-moods" role="group" aria-label="Pick a chain to start">
              {Object.values(CHAINS).map((x) => (
                <button key={x.key} type="button" onClick={() => send(x.name)} disabled={busy}>🚀<span>{x.name}</span></button>
              ))}
            </div>
          )}
          <form className="lux-composer" onSubmit={(e) => { e.preventDefault(); send(input); }}>
            <textarea rows={1} value={input} onChange={(e) => setInput(e.target.value)} placeholder={signedIn ? "Answer Autistik…" : "Sign in to talk with Autistik"} aria-label="Message Autistik"
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }} />
            {canListen && (
              <button className={"lux-mic" + (listening ? " rec" : "")} type="button" aria-pressed={listening} onClick={listen} disabled={busy} title={listening ? "Stop" : "Answer by speaking"}>
                {listening ? <svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="2" /></svg> : <svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" /></svg>}
                <span className="sr-only">{listening ? "Stop" : "Answer by speaking"}</span>
              </button>
            )}
            <button className="lux-send" type="submit" disabled={busy} title="Send"><svg viewBox="0 0 24 24"><path d="M4 12 20 4l-6 16-3-7z" /><path d="m11 13 9-9" /></svg><span className="sr-only">Send</span></button>
          </form>
          <div className="lux-foot">Asks the questions · you sign · never asks for your seed phrase</div>
        </div>
        )}

        <div className="stack">
          {!signedIn && <div className="notice warn"><Link href="/login?next=/launchpad/new">Sign in</Link> or <Link href="/login?mode=join&next=/launchpad/new">create a free account</Link> to talk with Autistik.</div>}

          {done && c ? (
            <div className="card stack">
              <h3>🚀 {plan?.symbol} is live!</h3>
              <p className="muted" style={{ fontSize: ".9em" }}>Liquidity: {plan ? LOCKS[plan.lock].short.toLowerCase() : "locked"}. DexScreener usually shows the pair within a few minutes of the first trade.</p>
              <div className="field"><span>Token address</span><span className="mono" style={{ overflowWrap: "anywhere" }}>{done.token}</span></div>
              <div className="row" style={{ gap: 6 }}>
                <a className="btn small" href={dexscreenerUrl(c, done.pair, done.token)} target="_blank" rel="noopener noreferrer">DexScreener</a>
                {c.swapUrl(done.token) && <a className="btn small" href={c.swapUrl(done.token)} target="_blank" rel="noopener noreferrer">Trade on {c.dex}</a>}
                <a className="btn small" href={`${c.explorer}/tx/${done.hash}`} target="_blank" rel="noopener noreferrer">Transaction</a>
              </div>
              <a className="btn small" href="https://marketplace.dexscreener.com/product/token-info" target="_blank" rel="noopener noreferrer">Add logo &amp; links on DexScreener</a>
              {done.listed
                ? <Link className="btn primary" href={`/launchpad/${c.key}/${done.token}`}>Open token page &amp; make it trend 🔥</Link>
                : <span className="muted" style={{ fontSize: ".85em" }}>Your token is live, but we couldn&apos;t add it to the Hub list.</span>}
            </div>
          ) : plan && c ? (
            <div className="card stack" id="launch-plan">
              <h3>Launch plan</h3>
              <table><tbody>
                <tr><th>Chain</th><td>{c.name} · {c.dex}</td></tr>
                <tr><th>Token</th><td>{plan.name} (${plan.symbol})</td></tr>
                <tr><th>Supply</th><td className="num">{fmt(plan.supply)}</td></tr>
                <tr><th>You keep</th><td className="num">{plan.creatorPercent}% · {creatorTokens.toLocaleString("en-US")}</td></tr>
                <tr><th>Into the pool</th><td className="num">{(BigInt(plan.supply) - creatorTokens).toLocaleString("en-US")} + {plan.liquidity} {c.coin}</td></tr>
                <tr><th>Liquidity</th><td>{LOCKS[plan.lock].label}</td></tr>
                <tr><th>You must hold</th><td>${MIN_HOLD_USD}+ of AUTISTIK (BNB Chain), same wallet</td></tr>
                <tr><th>Launch fee</th><td className="num">{fee === null ? "…" : fee === 0n ? "Free" : `${formatEther(fee)} ${c.coin}`}</td></tr>
              </tbody></table>
              {minLiq !== null && parseEther(plan.liquidity) < minLiq && <div className="notice alert">The pool needs at least {formatEther(minLiq)} {c.coin}. Ask Autistik to change it.</div>}
              <div className="notice warn" style={{ fontSize: ".86em" }}>{LOCKS[plan.lock].explain} Token prices can go to zero.</div>
              <label className="row" style={{ gap: 8, alignItems: "flex-start", flexWrap: "nowrap", fontSize: ".9em" }}><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> <span>I understand {plan.lock === "burn" ? "the liquidity is burned forever" : `the liquidity is ${LOCKS[plan.lock].short.toLowerCase()}`}, my wallet must hold ${MIN_HOLD_USD}+ of AUTISTIK, and this is not financial advice.</span></label>
              <button className="btn primary" type="button" disabled={!agree || launching || fee === null} onClick={launch}>
                {launching ? "Launching…" : `Launch for ${fee === null ? "…" : formatEther(fee + parseEther(plan.liquidity))} ${c.coin} + gas`}
              </button>
              {status && <span className="muted" style={{ fontSize: ".88em" }}>{status}</span>}
            </div>
          ) : (
            <div className="card stack how-launch">
              <h3>📖 How it works</h3>
              <ol className="how-steps">
                <li><b>1</b><span>{mode === "ai" ? "Answer Autistik's questions (type or speak)." : "Fill in the short form above."}</span></li>
                <li><b>2</b><span>Check your launch plan.</span></li>
                <li><b>3</b><span>Sign once in your wallet.</span></li>
                <li><b>4</b><span>🚀 Your token is live on {Object.values(CHAINS).filter(isLive).map((x) => x.dex).join(", ") || "the DEX"}.</span></li>
              </ol>
              <p className="muted" style={{ fontSize: ".86em" }}>You need ${MIN_HOLD_USD}+ of AUTISTIK on BNB Chain. Liquidity is locked (6 months or 1 year) or burned forever, so it can&apos;t be pulled.</p>
            </div>
          )}
          <div className="notice alert" style={{ fontSize: ".86em" }}><b>Never</b> share your seed phrase or private key. Autistik will never ask for it.</div>
        </div>
      </div>
    </div>
  );
}

/** The launch form without AI: the same plan Autistik would prepare, filled in directly. */
function QuickLaunch({ onPlan, disabled }: { onPlan: (p: LaunchPlan) => void; disabled?: boolean }) {
  const live = Object.values(CHAINS).filter(isLive);
  const [f, setF] = useState({
    chain: (live[0]?.key ?? "bsc") as LaunchPlan["chain"], name: "", symbol: "", supply: "1000000000", creatorPercent: "5",
    liquidity: live[0]?.suggestedLiquidity ?? "0.5", lock: "burn" as LiquidityLock, description: "", website: "", x: "", telegram: "",
  });
  const [err, setErr] = useState("");
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const coin = CHAINS[f.chain]?.coin ?? "BNB";

  function review(e: React.FormEvent) {
    e.preventDefault();
    const r = checkPlan({ ...f, creatorPercent: Number(f.creatorPercent) });
    if ("error" in r) { setErr(r.error); return; }
    setErr("");
    onPlan(r.plan);
    setTimeout(() => document.getElementById("launch-plan")?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
  }

  if (!live.length) return <div className="card"><p className="muted">Launches open soon. No chain is live yet.</p></div>;
  return (
    <form className="card stack quick-launch" onSubmit={review}>
      <div><b>⚡ Quick launch</b><p className="muted" style={{ fontSize: ".88em" }}>Fill in the details, review your plan, then sign once in your wallet.</p></div>
      <div className="form-grid">
        <label className="field"><span>Chain</span>
          <select value={f.chain} onChange={(e) => { const c = CHAINS[e.target.value as LaunchPlan["chain"]]; setF({ ...f, chain: c.key, liquidity: c.suggestedLiquidity }); }}>
            {live.map((c) => <option key={c.key} value={c.key}>{c.name} · {c.dex}</option>)}
          </select>
        </label>
        <label className="field"><span>Token name</span><input value={f.name} onChange={set("name")} maxLength={32} placeholder="e.g. Calm Otter" required /></label>
        <label className="field"><span>Ticker</span><input value={f.symbol} onChange={set("symbol")} maxLength={13} placeholder="e.g. OTTER" required /></label>
        <label className="field"><span>Total supply</span><input value={f.supply} onChange={set("supply")} inputMode="numeric" required /></label>
        <label className="field"><span>Your share (0–{MAX_CREATOR_PERCENT}%)</span><input value={f.creatorPercent} onChange={set("creatorPercent")} inputMode="decimal" required /></label>
        <label className="field"><span>Liquidity ({coin})</span><input value={f.liquidity} onChange={set("liquidity")} inputMode="decimal" required /></label>
      </div>
      <fieldset className="lock-pick">
        <legend>Liquidity</legend>
        {(Object.keys(LOCKS) as LiquidityLock[]).map((k) => (
          <label key={k}><input type="radio" name="lock" value={k} checked={f.lock === k} onChange={() => setF({ ...f, lock: k })} /> {LOCKS[k].label}</label>
        ))}
      </fieldset>
      <details>
        <summary className="muted">Optional: description and links</summary>
        <div className="form-grid" style={{ marginTop: 8 }}>
          <label className="field"><span>One-line description</span><input value={f.description} onChange={set("description")} maxLength={500} /></label>
          <label className="field"><span>Website (https://…)</span><input value={f.website} onChange={set("website")} /></label>
          <label className="field"><span>X (https://…)</span><input value={f.x} onChange={set("x")} /></label>
          <label className="field"><span>Telegram (https://…)</span><input value={f.telegram} onChange={set("telegram")} /></label>
        </div>
      </details>
      {err && <div className="notice warn">{err}</div>}
      <button className="btn primary" type="submit" disabled={disabled}>Review launch plan</button>
    </form>
  );
}
