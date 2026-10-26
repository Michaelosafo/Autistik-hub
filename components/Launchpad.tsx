"use client";
import { pickWallet } from "@/lib/connect";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import NetIcon from "@/components/connect/NetIcon";
import PhotoCrop from "@/components/PhotoCrop";
import { supabaseBrowser } from "@/lib/supabase/client";
import { NETWORKS, type Net } from "@/lib/connect";
import { createPublicClient, createWalletClient, custom, formatEther, getAddress, http, parseEther, parseEventLogs } from "viem";
import { maleUtterance } from "@/lib/voice";
import { SolanaLaunch } from "@/components/SolanaLaunch";
import { AI_LAUNCH_SESSIONS, SOL_POOL_COST, isSolana, solLaunchFee, CHAINS, LAUNCHPAD_ABI, LAUNCHPAD_V3_ABI, LAUNCHPAD_V4_ABI, NATIVE_REWARD, rewardChoices, LAUNCH_TOKEN_ABI, LOCKS, MIN_HOLD_USD, dexscreenerUrl, isLive, SOL_REWARD_TOKENS, solTradeFeeBps, liveChains, readLimits, viemChain, type LaunchPlan, checkPlan, MAX_CREATOR_PERCENT, MAX_TAX_PERCENT, lockExplain, solLockerProgram, type LiquidityLock, type Pads, type LaunchChain, type ChainKey } from "@/lib/launchpad";
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
export default function Launchpad({ signedIn, pads, versions = {}, admin = false }: { signedIn: boolean; pads: Pads; versions?: Partial<Record<ChainKey, number>>; admin?: boolean }) {
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
      setStatus(admin ? "Getting your admin launch permit and your token address…" : `Checking this wallet holds at least $${MIN_HOLD_USD} of AUTISTIK…`);
      const er = await fetch("/api/launchpad/eligibility", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chain: c.key, wallet: account, name: plan.name, symbol: plan.symbol }) });
      const permit = await er.json().catch(() => ({}));
      if (!er.ok) { setStatus(permit.error || "Couldn't check your AUTISTIK balance. Try again."); say(permit.error || ""); return; }

      // Launch Pad v3: the Hub picked a salt that gives the token an address ending in "aaaaa", signed into the permit.
      const salt = /^0x[0-9a-fA-F]{64}$/.test(String(permit.salt || "")) ? (permit.salt as `0x${string}`) : null;
      // Launch Pad v4 adds holder rewards (its launch() takes two more fields).
      const v4 = salt && Number(permit.padVersion) >= 4;
      if (plan.reward && !v4) { setStatus(`Holder rewards aren't open on ${c.name} yet. Remove them to launch now, or try again soon.`); return; }
      const rewardToken = (plan.reward === "native" ? NATIVE_REWARD : plan.reward || "0x0000000000000000000000000000000000000000") as `0x${string}`;
      if (v4 && plan.reward && plan.reward !== "native") {
        const ok = await pub.readContract({ address: pad, abi: LAUNCHPAD_V4_ABI, functionName: "rewardAllowed", args: [rewardToken] } as any).catch(() => false);
        if (!ok) { setStatus("That reward token isn't approved on the Launch Pad yet. Pick the coin, BTC or ETH, or ask the AUTISTIK team to approve it."); return; }
      }
      setStatus(salt && permit.token ? `Your token's address will be ${String(permit.token).slice(0, 8)}…${String(permit.token).slice(-8)}. Confirm the launch in your wallet…` : "Confirm the launch in your wallet…");
      const call = {
        account, address: pad, abi: v4 ? LAUNCHPAD_V4_ABI : salt ? LAUNCHPAD_V3_ABI : LAUNCHPAD_ABI, functionName: "launch",
        args: [{
          name: plan.name, symbol: plan.symbol, supply: BigInt(plan.supply) * 10n ** 18n,
          creatorBps: BigInt(Math.round(plan.creatorPercent * 100)), devBuyNative: devBuy,
          buyTax: BigInt(Math.round(plan.buyTax * 100)), sellTax: BigInt(Math.round(plan.sellTax * 100)),
          taxWallet: (plan.taxWallet || "0x0000000000000000000000000000000000000000") as `0x${string}`,
          whitelist: plan.whitelist as `0x${string}`[], whitelistNative: plan.whitelist.length ? maxWhitelistNative : 0n,
          lockOption: LOCKS[plan.lock].option,
          ...(v4 && { rewardToken: plan.reward ? rewardToken : ("0x0000000000000000000000000000000000000000" as `0x${string}`), holderBps: plan.reward ? BigInt(Math.round((plan.holderPercent ?? 0) * 100)) : 0n }),
          permitDeadline: BigInt(permit.deadline || 0),
          // The contribution shown now is the most this launch will pay, and it must happen within 20 minutes.
          maxFeeAccepted: f, deadline: BigInt(Math.floor(Date.now() / 1000) + 20 * 60),
          ...(salt && { salt }),
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

      const res = await fetch("/api/launchpad/record", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chain: c.key, txHash: hash, logo: plan.logo }) });
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
        : /RewardNotAllowed/.test(reason) ? "That reward token isn't approved on the Launch Pad. Pick another reward."
        : e?.shortMessage || "You cancelled in your wallet. Nothing was launched.");
    } finally { setLaunching(false); }
  }

  const c = plan ? CHAINS[plan.chain] : null;
  const creatorTokens = plan ? (BigInt(plan.supply) * BigInt(Math.round(plan.creatorPercent * 100))) / 10000n : 0n;

  return (
    <div className="stack">
      <div className="launch-modes" role="tablist" aria-label="How do you want to launch?">
        <button type="button" role="tab" className="sun" aria-selected={mode === "quick"} onClick={() => pickMode("quick")}>
          
          <span className="ln-text"><b>Quick launch</b><small>One short form. Free and unlimited.</small></span>
        </button>
        <button type="button" role="tab" className="violet" aria-selected={mode === "ai"} onClick={() => pickMode("ai")}>
          
          <span className="ln-text"><b>Launch with Autistik</b><small>Answer a few questions by text or voice. {AI_LAUNCH_SESSIONS} a day{sessionsLeft !== null ? ` · ${sessionsLeft} left today` : ""}.</small></span>
        </button>
      </div>
      <div className="kai lp">
        {mode === "quick" ? <QuickLaunch pads={pads} versions={versions} disabled={launching} onPlan={(p) => { setPlan(p); setAgree(false); setDone(null); setStatus(""); }} /> : (
        <div className="card chat lux launch-ai" data-c="autistik" data-mood="motivation">
          <div className="lux-top">
            <div className="lux-who"><button type="button" aria-selected="true" tabIndex={-1}><Bot /><span>Autistik · Launch Assistant</span></button></div>
            <span className="lux-online"><i />{talking ? "Speaking…" : "Assistant online"}</span>
            {canSpeak && (
              <button className="lux-icon" type="button" aria-pressed={voice} onClick={toggleVoice} title={voice ? "Autistik reads its questions aloud. Tap to turn off." : "Read questions aloud"}>
                {talking ? "Stop" : voice ? "Voice on" : "Voice"}<span className="sr-only">Read questions aloud</span>
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
                <p>Your launch assistant. I ask a few quick questions, build your launch plan, and you sign.</p>
                <span className="lux-here"><i />{sessionsLeft !== null ? `${sessionsLeft} of ${AI_LAUNCH_SESSIONS} launch chats left today` : "Ready to launch"}</span>
              </div>
            </div>
            <div className="msgrow"><Bot /><div className="msg ai paper">{HELLO}</div></div>
            {msgs.map((m, i) =>
              m.kind === "me" ? <div key={i} className="msg me">{m.text}</div>
              : m.kind === "sys" ? <div key={i} className="msg sys">{m.text}</div>
              : <div key={i} className="msgrow"><Bot />{m.pending ? <WritingNote name="Autistik" /> : <Handwritten text={m.text} done fresh={!!m.born && Date.now() - m.born < 20_000} />}</div>
            )}
            {listening && <div className="msg me listening">{input || "Listening… speak now"}</div>}
          </div>
          {msgs.length === 0 && signedIn && (
            <div className="lux-moods" role="group" aria-label="Pick a chain to start">
              {liveChains(pads).map((x) => (
                <button key={x.key} type="button" onClick={() => send(x.name)} disabled={busy}><span>{x.name}</span></button>
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
              <h3>{plan?.symbol} is live!</h3>
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
                ? <Link className="btn primary" href={`/launchpad/${c.key}/${done.token}`}>Open token page &amp; make it trend</Link>
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
                <tr><th>Liquidity</th><td>{plan.lock === "burn" ? "LP tokens burned forever" : `LP tokens ${LOCKS[plan.lock].short.toLowerCase()} in the AUTISTIK Solana Locker`}</td></tr>
                <tr><th>Fee</th><td>{plan.reward ? `${plan.buyTax}% on every trade and transfer (plus the ${solTradeFeeBps() / 100}% AUTISTIK fee). Fixed forever.` : "No tax"}</td></tr>
                {plan.reward && <tr><th>Holder rewards</th><td>{plan.holderPercent}% of your fee buys {SOL_REWARD_TOKENS[plan.reward]?.symbol} for every holder, by how much they hold, sent about every 10 minutes (holders can also claim on the coin&apos;s page). The other {+(100 - (plan.holderPercent ?? 0)).toFixed(2)}% goes to {plan.taxWallet.slice(0, 4)}…{plan.taxWallet.slice(-4)} in your coin.</td></tr>}
                <tr><th>Trading</th><td>Opens as soon as the pool exists</td></tr>
                <tr><th>Fees</th><td>About {+(SOL_POOL_COST + solLaunchFee()).toFixed(3)} SOL: Raydium&apos;s pool fee (≈0.15 SOL), network fees{solLaunchFee() ? <> and the {solLaunchFee()} SOL AUTISTIK launch fee (to marketing)</> : null}</td></tr>
              </tbody></table>
              <div className="notice warn" style={{ fontSize: ".86em" }}>{lockExplain(plan.lock, true)} You sign three times: the token, the pool, then the {plan.lock === "burn" ? "burn" : "lock"}. Token prices can go to zero.</div>
              <label className="row" style={{ gap: 8, alignItems: "flex-start", flexWrap: "nowrap", fontSize: ".9em" }}><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> <span>{plan.lock === "burn" ? <>I understand the liquidity is burned forever and I can&apos;t take it back.</> : <>I understand the liquidity is {LOCKS[plan.lock].short.toLowerCase()} and nobody, including me, can take it out before then.</>}</span></label>
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
                {plan.reward && <tr><th>Holder rewards</th><td>{plan.holderPercent}% of the tax buys {rewardName(c, plan.reward)} for every holder, by how much they hold. Paid automatically as people trade; holders can also claim any time. The other {+(100 - (plan.holderPercent ?? 0)).toFixed(2)}% goes to your tax wallet. Fixed at launch.</td></tr>}
                <tr><th>Whitelist</th><td>{plan.whitelist.length ? `${plan.whitelist.length} wallet${plan.whitelist.length > 1 ? "s" : ""} may buy up to ${maxWl ? formatEther(maxWl) : "…"} ${c.coin} (≈$40) each before trading opens` : "None"}</td></tr>
                <tr><th>Trading</th><td>Starts when you press Start trading (opens by itself after 24h). First 5 minutes: max 1% of supply per buy.</td></tr>
                <tr><th>You must hold</th><td>{admin ? "Nothing: admin launch" : `$${MIN_HOLD_USD}+ of AUTISTIK (BNB Chain), same wallet`}</td></tr>
                <tr><th>Launch</th><td className="num">Free · {fee === null ? "…" : `${formatEther(fee)} ${c.coin}`} (≈$3) comes out of your liquidity</td></tr>
                <tr><th>Trade fee</th><td>0.3% on buys and sells, supports AUTISTIK</td></tr>
              </tbody></table>
              {minLiq !== null && fee !== null && parseEther(plan.liquidity) < minLiq + fee && <div className="notice alert">The pool needs at least {formatEther(minLiq + fee)} {c.coin}. Change the liquidity amount.</div>}
              <div className="notice warn" style={{ fontSize: ".86em" }}>{lockExplain(plan.lock, isSolana(c))} Token prices can go to zero.</div>
              <label className="row" style={{ gap: 8, alignItems: "flex-start", flexWrap: "nowrap", fontSize: ".9em" }}><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> <span>I understand {plan.lock === "burn" ? "the liquidity is burned forever" : `the liquidity is ${LOCKS[plan.lock].short.toLowerCase()}`}{admin ? "" : `, my wallet must hold $${MIN_HOLD_USD}+ of AUTISTIK`}, and this is not financial advice.</span></label>
              <button className="btn primary" type="button" disabled={!agree || launching || fee === null} onClick={launch}>
                {launching ? "Launching…" : `Launch for ${formatEther(parseEther(plan.liquidity) + parseEther(plan.devBuy || "0"))} ${c.coin} + gas`}
              </button>
              {status && <span className="muted" style={{ fontSize: ".88em" }}>{status}</span>}
            </div>
          ) : (
            <div className="card stack how-launch">
              <h3>How it works</h3>
              <ol className="how-steps">
                <li><b>1</b><span>{mode === "ai" ? "Answer Autistik's questions (type or speak)." : "Fill in the short form above."}</span></li>
                <li><b>2</b><span>Check your launch plan.</span></li>
                <li><b>3</b><span>Sign once in your wallet.</span></li>
                <li><b>4</b><span>Press Start trading. Your token is live on {[...new Set(liveChains(pads).map((x) => x.dex))].join(", ") || "the DEX"}.</span></li>
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
/** The holders' reward as people read it: "BNB", "BTC", or a shortened address. */
function rewardName(c: LaunchChain, reward: string) {
  const k = rewardChoices(c).find((x) => x.key.toLowerCase() === reward.toLowerCase());
  return k ? k.symbol : `${reward.slice(0, 6)}…${reward.slice(-4)}`;
}

function QuickLaunch({ onPlan, disabled, pads, versions = {} }: { onPlan: (p: LaunchPlan) => void; disabled?: boolean; pads: Pads; versions?: Partial<Record<ChainKey, number>> }) {
  const live = liveChains(pads);
  const [f, setF] = useState({
    chain: (live[0]?.key ?? "bsc") as LaunchPlan["chain"], name: "", symbol: "", supply: "1000000000", creatorPercent: "5",
    liquidity: "", lock: "burn" as LiquidityLock, description: "", website: "", x: "", telegram: "",
    buyTax: "0", sellTax: "0", taxWallet: "", wl1: "", wl2: "", wl3: "", devBuy: "0", logo: "",
    reward: "", rewardOther: "", holderPercent: "50",
  });
  // The token's picture: picked, fitted into a square, uploaded to the Hub's token-logos storage.
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoBusy, setLogoBusy] = useState("");
  const logoInput = useRef<HTMLInputElement>(null);
  async function uploadLogo(blob: Blob) {
    setLogoFile(null); setLogoBusy("Uploading…");
    try {
      const sb = supabaseBrowser();
      const { data: { user } } = await sb.auth.getUser();
      if (!user) throw new Error("Sign in to add a picture.");
      const path = `${user.id}/logo-${Date.now()}.webp`;
      const { error } = await sb.storage.from("token-logos").upload(path, blob, { contentType: "image/webp" });
      if (error) throw new Error(error.message);
      setF((x) => ({ ...x, logo: sb.storage.from("token-logos").getPublicUrl(path).data.publicUrl }));
      setLogoBusy("");
    } catch (e: any) { setLogoBusy(e?.message?.includes("Sign in") ? e.message : "Couldn't upload that picture. Try another one."); }
  }
  // Each name and ticker launches only once here: checked while typing.
  const [taken, setTaken] = useState<{ name: boolean; symbol: boolean } | null>(null);
  useEffect(() => {
    setTaken(null);
    if (!f.name.trim() && !f.symbol.trim()) return;
    const t = setTimeout(() => {
      fetch(`/api/launchpad/name-check?name=${encodeURIComponent(f.name)}&symbol=${encodeURIComponent(f.symbol)}`).then((r) => r.json()).then(setTaken).catch(() => {});
    }, 400);
    return () => clearTimeout(t);
  }, [f.name, f.symbol]);
  const [err, setErr] = useState("");
  // Rewards differ per chain: start again when the chain changes.
  useEffect(() => { setF((x) => ({ ...x, reward: "", rewardOther: "", buyTax: "0", sellTax: "0", taxWallet: "" })); }, [f.chain]);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const coin = CHAINS[f.chain]?.coin ?? "BNB";
  const sol = isSolana(CHAINS[f.chain]);

  function review(e: React.FormEvent) {
    e.preventDefault();
    const reward = f.reward === "other" ? f.rewardOther.trim() : f.reward;
    const r = checkPlan({ ...f, creatorPercent: Number(f.creatorPercent), buyTax: Number(f.buyTax || 0), sellTax: Number(f.sellTax || 0), whitelist: [f.wl1, f.wl2, f.wl3], reward, holderPercent: Number(f.holderPercent || 0) }, pads);
    if ("error" in r) { setErr(r.error); return; }
    if (taken?.name || taken?.symbol) { setErr(taken.name ? "That name was already launched here. Pick another name." : "That ticker was already launched here. Pick another ticker."); return; }
    setErr("");
    onPlan(r.plan);
    setTimeout(() => document.getElementById("launch-plan")?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
  }

  if (!live.length) return <div className="card"><p className="muted">Launches open soon. No chain is live yet.</p></div>;
  const ch = CHAINS[f.chain];
  const net = (k: string, name: string): Net => NETWORKS.find((n) => n.key === k) ?? { key: k, id: 0, name, short: name, color: "#8E7CC3" };
  // Live numbers for the preview (approximate: the EVM launch contribution of ≈$3 comes out of the liquidity).
  const supplyN = Number(f.supply) || 0, share = Math.min(20, Math.max(0, Number(f.creatorPercent) || 0)), liqN = Number(f.liquidity) || 0;
  const poolTokens = supplyN * (1 - share / 100);
  const price = poolTokens > 0 && liqN > 0 ? liqN / poolTokens : 0;
  const mcap = price * supplyN;
  const num = (n: number) => n >= 1e9 ? `${+(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${+(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${+(n / 1e3).toFixed(2)}K` : `${+n.toFixed(4)}`;
  const tiny = (n: number) => (n === 0 ? "–" : n < 1e-6 ? n.toExponential(2) : n.toPrecision(3));
  const lp = LOCKS[f.lock];
  const LIQ = sol ? ["0.5", "1", "2", "5"] : f.chain === "bsc" ? ["0.1", "0.25", "0.5", "1"] : ["0.02", "0.05", "0.1", "0.25"];
  const checks: [boolean, string][] = [
    [true, "Fixed supply: nobody can mint more"],
    [true, f.lock === "burn" ? "Liquidity burned forever" : `Liquidity ${lp.short.toLowerCase()}`],
    [true, sol ? "Mint and freeze switched off" : "Contract can't be changed, source verified"],
    ...(sol ? [[true, "Address ends in tik"] as [boolean, string]] : []),
    ...(!sol ? [[true, "Anti-sniper: max 1% per buy for 5 minutes"] as [boolean, string], [Number(f.buyTax) <= 5 && Number(f.sellTax) <= 5, `Tax ${f.buyTax || 0}% buy · ${f.sellTax || 0}% sell`] as [boolean, string]] : []),
    [share <= 10, `Your share ${share}%`],
    ...(!sol && f.reward ? [[true, `Holders earn ${f.reward === "other" ? "a reward token" : rewardChoices(ch).find((x) => x.key === f.reward)?.symbol ?? ""} from ${f.holderPercent}% of the tax`] as [boolean, string]] : []),
  ];
  return (
    <form className="ql" onSubmit={review}>
      <div className="ql-main card">
        <div className="ql-top"><b>Launch a token</b><small className="muted">Five quick steps, a live preview, then you sign once.</small></div>

        <section className="ql-sec">
          <h4><i>1</i>Network</h4>
          <div className="ql-chains" role="radiogroup" aria-label="Network">
            {live.map((c) => (
              <button key={c.key} type="button" role="radio" aria-checked={f.chain === c.key} className={"ql-chain" + (f.chain === c.key ? " on" : "")} onClick={() => setF({ ...f, chain: c.key })}>
                <NetIcon n={net(c.key, c.name)} size={26} /><span><b>{c.name}</b><small>{c.dex}</small></span>
              </button>
            ))}
          </div>
        </section>

        <section className="ql-sec">
          <h4><i>2</i>Token</h4>
          <div className="form-grid">
            <div className="ql-pic" style={{ gridColumn: "1 / -1" }}>
              <button type="button" className="ql-pic-btn" onClick={() => logoInput.current?.click()} aria-label={f.logo ? "Change the token picture" : "Add a token picture"}>
                {f.logo ? <img src={f.logo} alt="" /> : <span><svg viewBox="0 0 24 24" width="22" height="22"><use href="#i-cam" /></svg><small>Add picture</small></span>}
              </button>
              <div><b>Token picture</b><small className="muted">Square works best (PNG, JPG, WebP or GIF). It shows on the Board, the token page{sol ? " and in Solana wallets" : ""}.</small>
                {logoBusy && <small className="muted">{logoBusy}</small>}
                {f.logo && <button type="button" className="linkish" style={{ fontSize: ".82em" }} onClick={() => setF({ ...f, logo: "" })}>Remove</button>}
              </div>
              <input ref={logoInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => { const x = e.target.files?.[0]; if (x) setLogoFile(x); e.target.value = ""; }} />
              {logoFile && <PhotoCrop file={logoFile} onCancel={() => setLogoFile(null)} onDone={uploadLogo} />}
            </div>
            <label className="field"><span>Token name {taken?.name ? <b className="ql-bad">already launched</b> : f.name.trim() && taken ? <b className="ql-good">✓ available</b> : null}</span><input value={f.name} onChange={set("name")} maxLength={32} placeholder="e.g. Calm Otter" required aria-invalid={!!taken?.name} /></label>
            <label className="field"><span>Ticker {taken?.symbol ? <b className="ql-bad">already launched</b> : f.symbol.trim() && taken ? <b className="ql-good">✓ available</b> : null}</span><input value={f.symbol} onChange={(e) => setF({ ...f, symbol: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") })} maxLength={13} placeholder="e.g. OTTER" required aria-invalid={!!taken?.symbol} /></label>
            <label className="field" style={{ gridColumn: "1 / -1" }}><span>One-line description <small className="muted">optional</small></span><input value={f.description} onChange={set("description")} maxLength={500} placeholder="What makes it special?" /></label>
          </div>
        </section>

        <section className="ql-sec">
          <h4><i>3</i>Tokenomics</h4>
          <label className="field"><span>Total supply</span><input value={f.supply} onChange={(e) => setF({ ...f, supply: e.target.value.replace(/[^0-9]/g, "") })} inputMode="numeric" required /></label>
          <div className="ql-chips">{["1000000", "100000000", "1000000000", "10000000000"].map((v) => <button key={v} type="button" className={f.supply === v ? "on" : ""} onClick={() => setF({ ...f, supply: v })}>{num(Number(v))}</button>)}</div>
          <label className="field"><span>Your free share: <b>{share}%</b> <small className="muted">(0–20%, the rest goes into the pool)</small></span>
            <input type="range" min={0} max={20} step={0.5} value={share} onChange={(e) => setF({ ...f, creatorPercent: e.target.value })} aria-label="Your free share in percent" />
          </label>
          <div className="ql-split" aria-hidden="true"><i style={{ width: `${share}%` }} /><span>{share}% you · {100 - share}% pool</span></div>
        </section>

        <section className="ql-sec">
          <h4><i>4</i>Liquidity</h4>
          <label className="field"><span>Liquidity ({coin}{sol ? "" : ", incl. ≈$3 launch contribution"})</span><input value={f.liquidity} onChange={set("liquidity")} inputMode="decimal" placeholder={`Any amount, e.g. ${ch?.suggestedLiquidity ?? "0.1"}`} required /></label>
          <div className="ql-chips">{LIQ.map((v) => <button key={v} type="button" className={f.liquidity === v ? "on" : ""} onClick={() => setF({ ...f, liquidity: v })}>{v} {coin}</button>)}</div>
          {(!sol || solLockerProgram()) && (
            <div className="ql-locks" role="radiogroup" aria-label="Liquidity lock">
              {(Object.keys(LOCKS) as LiquidityLock[]).map((k) => (
                <button key={k} type="button" role="radio" aria-checked={f.lock === k} className={"ql-lock" + (f.lock === k ? " on" : "")} onClick={() => setF({ ...f, lock: k })}>
                  <span aria-hidden="true"><svg viewBox="0 0 24 24" width="20" height="20"><use href={k === "burn" ? "#i-fire" : "#i-lock"} /></svg></span><b>{LOCKS[k].label}</b>
                </button>
              ))}
            </div>
          )}
          {sol && <SolRewardsPick f={f} setF={setF} />}
          {sol && <div className="notice" style={{ fontSize: ".86em" }}>{f.reward ? "Solana: a coin with a fee on every trade that pays your holders" : "Solana: standard token"} with a fixed supply and a Raydium pool; the LP tokens are {solLockerProgram() ? "burned or locked" : "burned forever"}. {f.reward ? "No whitelist or first buy." : "No tax, whitelist or first buy."} Raydium charges about 0.15 SOL for the pool.</div>}
        </section>

        {!sol && (
          <section className="ql-sec">
            <h4><i>5</i>Tax &amp; extras <small className="muted">optional</small></h4>
            <div className="form-grid">
              <label className="field"><span>Buy tax % <small className="muted">max {MAX_TAX_PERCENT}</small></span><input value={f.buyTax} onChange={set("buyTax")} inputMode="decimal" /></label>
              <label className="field"><span>Sell tax % <small className="muted">max {MAX_TAX_PERCENT}</small></span><input value={f.sellTax} onChange={set("sellTax")} inputMode="decimal" /></label>
              {(Number(f.buyTax) > 0 || Number(f.sellTax) > 0) && <label className="field" style={{ gridColumn: "1 / -1" }}><span>Tax wallet (receives the tax){f.reward ? " · your marketing wallet" : ""}</span><input value={f.taxWallet} onChange={set("taxWallet")} placeholder="0x…" spellCheck={false} /></label>}
            </div>
            <HolderRewardsPick f={f} setF={setF} ch={ch} open={(versions[f.chain] ?? 0) >= 4} />
            <details>
              <summary><b>Whitelist &amp; first buy</b></summary>
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
          </section>
        )}

        <details className="ql-sec">
          <summary><b>Links</b> <small className="muted">optional: website, X, Telegram</small></summary>
          <div className="form-grid" style={{ marginTop: 8 }}>
            <label className="field"><span>Website (https://…)</span><input value={f.website} onChange={set("website")} /></label>
            <label className="field"><span>X (https://…)</span><input value={f.x} onChange={set("x")} /></label>
            <label className="field"><span>Telegram (https://…)</span><input value={f.telegram} onChange={set("telegram")} /></label>
          </div>
        </details>

        {err && <div className="notice warn">{err}</div>}
        <button className="btn primary ql-go" type="submit" disabled={disabled}>Review launch plan →</button>
      </div>

      <aside className="ql-preview" aria-label="Live preview">
        <div className="ql-card">
          <div className="ql-card-top">
            {f.logo ? <img className="ql-logo" src={f.logo} alt="" /> : <span className="ql-logo" aria-hidden="true">{(f.symbol || "?").slice(0, 3)}</span>}
            <div><b>{f.name || "Your token"}</b><small>${f.symbol || "TICKER"} · {ch?.name}</small></div>
            <span className="ql-live">Preview</span>
          </div>
          {f.description && <p className="ql-desc">{f.description}</p>}
          <div className="ql-stats">
            <div><small>Supply</small><b>{supplyN ? num(supplyN) : "–"}</b></div>
            <div><small>Into the pool</small><b>{poolTokens ? num(poolTokens) : "–"}</b></div>
            <div><small>Liquidity</small><b>{liqN ? `${liqN} ${coin}` : "–"}</b></div>
            <div><small>Start price</small><b>{tiny(price)} {price ? coin : ""}</b></div>
            <div><small>Start market cap</small><b>{mcap ? `${+mcap.toFixed(4)} ${coin}` : "–"}</b></div>
            <div><small>Liquidity</small><b>{f.lock === "burn" ? "Burned" : lp.short}</b></div>
          </div>
          <ul className="ql-checks">
            {checks.map(([ok, t]) => <li key={t} className={ok ? "ok" : "warn"}><i aria-hidden="true">{ok ? "✓" : "!"}</i>{t}</li>)}
          </ul>
          <small className="muted">Prices are estimates from your liquidity. Token prices can go to zero.</small>
        </div>
      </aside>
    </form>
  );
}

/** After launch: the creator opens trading (it also opens by itself after 24 hours). */
/**
 * The two steps after an EVM launch: start trading, then renounce ownership. Renounce comes second because once
 * ownership is gone nobody can start trading early (it would only open by itself after 24 hours). The token's code
 * can't be changed either way: every Launch Pad token is the same fixed contract, with no proxy and no upgrade.
 */
function StartTrading({ c, token }: { c: LaunchChain; token: string }) {
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [renounced, setRenounced] = useState(false);
  const [later, setLater] = useState(false);
  async function send(fn: "openTrading" | "renounceOwnership") {
    const eth = await pickWallet();
    if (!eth) return false;
    setBusy(true); setMsg("Confirm in your wallet…");
    try {
      const chain = viemChain(c);
      const wallet = createWalletClient({ chain, transport: custom(eth) });
      const pub = createPublicClient({ chain, transport: custom(eth) });
      const [account] = await wallet.requestAddresses();
      const hash = await wallet.writeContract({ account, chain, address: token as `0x${string}`, abi: LAUNCH_TOKEN_ABI, functionName: fn } as any);
      const r = await pub.waitForTransactionReceipt({ hash });
      if (r.status !== "success") { setMsg("That transaction failed on-chain. Try again."); return false; }
      return true;
    } catch (e: any) {
      const m = String(e?.message || "");
      if (fn === "openTrading" && /AlreadyOpen/.test(m)) return true;
      setMsg(/NotOwner/.test(m) ? "Only the wallet that launched the token can do this." : e?.shortMessage || "You cancelled in your wallet.");
      return false;
    } finally { setBusy(false); }
  }
  async function start() {
    if (await send("openTrading")) { setOpen(true); setMsg("Trading is open. For the first 5 minutes each buy is limited, to stop sniper bots."); }
  }
  async function renounce() {
    if (await send("renounceOwnership")) { setRenounced(true); setMsg("Renounced. Nobody, not even you, can change this token's settings now. Scanners will show it as renounced."); }
  }
  if (renounced) return <div className="notice"><span>{msg}</span></div>;
  return (
    <div className="notice" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {!open ? (
        <>
          <span><b>Next: start trading.</b> Until you do, only your whitelisted wallets can buy. It opens by itself after 24 hours.</span>
          <button className="btn primary" type="button" disabled={busy} onClick={start}>{busy ? "Starting…" : "▶ Start trading"}</button>
        </>
      ) : later ? (
        <span>You can renounce any time from the token page (Token safety → I&apos;m the creator: manage).</span>
      ) : (
        <>
          <span><b>Last step: renounce ownership.</b> Buyers trust tokens nobody controls. After this you can&apos;t lower the tax or change the tax wallet any more, and your tax keeps going to the same wallet. The token&apos;s code can never be changed either way.</span>
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            <button className="btn primary" type="button" disabled={busy} onClick={renounce}>{busy ? "Renouncing…" : "Renounce ownership"}</button>
            <button className="btn small" type="button" disabled={busy} onClick={() => { setLater(true); setMsg(""); }}>Later</button>
          </div>
        </>
      )}
      {msg && <small className="muted">{msg}</small>}
    </div>
  );
}

/**
 * Launch Pad v4: part of the tax buys a reward token (BNB/ETH, BTC, ETH or another approved token) and shares it with
 * every holder by how much they hold. The rest of the tax goes to the creator's tax (marketing) wallet.
 */
function HolderRewardsPick({ f, setF, ch, open }: { f: any; setF: (fn: (x: any) => any) => void; ch: LaunchChain; open: boolean }) {
  const choices = rewardChoices(ch);
  const pick = (reward: string) => setF((x: any) => ({ ...x, reward }));
  const buy = Number(f.buyTax) || 0, sell = Number(f.sellTax) || 0, hp = Math.min(100, Math.max(0, Number(f.holderPercent) || 0));
  const name = f.reward === "other" ? "the token you picked" : choices.find((c) => c.key === f.reward)?.symbol ?? "";
  const split = (t: number) => `${+(t * hp / 100).toFixed(2)}% to holders · ${+(t * (100 - hp) / 100).toFixed(2)}% to you`;
  return (
    <div className="hr-pick">
      <div className="hr-head">
        <b>Holder rewards</b>
        <small className="muted">Optional. Part of your tax buys a token and shares it with every holder.</small>
      </div>
      {!open ? <small className="muted">Holder rewards open on {ch.name} soon.</small> : (
        <>
          <div className="hr-chips" role="radiogroup" aria-label="Reward for holders">
            <button type="button" role="radio" aria-checked={!f.reward} className={!f.reward ? "on" : ""} onClick={() => pick("")}>No rewards</button>
            {choices.map((c) => <button key={c.key} type="button" role="radio" aria-checked={f.reward === c.key} className={f.reward === c.key ? "on" : ""} onClick={() => pick(c.key)} title={c.name}>{c.symbol}</button>)}
            <button type="button" role="radio" aria-checked={f.reward === "other"} className={f.reward === "other" ? "on" : ""} onClick={() => pick("other")}>Other token</button>
          </div>
          {f.reward === "other" && (
            <label className="field"><span>Reward token address</span><input value={f.rewardOther} onChange={(e) => setF((x: any) => ({ ...x, rewardOther: e.target.value }))} placeholder="0x…" spellCheck={false} />
              <small className="muted">It needs a {ch.dex} pool with {ch.coin}, and the AUTISTIK team must approve it first (this keeps holders safe from fake reward tokens).</small></label>
          )}
          {f.reward && (
            <>
              <label className="field"><span>Share of your tax that goes to holders: <b>{hp}%</b></span>
                <input type="range" min={1} max={100} step={1} value={hp} onChange={(e) => setF((x: any) => ({ ...x, holderPercent: e.target.value }))} aria-label="Share of tax to holders" /></label>
              {!(buy > 0 || sell > 0) ? <div className="notice warn" style={{ fontSize: ".86em" }}>Rewards come from the tax. Set a buy or sell tax above.</div> : (
                <div className="hr-split">
                  <span><small>On buys ({buy}%)</small><b>{split(buy)}</b></span>
                  <span><small>On sells ({sell}%)</small><b>{split(sell)}</b></span>
                </div>
              )}
              <small className="muted">Holders get {name} automatically, a few at a time as people trade, and can claim theirs any time on the coin&apos;s page. The pool and burn address never earn. Nobody can change the reward or the share after launch.</small>
            </>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Solana holder rewards: one fee on every trade (Token-2022), collected by the AUTISTIK rewards wallet. Part of it
 * buys SOL, BTC or ETH for holders; the rest goes to the creator's wallet (lib/solana-rewards.ts).
 */
function SolRewardsPick({ f, setF }: { f: any; setF: (fn: (x: any) => any) => void }) {
  const [ready, setReady] = useState<boolean | null>(null);
  useEffect(() => { fetch("/api/launchpad/solana-rewards?status=1").then((r) => r.json()).then((d) => setReady(!!d.ready)).catch(() => setReady(false)); }, []);
  const pick = (reward: string) => setF((x: any) => ({ ...x, reward, buyTax: reward && Number(x.buyTax) === 0 ? "3" : reward ? x.buyTax : "0" }));
  const fee = Number(f.buyTax) || 0, hp = Math.min(100, Math.max(0, Number(f.holderPercent) || 0));
  const sym = SOL_REWARD_TOKENS[f.reward]?.symbol;
  if (ready === null) return null;
  return (
    <div className="hr-pick">
      <div className="hr-head">
        <b>Holder rewards</b>
        <small className="muted">Optional. A fee on every trade; part of it buys SOL, BTC or ETH for every holder.</small>
      </div>
      {!ready ? <small className="muted">Holder rewards on Solana open soon.</small> : (
        <>
          <div className="hr-chips" role="radiogroup" aria-label="Reward for holders">
            <button type="button" role="radio" aria-checked={!f.reward} className={!f.reward ? "on" : ""} onClick={() => pick("")}>No rewards</button>
            {Object.entries(SOL_REWARD_TOKENS).map(([k, t]) => <button key={k} type="button" role="radio" aria-checked={f.reward === k} className={f.reward === k ? "on" : ""} onClick={() => pick(k)} title={t.name}>{t.symbol}</button>)}
          </div>
          {f.reward && (
            <>
              <div className="form-grid">
                <label className="field"><span>Fee on every trade % <small className="muted">1–{MAX_TAX_PERCENT}</small></span><input value={f.buyTax} onChange={(e) => setF((x: any) => ({ ...x, buyTax: e.target.value, sellTax: e.target.value }))} inputMode="decimal" /></label>
                <label className="field"><span>Your wallet (gets your part, in your coin)</span><input value={f.taxWallet} onChange={(e) => setF((x: any) => ({ ...x, taxWallet: e.target.value.trim() }))} placeholder="Solana address" spellCheck={false} /></label>
              </div>
              <label className="field"><span>Share of the fee that goes to holders: <b>{hp}%</b></span>
                <input type="range" min={1} max={100} step={1} value={hp} onChange={(e) => setF((x: any) => ({ ...x, holderPercent: e.target.value }))} aria-label="Share of fee to holders" /></label>
              <div className="hr-split">
                <span><small>Holders get</small><b>{+(fee * hp / 100).toFixed(2)}% of every trade, as {sym}</b></span>
                <span><small>You get</small><b>{+(fee * (100 - hp) / 100).toFixed(2)}% of every trade</b></span>
              </div>
              <small className="muted">On Solana the fee applies to every transfer, buys and sells alike, plus the {solTradeFeeBps() / 100}% AUTISTIK fee. The AUTISTIK rewards wallet collects it, buys {sym} on Jupiter and sends it to holders about every 10 minutes; holders can also claim on the coin&apos;s page. Pools and lockers never earn. Nobody can change the fee after launch.</small>
            </>
          )}
        </>
      )}
    </div>
  );
}
