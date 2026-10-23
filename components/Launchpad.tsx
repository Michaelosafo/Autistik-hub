"use client";
import { pickWallet } from "@/lib/connect";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createPublicClient, createWalletClient, custom, formatEther, getAddress, http, parseEther, parseEventLogs } from "viem";
import { maleUtterance } from "@/lib/voice";
import { SolanaLaunch } from "@/components/SolanaLaunch";
import { AI_LAUNCH_SESSIONS, SOL_POOL_COST, isSolana, CHAINS, LAUNCHPAD_ABI, LAUNCH_TOKEN_ABI, LOCKS, MIN_HOLD_USD, dexscreenerUrl, isLive, liveChains, readLimits, viemChain, type LaunchPlan, checkPlan, MAX_CREATOR_PERCENT, MAX_TAX_PERCENT, type LiquidityLock, type Pads, type LaunchChain } from "@/lib/launchpad";
import { Handwritten, WritingNote } from "@/components/Handwriting";
import Art from "@/components/Art";
import { useStickToBottom } from "@/lib/use-stick-bottom";

type Msg = { kind: "me" | "ai" | "sys"; text: string; pending?: boolean; born?: number };
type Turn = { role: "user" | "assistant"; content: string };
type Done = { token: string; pair: string; hash: string; listed: boolean };

const HELLO = "Hi, I'm Autistik. Which chain would you like to launch on?";

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

/** `admin`: the Hub admin launches without holding any AUTISTIK (the Hub signs the permit without checking). */
export default function Launchpad({ signedIn, pads, admin = false }: { signedIn: boolean; pads: Pads; admin?: boolean }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const turns = useRef<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<LaunchPlan | null>(null);
  const [fee, setFee] = useState<bigint | null>(null);
  const [minLiq, setMinLiq] = useState<bigint | null>(null);
  const [maxWl, setMaxWl] = useState<bigint>(0n);
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
    if (!c || isSolana(c) || !isLive(c, pads)) return;
    readLimits(createPublicClient({ chain: viemChain(c), transport: http(c.rpc) }) as any, pads[c.key]!)
      .then(({ fee, minLiquidity, maxWhitelistNative }) => { setFee(fee); setMinLiq(minLiquidity); setMaxWl(maxWhitelistNative); }).catch(() => {});
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
    const eth = await pickWallet();
    if (!eth) return;
    setLaunching(true); setStatus("Check your wallet app…");
    try {
      const chain = viemChain(c);
      const wallet = createWalletClient({ chain, transport: custom(eth) });
      const pub = createPublicClient({ chain, transport: http(c.rpc) });
      const [account] = await wallet.requestAddresses();
      try { await wallet.switchChain({ id: c.chainId }); } catch { await wallet.addChain({ chain }); await wallet.switchChain({ id: c.chainId }); }

      const pad = pads[c.key]!;
      const { fee: f, minLiquidity: m, maxWhitelistNative } = await readLimits(pub as any, pad);
      // The liquidity amount includes the small launch contribution (about $3), which comes out of it.
      const liquidity = parseEther(plan.liquidity);
      const devBuy = parseEther(plan.devBuy || "0");
      if (liquidity < f + m) { setStatus(`The pool needs at least ${formatEther(f + m)} ${c.coin} (including the ${formatEther(f)} ${c.coin} launch contribution).`); return; }

      // The Hub checks this wallet holds $20+ of AUTISTIK on BNB Chain and gives a 5-minute, one-use permit the contract checks.
      setStatus(admin ? "Getting your admin launch permit…" : `Checking this wallet holds at least $${MIN_HOLD_USD} of AUTISTIK…`);
      const er = await fetch("/api/launchpad/eligibility", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chain: c.key, wallet: account }) });
      const permit = await er.json().catch(() => ({}));
      if (!er.ok) { setStatus(permit.error || "Couldn't check your AUTISTIK balance. Try again."); say(permit.error || ""); return; }

      setStatus("Confirm the launch in your wallet…");
      const call = {
        account, address: pad, abi: LAUNCHPAD_ABI, functionName: "launch",
        args: [{
          name: plan.name, symbol: plan.symbol, supply: BigInt(plan.supply) * 10n ** 18n,
          creatorBps: BigInt(Math.round(plan.creatorPercent * 100)), devBuyNative: devBuy,
          buyTax: BigInt(Math.round(plan.buyTax * 100)), sellTax: BigInt(Math.round(plan.sellTax * 100)),
          taxWallet: (plan.taxWallet || "0x0000000000000000000000000000000000000000") as `0x${string}`,
          whitelist: plan.whitelist as `0x${string}`[], whitelistNative: plan.whitelist.length ? maxWhitelistNative : 0n,
          lockOption: LOCKS[plan.lock].option,
          permitDeadline: BigInt(permit.deadline || 0),
          // The contribution shown now is the most this launch will pay, and it must happen within 20 minutes.
          maxFeeAccepted: f, deadline: BigInt(Math.floor(Date.now() / 1000) + 20 * 60),
        }, (permit.signature || "0x") as `0x${string}`],
        value: liquidity + devBuy,
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
        : /FeeTooHigh|TooLate/.test(reason) ? "The launch contribution changed or the launch took too long. Nothing was launched. Press Launch again."
        : /CreatorShareTooHigh/.test(reason) ? `Your share plus your first buy would be over ${MAX_CREATOR_PERCENT}% of the supply. Lower one of them.`
        : /WhitelistTooBig/.test(reason) ? "The whitelist limit just changed. Press Launch again."
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
        {mode === "quick" ? <QuickLaunch pads={pads} disabled={launching} onPlan={(p) => { setPlan(p); setAgree(false); setDone(null); setStatus(""); }} /> : (
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
              {liveChains(pads).map((x) => (
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
              {!isSolana(c) && <StartTrading c={c} token={done.token} />}
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
          ) : plan && c && isSolana(c) ? (
            <div className="card stack" id="launch-plan">
              <h3>Launch plan</h3>
              <table><tbody>
                <tr><th>Chain</th><td>{c.name} · {c.dex}</td></tr>
                <tr><th>Token</th><td>{plan.name} (${plan.symbol})</td></tr>
                <tr><th>Supply</th><td className="num">{fmt(plan.supply)} · fixed: minting and freezing switched off</td></tr>
                <tr><th>You keep</th><td className="num">{plan.creatorPercent}% · {creatorTokens.toLocaleString("en-US")}</td></tr>
                <tr><th>Into the pool</th><td className="num">{(BigInt(plan.supply) - creatorTokens).toLocaleString("en-US")} + {plan.liquidity} SOL</td></tr>
                <tr><th>Liquidity</th><td>LP tokens burned forever</td></tr>
                <tr><th>Tax</th><td>No tax</td></tr>
                <tr><th>Trading</th><td>Opens as soon as the pool exists</td></tr>
                <tr><th>Fees</th><td>About {SOL_POOL_COST} SOL: Raydium&apos;s pool fee (≈0.15 SOL) plus network fees</td></tr>
              </tbody></table>
              <div className="notice warn" style={{ fontSize: ".86em" }}>{LOCKS.burn.explain} You sign three times: the token, the pool, then the burn. Token prices can go to zero.</div>
              <label className="row" style={{ gap: 8, alignItems: "flex-start", flexWrap: "nowrap", fontSize: ".9em" }}><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> <span>I understand the liquidity is burned forever and I can&apos;t take it back.</span></label>
              <SolanaLaunch plan={plan} agree={agree} onDone={(d) => { setDone(d); say(`${plan.symbol} is live. Congratulations!`); }} />
            </div>
          ) : plan && c ? (
            <div className="card stack" id="launch-plan">
              <h3>Launch plan</h3>
              <table><tbody>
                <tr><th>Chain</th><td>{c.name} · {c.dex}</td></tr>
                <tr><th>Token</th><td>{plan.name} (${plan.symbol})</td></tr>
                <tr><th>Supply</th><td className="num">{fmt(plan.supply)}</td></tr>
                <tr><th>You keep</th><td className="num">{plan.creatorPercent}% · {creatorTokens.toLocaleString("en-US")}</td></tr>
                {Number(plan.devBuy) > 0 && <tr><th>Your first buy</th><td className="num">{plan.devBuy} {c.coin}, before anyone else (you + first buy max {MAX_CREATOR_PERCENT}%)</td></tr>}
                <tr><th>Into the pool</th><td className="num">{(BigInt(plan.supply) - creatorTokens).toLocaleString("en-US")} + {fee === null ? plan.liquidity : formatEther(parseEther(plan.liquidity) - fee)} {c.coin}</td></tr>
                <tr><th>Liquidity</th><td>{LOCKS[plan.lock].label}</td></tr>
                <tr><th>Tax</th><td>{plan.buyTax || plan.sellTax ? `${plan.buyTax}% buy · ${plan.sellTax}% sell → ${plan.taxWallet.slice(0, 6)}…${plan.taxWallet.slice(-4)} (can only be lowered later)` : "No tax"}</td></tr>
                <tr><th>Whitelist</th><td>{plan.whitelist.length ? `${plan.whitelist.length} wallet${plan.whitelist.length > 1 ? "s" : ""} may buy up to ${maxWl ? formatEther(maxWl) : "…"} ${c.coin} (≈$40) each before trading opens` : "None"}</td></tr>
                <tr><th>Trading</th><td>Starts when you press Start trading (opens by itself after 24h). First 5 minutes: max 1% of supply per buy.</td></tr>
                <tr><th>You must hold</th><td>{admin ? "Nothing: admin launch" : `$${MIN_HOLD_USD}+ of AUTISTIK (BNB Chain), same wallet`}</td></tr>
                <tr><th>Launch</th><td className="num">Free · {fee === null ? "…" : `${formatEther(fee)} ${c.coin}`} (≈$3) comes out of your liquidity</td></tr>
                <tr><th>Trade fee</th><td>0.3% on buys and sells, supports AUTISTIK</td></tr>
              </tbody></table>
              {minLiq !== null && fee !== null && parseEther(plan.liquidity) < minLiq + fee && <div className="notice alert">The pool needs at least {formatEther(minLiq + fee)} {c.coin}. Change the liquidity amount.</div>}
              <div className="notice warn" style={{ fontSize: ".86em" }}>{LOCKS[plan.lock].explain} Token prices can go to zero.</div>
              <label className="row" style={{ gap: 8, alignItems: "flex-start", flexWrap: "nowrap", fontSize: ".9em" }}><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> <span>I understand {plan.lock === "burn" ? "the liquidity is burned forever" : `the liquidity is ${LOCKS[plan.lock].short.toLowerCase()}`}{admin ? "" : `, my wallet must hold $${MIN_HOLD_USD}+ of AUTISTIK`}, and this is not financial advice.</span></label>
              <button className="btn primary" type="button" disabled={!agree || launching || fee === null} onClick={launch}>
                {launching ? "Launching…" : `Launch for ${formatEther(parseEther(plan.liquidity) + parseEther(plan.devBuy || "0"))} ${c.coin} + gas`}
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
                <li><b>4</b><span>🚀 Press Start trading. Your token is live on {[...new Set(liveChains(pads).map((x) => x.dex))].join(", ") || "the DEX"}.</span></li>
              </ol>
              <p className="muted" style={{ fontSize: ".86em" }}>Free to launch. {admin ? "Admin: no AUTISTIK needed, launch as many as you like." : `You need $${MIN_HOLD_USD}+ of AUTISTIK on BNB Chain.`} Liquidity is locked in the AUTISTIK Locker (6 months or 1 year) or burned forever, so it can&apos;t be pulled. No blacklist, tax max {MAX_TAX_PERCENT}%, anti-sniper protection.</p>
            </div>
          )}
          <div className="notice alert" style={{ fontSize: ".86em" }}><b>Never</b> share your seed phrase or private key. Autistik will never ask for it.</div>
        </div>
      </div>
    </div>
  );
}

/** The launch form without AI: the same plan Autistik would prepare, filled in directly. */
function QuickLaunch({ onPlan, disabled, pads }: { onPlan: (p: LaunchPlan) => void; disabled?: boolean; pads: Pads }) {
  const live = liveChains(pads);
  const [f, setF] = useState({
    chain: (live[0]?.key ?? "bsc") as LaunchPlan["chain"], name: "", symbol: "", supply: "1000000000", creatorPercent: "5",
    liquidity: "", lock: "burn" as LiquidityLock, description: "", website: "", x: "", telegram: "",
    buyTax: "0", sellTax: "0", taxWallet: "", wl1: "", wl2: "", wl3: "", devBuy: "0",
  });
  const [err, setErr] = useState("");
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const coin = CHAINS[f.chain]?.coin ?? "BNB";
  const sol = isSolana(CHAINS[f.chain]);

  function review(e: React.FormEvent) {
    e.preventDefault();
    const r = checkPlan({ ...f, creatorPercent: Number(f.creatorPercent), buyTax: Number(f.buyTax || 0), sellTax: Number(f.sellTax || 0), whitelist: [f.wl1, f.wl2, f.wl3] }, pads);
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
          <select value={f.chain} onChange={(e) => { const c = CHAINS[e.target.value as LaunchPlan["chain"]]; setF({ ...f, chain: c.key }); }}>
            {live.map((c) => <option key={c.key} value={c.key}>{c.name} · {c.dex}</option>)}
          </select>
        </label>
        <label className="field"><span>Token name</span><input value={f.name} onChange={set("name")} maxLength={32} placeholder="e.g. Calm Otter" required /></label>
        <label className="field"><span>Ticker</span><input value={f.symbol} onChange={set("symbol")} maxLength={13} placeholder="e.g. OTTER" required /></label>
        <label className="field"><span>Total supply</span><input value={f.supply} onChange={set("supply")} inputMode="numeric" required /></label>
        <label className="field"><span>Your free share (0–20%)</span><input value={f.creatorPercent} onChange={set("creatorPercent")} inputMode="decimal" required /></label>
        <label className="field"><span>Liquidity ({coin}{sol ? "" : ", incl. ≈$3 launch contribution"})</span><input value={f.liquidity} onChange={set("liquidity")} inputMode="decimal" placeholder={`Any amount, e.g. ${CHAINS[f.chain]?.suggestedLiquidity ?? "0.1"}`} required /></label>
      </div>
      {sol ? <div className="notice" style={{ fontSize: ".88em" }}>Solana: a standard token with a fixed supply, a Raydium pool, and the LP tokens burned forever. No tax, whitelist or first buy. Raydium charges about 0.15 SOL to create the pool. Its address ends in <b className="mono">tik</b>, the AUTISTIK mark.</div> : <>
      <fieldset className="stack" style={{ gap: 8, border: "1px solid var(--line)", borderRadius: 12, padding: "10px 12px" }}>
        <legend style={{ padding: "0 6px" }}><b>Tax</b> <span className="muted" style={{ fontSize: ".85em" }}>optional, max {MAX_TAX_PERCENT}%, can only be lowered later</span></legend>
        <div className="form-grid">
          <label className="field"><span>Buy tax %</span><input value={f.buyTax} onChange={set("buyTax")} inputMode="decimal" /></label>
          <label className="field"><span>Sell tax %</span><input value={f.sellTax} onChange={set("sellTax")} inputMode="decimal" /></label>
          <label className="field" style={{ gridColumn: "1 / -1" }}><span>Tax wallet (receives the tax)</span><input value={f.taxWallet} onChange={set("taxWallet")} placeholder="0x…" spellCheck={false} /></label>
        </div>
      </fieldset>
      <details>
        <summary><b>Whitelist & first buy</b> <span className="muted" style={{ fontSize: ".85em" }}>optional</span></summary>
        <div className="stack" style={{ gap: 8, marginTop: 8 }}>
          <p className="muted" style={{ margin: 0, fontSize: ".86em" }}>Up to 3 wallets may buy (about $40 each) before trading opens. Your first buy happens at launch, before anyone else. Your share + first buy can be at most {MAX_CREATOR_PERCENT}% of the supply.</p>
          <div className="form-grid">
            <label className="field"><span>Whitelist wallet 1</span><input value={f.wl1} onChange={set("wl1")} placeholder="0x…" spellCheck={false} /></label>
            <label className="field"><span>Whitelist wallet 2</span><input value={f.wl2} onChange={set("wl2")} placeholder="0x…" spellCheck={false} /></label>
            <label className="field"><span>Whitelist wallet 3</span><input value={f.wl3} onChange={set("wl3")} placeholder="0x…" spellCheck={false} /></label>
            <label className="field"><span>Your first buy ({coin})</span><input value={f.devBuy} onChange={set("devBuy")} inputMode="decimal" /></label>
          </div>
        </div>
      </details>
      <fieldset className="lock-pick">
        <legend>Liquidity</legend>
        {(Object.keys(LOCKS) as LiquidityLock[]).map((k) => (
          <label key={k}><input type="radio" name="lock" value={k} checked={f.lock === k} onChange={() => setF({ ...f, lock: k })} /> {LOCKS[k].label}</label>
        ))}
      </fieldset>
      </>}
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

/** After launch: the creator opens trading (it also opens by itself after 24 hours). */
function StartTrading({ c, token }: { c: LaunchChain; token: string }) {
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  async function start() {
    const eth = await pickWallet();
    if (!eth) return;
    setBusy(true); setMsg("Confirm in your wallet…");
    try {
      const chain = viemChain(c);
      const wallet = createWalletClient({ chain, transport: custom(eth) });
      const pub = createPublicClient({ chain, transport: custom(eth) });
      const [account] = await wallet.requestAddresses();
      const hash = await wallet.writeContract({ account, chain, address: token as `0x${string}`, abi: LAUNCH_TOKEN_ABI, functionName: "openTrading" } as any);
      await pub.waitForTransactionReceipt({ hash });
      setOpen(true); setMsg("✅ Trading is open. For the first 5 minutes each buy is limited, to stop sniper bots.");
    } catch (e: any) {
      setMsg(/AlreadyOpen/.test(String(e?.message)) ? "Trading is already open." : /NotOwner/.test(String(e?.message)) ? "Only the wallet that launched the token can start trading." : e?.shortMessage || "You cancelled in your wallet.");
    } finally { setBusy(false); }
  }
  return (
    <div className="notice" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <span><b>Next: start trading.</b> Until you do, only your whitelisted wallets can buy. It opens by itself after 24 hours.</span>
      {!open && <button className="btn primary" type="button" disabled={busy} onClick={start}>{busy ? "Starting…" : "▶ Start trading"}</button>}
      {msg && <small className="muted">{msg}</small>}
    </div>
  );
}
