"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createPublicClient, createWalletClient, custom, formatEther, getAddress, http, parseEther, parseEventLogs } from "viem";
import { CHAINS, LAUNCHPAD_ABI, LOCKS, MIN_HOLD_USD, dexscreenerUrl, isLive, readLimits, viemChain, type LaunchPlan } from "@/lib/launchpad";

type Msg = { kind: "me" | "ai" | "sys"; text: string; pending?: boolean };
type Turn = { role: "user" | "assistant"; content: string };
type Done = { token: string; pair: string; hash: string; listed: boolean };

const HELLO = "Hi, I'm Autistik. I'll help you launch your own token in a few steps. First question: which chain do you want, BNB Chain (PancakeSwap), Ethereum (Uniswap) or Robinhood Chain?";
const STARTERS = ["Launch on BNB Chain", "Launch on Ethereum", "Launch on Robinhood Chain", "How does the liquidity lock work?", "Who can launch?"];

/** Reads text out loud with the browser's own voice. Links and addresses are skipped so it sounds natural. */
function speak(text: string, onState: (talking: boolean) => void) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  const synth = window.speechSynthesis;
  synth.cancel();
  const clean = text.replace(/https?:\/\/\S+/g, "the link").replace(/0x[0-9a-fA-F]{6,}/g, "the address").replace(/[*_#`>]/g, "");
  const u = new SpeechSynthesisUtterance(clean);
  u.rate = 0.95;
  const voices = synth.getVoices();
  const v = voices.find((x) => /^en/i.test(x.lang) && /female|samantha|aria|zira|google us/i.test(x.name)) || voices.find((x) => /^en/i.test(x.lang));
  if (v) u.voice = v;
  u.onstart = () => onState(true);
  u.onend = u.onerror = () => onState(false);
  synth.speak(u);
}

function Avatar() {
  return <svg className="av" viewBox="0 0 48 24" aria-hidden="true"><use href="#i-inf" /></svg>;
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

  useEffect(() => { box.current?.scrollTo({ top: box.current.scrollHeight }); }, [msgs]);
  useEffect(() => {
    setCanSpeak("speechSynthesis" in window);
    setCanListen(!!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition));
    try { setVoice(localStorage.getItem("autistik-voice") === "on"); } catch {}
    return () => { try { window.speechSynthesis?.cancel(); rec.current?.abort(); } catch {} };
  }, []);

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
      const res = await fetch("/api/launchpad/agent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: turns.current }) });
      const data = await res.json().catch(() => ({}));
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
      setMsgs((m) => [...m.slice(0, -1), { kind: "ai", text: data.reply }]);
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

      // The Hub checks this wallet holds $20+ of AUTISTIK on BNB Chain and gives a 15-minute permit the contract checks.
      setStatus(`Checking this wallet holds at least $${MIN_HOLD_USD} of AUTISTIK…`);
      const er = await fetch("/api/launchpad/eligibility", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chain: c.key, wallet: account }) });
      const permit = await er.json().catch(() => ({}));
      if (!er.ok) { setStatus(permit.error || "Couldn't check your AUTISTIK balance. Try again."); say(permit.error || ""); return; }

      setStatus("Confirm the launch in your wallet…");
      const call = {
        account, address: c.launchpad!, abi: LAUNCHPAD_ABI, functionName: "launch",
        args: [plan.name, plan.symbol, BigInt(plan.supply) * 10n ** 18n, BigInt(Math.round(plan.creatorPercent * 100)), LOCKS[plan.lock].option, BigInt(permit.deadline || 0), (permit.signature || "0x") as `0x${string}`],
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
      setStatus(/NotEligible|PermitExpired/.test(reason)
        ? `The launch was refused: this wallet must hold at least $${MIN_HOLD_USD} of AUTISTIK. Press Launch again to re-check.`
        : e?.shortMessage || "You cancelled in your wallet. Nothing was launched.");
    } finally { setLaunching(false); }
  }

  const c = plan ? CHAINS[plan.chain] : null;
  const creatorTokens = plan ? (BigInt(plan.supply) * BigInt(Math.round(plan.creatorPercent * 100))) / 10000n : 0n;

  return (
    <div className="stack">
      <div className="kai lp">
        <div className="card chat" data-c="autistik">
          <div className="chat-head">
            <span className={talking ? "speaking" : undefined}><Avatar /></span>
            <div className="grow"><b>Autistik</b><div className="muted" style={{ fontSize: ".82em" }}>{talking ? "Speaking…" : "Your launch agent. Asks the questions, you sign."}</div></div>
            {canSpeak && <button className="btn small" type="button" aria-pressed={voice} onClick={toggleVoice} title="Autistik reads its questions out loud">{voice ? "🔊 Voice on" : "🔈 Voice off"}</button>}
            {msgs.length > 0 && <button className="btn small" type="button" disabled={busy} onClick={() => { turns.current = []; setMsgs([]); setPlan(null); setDone(null); setStatus(""); }}>Start over</button>}
          </div>
          <div className="msgs" ref={box} aria-live="polite">
            <div className="msgrow"><Avatar /><div className="msg ai">{HELLO}</div></div>
            {msgs.map((m, i) =>
              m.kind === "me" ? <div key={i} className="msg me">{m.text}</div>
              : m.kind === "sys" ? <div key={i} className="msg sys">{m.text}</div>
              : <div key={i} className="msgrow"><Avatar /><div className={"msg ai" + (m.pending ? " muted" : "")}>{m.text}</div></div>
            )}
          </div>
          {!msgs.length && <div className="starters">{STARTERS.map((s) => <button key={s} className="btn small" type="button" onClick={() => send(s)}>{s}</button>)}</div>}
          <form className="composer" onSubmit={(e) => { e.preventDefault(); send(input); }}>
            <textarea value={input} onChange={(e) => setInput(e.target.value)} placeholder={signedIn ? "Message Autistik… (Enter to send)" : "Sign in to talk with Autistik"} aria-label="Message Autistik"
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }} />
            {canListen && <button className="btn" type="button" aria-pressed={listening} onClick={listen} title="Answer by speaking" disabled={busy}>{listening ? "⏹ Stop" : "🎤 Speak"}</button>}
            <button className="btn c" type="submit" disabled={busy}>Send</button>
          </form>
        </div>

        <div className="stack">
          {!signedIn && <div className="notice warn"><Link href="/login">Sign in</Link> to talk with Autistik. It&apos;s free for members.</div>}

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
            <div className="card stack">
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
            <div className="card stack" style={{ fontSize: ".9em" }}>
              <h3>How it works</h3>
              <ol className="stack" style={{ margin: 0, paddingLeft: 18, gap: 6 }}>
                <li>Answer Autistik&apos;s questions. Turn on Voice to hear them, and press Speak to answer out loud.</li>
                <li>Check your launch plan.</li>
                <li>Sign one transaction in your wallet.</li>
                <li>Your token trades on {Object.values(CHAINS).filter(isLive).map((x) => x.dex).join(", ") || "the DEX"} and shows up on DexScreener.</li>
              </ol>
              <p className="muted">Choose to lock the liquidity for 6 months, 1 year, or burn it forever, so holders know it can&apos;t be pulled early. Your wallet needs at least ${MIN_HOLD_USD} of AUTISTIK on BNB Chain to launch.</p>
            </div>
          )}
          <div className="notice alert" style={{ fontSize: ".86em" }}><b>Never</b> share your seed phrase or private key. Autistik will never ask for it.</div>
        </div>
      </div>
    </div>
  );
}
