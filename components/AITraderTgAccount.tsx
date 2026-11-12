"use client";
/**
 * Log in with your own Telegram account (phone number → code → 2-step password if set), then tick which of your
 * groups and channels to copy. Part of the AI trader's copy trading panel.
 */
import { useEffect, useRef, useState } from "react";
import type { CopySource } from "@/components/AITraderCopy";

type Chat = { ref: string; title: string; kind: "group" | "channel" | "chat" | "bot"; members: number | null; username: string | null };
export type TgaState = { ready: boolean; signedIn: boolean; name: string | null; stage: string | null; hint: string | null; chats: Chat[] | null; chatsAt: string | null };

async function call(action: string, body: unknown) {
  const r = await fetch(`/api/ai-trader/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "Something went wrong.");
  return d;
}
const ago = (iso: string | null) => { if (!iso) return "no posts yet"; const s = (Date.now() - Date.parse(iso)) / 1000; return s < 60 ? "posted now" : s < 3600 ? `posted ${Math.floor(s / 60)}m ago` : s < 86400 ? `posted ${Math.floor(s / 3600)}h ago` : `posted ${Math.floor(s / 86400)}d ago`; };

export default function AITraderTgAccount({ st, sources, busy, reload, onAct }: { st: TgaState; sources: CopySource[]; busy: boolean; reload: () => Promise<void>; onAct: (n: string, a: string, b: unknown, done?: string) => Promise<void> }) {
  // A login waiting for the 2-step password (started on any device) opens straight at the password box.
  const [step, setStep] = useState<"qr" | "phone" | "code" | "password">(st.stage === "password" ? "password" : "qr");
  const [qr, setQr] = useState<{ qr: string; link: string; expires: number } | null>(null);
  const polling = useRef(false);
  const [phone, setPhone] = useState(""), [code, setCode] = useState(""), [pw, setPw] = useState("");
  const [hint, setHint] = useState<string | null>(st.hint), [sentTo, setSentTo] = useState(""), [resend, setResend] = useState<string | null>(null);
  const [tab, setTab] = useState<"all" | "group" | "channel" | "chat">("all");
  // The chat list is saved with your trader, so it shows on every device you open this page on.
  const [chats, setChats] = useState<Chat[] | null>(st.chats);
  useEffect(() => { if (st.chats) setChats(st.chats); }, [st.chatsAt]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (st.stage === "password" && !st.signedIn) { setStep("password"); setHint(st.hint); } }, [st.stage, st.signedIn]); // eslint-disable-line react-hooks/exhaustive-deps
  // Signed in but no saved list yet (e.g. logged in before this update): load it once.
  const autoLoaded = useRef(false);
  useEffect(() => {
    if (!st.signedIn || st.chats || autoLoaded.current) return;
    autoLoaded.current = true;
    call("tga-chats", {}).then((r) => setChats(r.chats)).catch(() => {});
  }, [st.signedIn, st.chats]);
  const [find, setFind] = useState("");
  const [working, setWorking] = useState(false);
  const [msg, setMsg] = useState("");

  // While a QR code is showing, ask every 3 seconds whether it was scanned (a fresh code comes back when it expires).
  useEffect(() => {
    if (step !== "qr" || !qr) return;
    let stop = false;
    const t = setInterval(async () => {
      if (stop || polling.current) return;
      polling.current = true;
      try {
        const r = await call("tga-qr-check", {});
        if (r.name) { stop = true; setQr(null); await done(r.name); }
        else if (r.needPassword) { stop = true; setQr(null); setHint(r.hint || null); setStep("password"); }
        else if (r.qr) setQr({ qr: r.qr, link: r.link, expires: r.expires });
      } catch (e) { stop = true; setQr(null); setMsg((e as Error).message); }
      polling.current = false;
    }, 3000);
    const end = setTimeout(() => { stop = true; setQr(null); setMsg("The QR code timed out. Tap Show QR code to try again."); }, 5 * 60_000);
    return () => { stop = true; clearInterval(t); clearTimeout(end); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, !!qr]);

  const startOver = () => go(async () => { await call("tga-reset", {}); setQr(null); setCode(""); setPw(""); setHint(null); setStep("qr"); await reload(); });

  async function go(fn: () => Promise<void>) { setWorking(true); setMsg(""); try { await fn(); } catch (e) { setMsg((e as Error).message); } setWorking(false); }
  const done = async (name: string) => { setStep("qr"); setCode(""); setPw(""); setMsg(`Logged in as ${name}. Your groups, channels and chats are below: tick the ones to copy.`); await reload(); };
  const mine = sources.filter((x) => x.kind === "tg_chat");

  if (!st.ready) return (
    <small className="muted">To log in with your own Telegram account, open <a href="https://my.telegram.org/apps" target="_blank" rel="noopener noreferrer">my.telegram.org/apps</a>, sign in with your number, create an app (any name), and copy its <b>App api_id</b> and <b>App api_hash</b> into Vercel as <code>TELEGRAM_API_ID</code> and <code>TELEGRAM_API_HASH</code>. Then redeploy. It&apos;s free.</small>
  );

  if (!st.signedIn) return (
    <div className="stack" style={{ gap: 8 }}>
      <small className="muted">Log in with your own Telegram account: every group, channel and chat you have shows up here to tick. No bot needed. Telegram will tell you about the new login; you can end it any time in Telegram → Settings → Devices.</small>
      {step === "qr" && (
        <div className="stack" style={{ gap: 8 }}>
          {!qr ? (
            <button type="button" className="btn" style={{ alignSelf: "flex-start" }} disabled={working || busy} onClick={() => go(async () => { const r = await call("tga-qr", {}); setQr({ qr: r.qr, link: r.link, expires: r.expires }); })}>{working ? "Getting a QR code…" : "Show QR code"}</button>
          ) : (
            <div className="aic-qr">
              <img src={qr.qr} alt="Telegram login QR code" width={220} height={220} />
              <div className="stack" style={{ gap: 6 }}>
                <b>Scan this in Telegram</b>
                <small className="muted">On your phone: Telegram → <b>Settings → Devices → Link Desktop Device</b>, then point the camera at this code. On this same phone, tap the button instead.</small>
                <a className="btn small" href={qr.link}>Open in Telegram on this phone</a>
                <small className="muted">Waiting for you to approve… it logs in by itself.</small>
              </div>
            </div>
          )}
          <button type="button" className="btn small ghost" style={{ alignSelf: "flex-start" }} onClick={() => { setQr(null); setStep("phone"); setMsg(""); }}>Log in with a code instead</button>
        </div>
      )}
      {step === "phone" && (
        <button type="button" className="btn small ghost" style={{ alignSelf: "flex-start" }} onClick={() => { setStep("qr"); setMsg(""); }}>Log in with a QR code instead (no code needed)</button>
      )}
      {step === "phone" && (
        <form className="aic-add" onSubmit={(e) => { e.preventDefault(); go(async () => { const r = await call("tga-start", { phone }); setSentTo(r.sentTo); setResend(r.resend); setStep("code"); }); }}>
          <input className="input" type="tel" inputMode="tel" autoComplete="tel" placeholder="+233 20 123 4567" value={phone} onChange={(e) => setPhone(e.target.value)} aria-label="Your Telegram phone number" />
          <button type="submit" className="btn small" disabled={working || busy || phone.replace(/\D/g, "").length < 7}>{working ? "Sending…" : "Send code"}</button>
        </form>
      )}
      {step === "code" && (
        <>
          <div className="aic-sent">
            <b>Telegram sent your login code to {sentTo || "your Telegram app"}.</b>
            <small className="muted">It&apos;s usually not an SMS: look for a message from <b>Telegram</b> (blue tick) at the top of your chats, in the Telegram app on your phone or computer. Type the code below.</small>
          </div>
          <form className="aic-add" onSubmit={(e) => { e.preventDefault(); go(async () => { const r = await call("tga-code", { code }); if (r.needPassword) { setHint(r.hint || null); setStep("password"); } else await done(r.name); }); }}>
            <input className="input" inputMode="numeric" autoComplete="one-time-code" placeholder="12345" value={code} onChange={(e) => setCode(e.target.value)} aria-label="Login code from Telegram" />
            <button type="submit" className="btn small" disabled={working || code.replace(/\D/g, "").length < 4}>{working ? "Checking…" : "Log in"}</button>
          </form>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="btn small" disabled={working} onClick={() => go(async () => { const r = await call("tga-resend", {}); setSentTo(r.sentTo); setResend(r.resend); setMsg(`Sent again to ${r.sentTo}.`); })}>{resend ? `Didn't get it? Send ${resend}` : "Didn't get it? Send again"}</button>
            <button type="button" className="btn small ghost" onClick={() => { setStep("phone"); setCode(""); setMsg(""); }}>Use a different number</button>
          </div>
        </>
      )}
      {step === "password" && (
        <>
          <small className="muted">Your account has 2-step verification. Type your Telegram password{hint ? ` (hint: ${hint})` : ""}. It goes straight to Telegram and isn&apos;t saved.</small>
          <form className="aic-add" onSubmit={(e) => { e.preventDefault(); go(async () => { const r = await call("tga-password", { password: pw }); await done(r.name); }); }}>
            <input className="input" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} aria-label="Telegram 2-step verification password" />
            <button type="submit" className="btn small" disabled={working || !pw}>{working ? "Checking…" : "Log in"}</button>
          </form>
          <button type="button" className="btn small ghost" style={{ alignSelf: "flex-start" }} disabled={working} onClick={startOver}>Start over</button>
        </>
      )}
      {msg && <small className="aic-note" role="status">{msg}</small>}
      {/waiting for your 2-step password/.test(msg) && (
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="btn small" onClick={() => { setMsg(""); setStep("password"); }}>Type the password</button>
          <button type="button" className="btn small ghost" disabled={working} onClick={startOver}>Start over</button>
        </div>
      )}
    </div>
  );

  const inTab = (c: Chat) => tab === "all" || (tab === "chat" ? c.kind === "chat" || c.kind === "bot" : c.kind === tab);
  const shown = (chats || []).filter((c) => inTab(c) && (!find.trim() || c.title.toLowerCase().includes(find.trim().toLowerCase())));
  const count = (k: typeof tab) => (chats || []).filter((c) => k === "all" || (k === "chat" ? c.kind === "chat" || c.kind === "bot" : c.kind === k)).length;
  const kindLabel = { group: "Group", channel: "Channel", chat: "Private chat", bot: "Bot" } as const;
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span className="aic-ok">✓ Logged in as {st.name}</span>
        <button type="button" className="btn small ghost" disabled={busy || working} onClick={() => { if (confirm("Log out of your Telegram account here? Your ticked groups stop being copied.")) onAct("tgao", "tga-logout", {}); }}>Log out</button>
      </div>
      {chats === null ? <button type="button" className="btn small" style={{ alignSelf: "flex-start" }} disabled={working || busy} onClick={() => go(async () => setChats((await call("tga-chats", {})).chats))}>{working ? "Loading your chats…" : "Load my groups, channels and chats"}</button>
        : !chats.length ? <small className="muted">No groups, channels or chats found.</small>
          : (
            <>
              <div className="ait-seg aic-tabs" role="tablist" aria-label="Show">
                {(["all", "group", "channel", "chat"] as const).map((k) => (
                  <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{{ all: "All", group: "Groups", channel: "Channels", chat: "Chats" }[k]} <small>{count(k)}</small></button>
                ))}
              </div>
              <input className="input" placeholder={`Search ${shown.length} ${tab === "all" ? "chats" : tab === "chat" ? "private chats" : tab + "s"}`} value={find} onChange={(e) => setFind(e.target.value)} aria-label="Search your Telegram chats" />
              <div className="aic-list aic-scroll">{shown.slice(0, 300).map((ch) => {
                const have = mine.find((x) => x.ref === ch.ref);
                return (
                  <label key={ch.ref} className={"aic-row" + (have?.enabled ? " on" : "")}>
                    <input type="checkbox" checked={!!have?.enabled} disabled={busy || working}
                      onChange={(e) => have ? onAct(`src${have.id}`, "source", { op: "toggle", id: have.id, enabled: e.target.checked }, e.target.checked ? `Copying ${ch.title}.` : `Stopped copying ${ch.title}.`)
                        : onAct("add", "source", { op: "add", kind: "tg_chat", ref: ch.ref, title: ch.title, handle: ch.username })} />
                    <span className="grow"><b>{ch.title}</b><small className="muted">{kindLabel[ch.kind]}{ch.username ? ` · @${ch.username}` : ""}{ch.members ? ` · ${ch.members.toLocaleString("en-US")} members` : ""}{have?.enabled ? ` · ${ago(have.last_post_at)}` : ""}</small></span>
                  </label>
                );
              })}</div>
              <small className="muted">Ticked chats are read every minute (up to 25). Only messages posted after you tick one are copied.</small>
              <button type="button" className="btn small ghost" style={{ alignSelf: "flex-start" }} disabled={working} onClick={() => go(async () => setChats((await call("tga-chats", {})).chats))}>{working ? "Refreshing…" : "Refresh list"}</button>
              {st.chatsAt && <small className="muted">List saved {new Date(st.chatsAt).toLocaleString()}. It shows on every device you open this page on.</small>}
            </>
          )}
      {chats === null && mine.some((x) => x.enabled) && (
        <div className="aic-list">{mine.filter((x) => x.enabled).map((x) => (
          <label key={x.id} className="aic-row on">
            <input type="checkbox" checked disabled={busy} onChange={() => onAct(`src${x.id}`, "source", { op: "toggle", id: x.id, enabled: false }, `Stopped copying ${x.title}.`)} />
            <span className="grow"><b>{x.title}</b><small className="muted">Telegram · {ago(x.last_post_at)}</small></span>
          </label>
        ))}</div>
      )}
      {msg && <small className="aic-note" role="status">{msg}</small>}
    </div>
  );
}
