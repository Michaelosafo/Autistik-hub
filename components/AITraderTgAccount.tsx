"use client";
/**
 * Log in with your own Telegram account (phone number → code → 2-step password if set), then tick which of your
 * groups and channels to copy. Part of the AI trader's copy trading panel.
 */
import { useState } from "react";
import type { CopySource } from "@/components/AITraderCopy";

type Chat = { ref: string; title: string; kind: "group" | "channel"; members: number | null; username: string | null };
export type TgaState = { ready: boolean; signedIn: boolean; name: string | null };

async function call(action: string, body: unknown) {
  const r = await fetch(`/api/ai-trader/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "Something went wrong.");
  return d;
}
const ago = (iso: string | null) => { if (!iso) return "no posts yet"; const s = (Date.now() - Date.parse(iso)) / 1000; return s < 60 ? "posted now" : s < 3600 ? `posted ${Math.floor(s / 60)}m ago` : s < 86400 ? `posted ${Math.floor(s / 3600)}h ago` : `posted ${Math.floor(s / 86400)}d ago`; };

export default function AITraderTgAccount({ st, sources, busy, reload, onAct }: { st: TgaState; sources: CopySource[]; busy: boolean; reload: () => Promise<void>; onAct: (n: string, a: string, b: unknown, done?: string) => Promise<void> }) {
  const [step, setStep] = useState<"phone" | "code" | "password">("phone");
  const [phone, setPhone] = useState(""), [code, setCode] = useState(""), [pw, setPw] = useState("");
  const [hint, setHint] = useState<string | null>(null), [sentTo, setSentTo] = useState("");
  const [chats, setChats] = useState<Chat[] | null>(null);
  const [find, setFind] = useState("");
  const [working, setWorking] = useState(false);
  const [msg, setMsg] = useState("");

  async function go(fn: () => Promise<void>) { setWorking(true); setMsg(""); try { await fn(); } catch (e) { setMsg((e as Error).message); } setWorking(false); }
  const done = async (name: string) => { setStep("phone"); setCode(""); setPw(""); setMsg(`Logged in as ${name}. Tap "Show my groups" to pick what to copy.`); await reload(); };
  const mine = sources.filter((x) => x.kind === "tg_chat");

  if (!st.ready) return (
    <small className="muted">To log in with your own Telegram account, open <a href="https://my.telegram.org/apps" target="_blank" rel="noopener noreferrer">my.telegram.org/apps</a>, sign in with your number, create an app (any name), and copy its <b>App api_id</b> and <b>App api_hash</b> into Vercel as <code>TELEGRAM_API_ID</code> and <code>TELEGRAM_API_HASH</code>. Then redeploy. It&apos;s free.</small>
  );

  if (!st.signedIn) return (
    <div className="stack" style={{ gap: 8 }}>
      <small className="muted">Log in with your own Telegram account: every group and channel you&apos;re in shows up here to tick. No bot needed. Telegram will tell you about the new login; you can end it any time in Telegram → Settings → Devices.</small>
      {step === "phone" && (
        <form className="aic-add" onSubmit={(e) => { e.preventDefault(); go(async () => { const r = await call("tga-start", { phone }); setSentTo(r.sentTo); setStep("code"); }); }}>
          <input className="input" type="tel" inputMode="tel" autoComplete="tel" placeholder="+233 20 123 4567" value={phone} onChange={(e) => setPhone(e.target.value)} aria-label="Your Telegram phone number" />
          <button type="submit" className="btn small" disabled={working || busy || phone.replace(/\D/g, "").length < 7}>{working ? "Sending…" : "Send code"}</button>
        </form>
      )}
      {step === "code" && (
        <>
          <small className="muted">Telegram sent a code to {sentTo || "your Telegram app"}. Type it here.</small>
          <form className="aic-add" onSubmit={(e) => { e.preventDefault(); go(async () => { const r = await call("tga-code", { code }); if (r.needPassword) { setHint(r.hint || null); setStep("password"); } else await done(r.name); }); }}>
            <input className="input" inputMode="numeric" autoComplete="one-time-code" placeholder="12345" value={code} onChange={(e) => setCode(e.target.value)} aria-label="Login code from Telegram" />
            <button type="submit" className="btn small" disabled={working || code.replace(/\D/g, "").length < 4}>{working ? "Checking…" : "Log in"}</button>
          </form>
          <button type="button" className="btn small ghost" style={{ alignSelf: "flex-start" }} onClick={() => { setStep("phone"); setCode(""); }}>Use a different number</button>
        </>
      )}
      {step === "password" && (
        <>
          <small className="muted">Your account has 2-step verification. Type your Telegram password{hint ? ` (hint: ${hint})` : ""}. It goes straight to Telegram and isn&apos;t saved.</small>
          <form className="aic-add" onSubmit={(e) => { e.preventDefault(); go(async () => { const r = await call("tga-password", { password: pw }); await done(r.name); }); }}>
            <input className="input" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} aria-label="Telegram 2-step verification password" />
            <button type="submit" className="btn small" disabled={working || !pw}>{working ? "Checking…" : "Log in"}</button>
          </form>
        </>
      )}
      {msg && <small className="aic-note" role="status">{msg}</small>}
    </div>
  );

  const shown = (chats || []).filter((c) => !find.trim() || c.title.toLowerCase().includes(find.trim().toLowerCase()));
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span className="aic-ok">✓ Logged in as {st.name}</span>
        <button type="button" className="btn small ghost" disabled={busy || working} onClick={() => { if (confirm("Log out of your Telegram account here? Your ticked groups stop being copied.")) onAct("tgao", "tga-logout", {}); }}>Log out</button>
      </div>
      {chats === null ? <button type="button" className="btn small" style={{ alignSelf: "flex-start" }} disabled={working || busy} onClick={() => go(async () => setChats((await call("tga-chats", {})).chats))}>{working ? "Loading your groups…" : "Show my groups"}</button>
        : !chats.length ? <small className="muted">You&apos;re not in any groups or channels.</small>
          : (
            <>
              <input className="input" placeholder={`Search ${chats.length} groups and channels`} value={find} onChange={(e) => setFind(e.target.value)} aria-label="Search your Telegram groups" />
              <div className="aic-list aic-scroll">{shown.slice(0, 300).map((ch) => {
                const have = mine.find((x) => x.ref === ch.ref);
                return (
                  <label key={ch.ref} className={"aic-row" + (have?.enabled ? " on" : "")}>
                    <input type="checkbox" checked={!!have?.enabled} disabled={busy || working}
                      onChange={(e) => have ? onAct(`src${have.id}`, "source", { op: "toggle", id: have.id, enabled: e.target.checked }, e.target.checked ? `Copying ${ch.title}.` : `Stopped copying ${ch.title}.`)
                        : onAct("add", "source", { op: "add", kind: "tg_chat", ref: ch.ref, title: ch.title, handle: ch.username })} />
                    <span className="grow"><b>{ch.title}</b><small className="muted">{ch.kind === "channel" ? "Channel" : "Group"}{ch.members ? ` · ${ch.members.toLocaleString("en-US")} members` : ""}{have?.enabled ? ` · ${ago(have.last_post_at)}` : ""}</small></span>
                  </label>
                );
              })}</div>
              <small className="muted">Ticked chats are read every minute (up to 25). Only messages posted after you tick a chat are copied.</small>
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
