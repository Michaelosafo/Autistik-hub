"use client";
/**
 * Admin (owner): copy trading. Link Telegram and pick the groups the bot follows; sign in with X and pick accounts,
 * Lists and Communities. Every contract address posted in a followed source is bought (honeypot check only) and sold
 * at the copy target (default 2x) or stop-loss (default -5%).
 */
import { useEffect, useState } from "react";
import AITraderTgAccount, { type TgaState } from "@/components/AITraderTgAccount";
import { Callers, LiveChains, SourcePicker, RebuyBox, type Caller, type LiveWallet, type Rebuy } from "@/components/AITraderCopyExtras";

export type CopySource = { id: number; kind: "tg" | "tg_chat" | "x_account" | "x_list" | "x_community"; ref: string; title: string | null; enabled: boolean; last_post_at: string | null };
export type CopyData = {
  sources: CopySource[]; maxTax: number; callers: Caller[]; rebuys: Rebuy[]; wallets: LiveWallet[];
  tg: { ready: boolean; linked: boolean; username: string | null };
  tga: TgaState;
  x: { loginReady: boolean; signedIn: boolean; username: string | null; canRead: boolean; communities: boolean };
};
type Settings = { use_tg: boolean; use_x: boolean; use_general: boolean; copy_check: boolean; enabled: boolean; mode: "paper" | "live"; copy_on: boolean; copy_tp: number; copy_sl: number; per_trade_usd: number; per_trade: number; trade_mode: string; rebuy_on: boolean; rebuy_dump: number; rebuy_tp: number };
type Act = (name: string, action: string, body: unknown, done?: string) => Promise<void>;

async function call(action: string, body: unknown) {
  const r = await fetch(`/api/ai-trader/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "Something went wrong.");
  return d;
}
const ago = (iso: string | null) => { if (!iso) return "no posts yet"; const s = (Date.now() - Date.parse(iso)) / 1000; return s < 60 ? "posted now" : s < 3600 ? `posted ${Math.floor(s / 60)}m ago` : s < 86400 ? `posted ${Math.floor(s / 3600)}h ago` : `posted ${Math.floor(s / 86400)}d ago`; };

export default function AITraderCopy({ c, s, owner, busy, onAct, reload }: { c: CopyData; s: Settings; owner: boolean; busy: boolean; onAct: Act; reload: () => Promise<void> }) {
  const [note, setNote] = useState("");
  const [tgLink, setTgLink] = useState<{ link: string; canReadGroups: boolean; username: string } | null>(null);
  const [lists, setLists] = useState<{ id: string; name: string; members: number | null; owned: boolean }[] | null>(null);
  const [handle, setHandle] = useState("");
  const [follows, setFollows] = useState<{ handle: string; name: string; image: string | null }[] | null>(null);
  const [find, setFind] = useState("");
  const [community, setCommunity] = useState("");
  const [tp, setTp] = useState(""), [sl, setSl] = useState("");

  // Coming back from the X sign-in page.
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    const x = q.get("x");
    if (!x) return;
    setNote(x === "ok" ? `Signed in with X as @${q.get("as") || ""}. Pick the Lists to copy below.` : x === "cancelled" ? "X sign-in was cancelled." : x === "owner-only" ? "Only the owner can sign in with X here." : `X sign-in didn't work: ${q.get("why") || "try again"}`);
    history.replaceState(null, "", location.pathname);
  }, []);

  const tgSrc = c.sources.filter((x) => x.kind === "tg");
  const xSrc = c.sources.filter((x) => x.kind.startsWith("x_"));
  const following = c.sources.filter((x) => x.enabled).length;
  const kindName = { tg: "Telegram (bot)", tg_chat: "Telegram", x_account: "X account", x_list: "X List", x_community: "X Community" } as const;

  async function run(fn: () => Promise<void>) { setNote(""); try { await fn(); } catch (e) { setNote((e as Error).message); } }
  const toggle = (x: CopySource, on: boolean) => onAct(`src${x.id}`, "source", { op: "toggle", id: x.id, enabled: on }, on ? `Copying ${x.title || x.ref}.` : `Stopped copying ${x.title || x.ref}.`);
  const remove = (x: CopySource) => { if (confirm(`Stop following ${x.title || x.ref} and remove it?`)) onAct(`src${x.id}`, "source", { op: "remove", id: x.id }, "Removed."); };
  const add = (kind: string, ref: string, title?: string) => onAct("add", "source", { op: "add", kind, ref, title });

  const Row = ({ x }: { x: CopySource }) => (
    <label className={"aic-row" + (x.enabled ? " on" : "")}>
      <input type="checkbox" checked={x.enabled} disabled={busy || !owner} onChange={(e) => toggle(x, e.target.checked)} />
      <span className="grow"><b>{x.title || x.ref}</b><small className="muted">{kindName[x.kind]} · {ago(x.last_post_at)}</small></span>
      {owner && <button type="button" className="aic-x" aria-label={`Remove ${x.title || x.ref}`} disabled={busy} onClick={(e) => { e.preventDefault(); remove(x); }}>✕</button>}
    </label>
  );

  return (
    <section className={"card stack aic" + (s.copy_on ? " on" : "")}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <div><b>📡 Copy trading</b><br /><small className="muted">{following ? `Following ${following} source${following === 1 ? "" : "s"}` : "Not following anything yet"}</small></div>
        <label className="ait-check" style={{ margin: 0 }}><input type="checkbox" checked={s.copy_on} disabled={busy || !owner} onChange={(e) => onAct("copy", "settings", { copy_on: e.target.checked }, e.target.checked ? "Copy trading on." : "Copy trading off. Open copy trades still sell at their target or stop-loss.")} /> <span>On</span></label>
      </div>
      <p className="muted" style={{ margin: 0 }}>Any coin (contract address) posted in a group or account you follow is bought within seconds, then sold at the target or the stop-loss. {s.copy_check ? `With the honeypot check on, it skips coins that can't be sold or have a ${c.maxTax}%+ tax.` : "No checks: every call is bought straight away."}</p>
      <label className="ait-check" style={{ margin: 0 }}>
        <input type="checkbox" checked={s.copy_check} disabled={busy || !owner} onChange={(e) => onAct("cc", "settings", { copy_check: e.target.checked }, e.target.checked ? "Honeypot check on for copy trades." : "No checks on copy trades: every call is bought.")} />
        <span>Honeypot check on copy trades <small className="muted">(off: buys every call. A honeypot can&apos;t be sold, so its stop-loss can&apos;t work.)</small></span>
      </label>

      <SourcePicker tg={s.use_tg} x={s.use_x} general={s.use_general} busy={busy || !owner} onAct={onAct} />
      <LiveChains list={c.wallets || []} live={s.mode === "live"} busy={busy || !owner} onAct={onAct} />

      <div className="aic-rules">
        <label><small className="muted">Sell at profit</small>
          <span className="ait-in"><em>+</em><input inputMode="decimal" disabled={busy || !owner} value={tp || String(s.copy_tp)} onChange={(e) => setTp(e.target.value)} onBlur={() => { if (tp && Number(tp) !== s.copy_tp) onAct("tp", "settings", { copy_tp: Number(tp) }, `Copy trades now sell at +${Number(tp)}% (${(1 + Number(tp) / 100).toFixed(2).replace(/\.00$/, "")}x).`); setTp(""); }} /><em>%</em></span>
          <small className="muted">{(1 + s.copy_tp / 100).toFixed(2).replace(/\.00$/, "")}x your money</small></label>
        <label><small className="muted">Stop-loss</small>
          <span className="ait-in"><em>−</em><input inputMode="decimal" disabled={busy || !owner} value={sl || String(s.copy_sl)} onChange={(e) => setSl(e.target.value)} onBlur={() => { if (sl && Number(sl) !== s.copy_sl) onAct("sl", "settings", { copy_sl: Number(sl) }, `Copy trades now sell at −${Number(sl)}%.`); setSl(""); }} /><em>%</em></span>
          <small className="muted">sells if it falls this much</small></label>
      </div>
      <small className="muted">Each copy buy uses the trade size above ({s.per_trade_usd > 0 ? `$${s.per_trade_usd}` : `${s.per_trade} BNB`}) and counts toward &ldquo;Coins at once&rdquo;. {s.mode === "live" ? "Live: buys on the chains switched on under Live chains." : "Practice mode: pretend BNB, real prices."} {!s.enabled && <b>The trader is stopped, so nothing is copied until you press Start.</b>}</small>

      {/* Telegram */}
      <div className="aic-block">
        <b>✈️ Telegram</b>
        <AITraderTgAccount st={c.tga} sources={c.sources} busy={busy || !owner} reload={reload} onAct={onAct} />
        <details className="aic-more" open={c.tg.linked || tgSrc.length > 0}>
          <summary>Or use a bot instead {c.tg.linked ? <span className="aic-ok">✓ Linked{c.tg.username ? ` as ${c.tg.username}` : ""}</span> : null}</summary>
          <div className="stack" style={{ gap: 8, marginTop: 8 }}>
            <small className="muted">A bot reads posts the instant they land, but someone has to add it to each group.</small>
        {!c.tg.ready ? (
          <small className="muted">First make a bot: open <a href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer">@BotFather</a>, send <code>/newbot</code>, then send <code>/setprivacy</code>, choose the bot and pick <b>Disable</b> so it can read group messages. Add the token it gives you in Vercel as <code>TELEGRAM_BOT_TOKEN</code> and redeploy.</small>
        ) : !c.tg.linked ? (
          <div className="stack" style={{ gap: 6 }}>
            <small className="muted">Link your Telegram so the bot knows which groups are yours and can message you about every trade.</small>
            {tgLink ? (
              <>
                <a className="btn" href={tgLink.link} target="_blank" rel="noopener noreferrer" style={{ alignSelf: "flex-start" }}>Open @{tgLink.username} and press Start</a>
                <small className="muted">Then come back and refresh. The link works for 15 minutes.</small>
              </>
            ) : <button type="button" className="btn" style={{ alignSelf: "flex-start" }} disabled={busy || !owner} onClick={() => run(async () => setTgLink(await call("tg-link", {})))}>Link the bot</button>}
          </div>
        ) : (
          <small className="muted">Add the bot to any group or channel to copy it: it shows up here and is followed straight away. Telegram doesn&apos;t let bots see your other groups, so only groups the bot is in can be listed. In channels the bot must be an admin.</small>
        )}
        {tgLink && !tgLink.canReadGroups && <small className="aic-warn">⚠ The bot can&apos;t read normal group messages yet. In @BotFather send <code>/setprivacy</code>, pick the bot, choose <b>Disable</b>, then remove and re-add it to your groups (or make it a group admin).</small>}
        {tgSrc.length > 0 && <div className="aic-list">{tgSrc.map((x) => <Row key={x.id} x={x} />)}</div>}
        {c.tg.linked && owner && <button type="button" className="btn small ghost" style={{ alignSelf: "flex-start" }} disabled={busy} onClick={() => onAct("tgu", "tg-unlink", {})}>Unlink Telegram</button>}
          </div>
        </details>
      </div>

      <Callers list={c.callers || []} normal={s.per_trade_usd > 0 ? `$${s.per_trade_usd}` : `${s.per_trade} BNB`} busy={busy || !owner} onAct={onAct} />
      <RebuyBox on={s.rebuy_on} dump={s.rebuy_dump} tp={s.rebuy_tp} sl={s.copy_sl} list={c.rebuys || []} busy={busy || !owner} onAct={onAct} />

      {/* X */}
      <div className="aic-block">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <b>𝕏 X</b>
          {c.x.signedIn ? <span className="aic-ok">✓ Signed in as @{c.x.username}</span> : null}
        </div>
        {!c.x.loginReady && !c.x.canRead ? (
          <small className="muted">Reading X needs a paid X developer app. Create one at <a href="https://developer.x.com" target="_blank" rel="noopener noreferrer">developer.x.com</a>, turn on OAuth 2.0 with the callback <code>https://autistik.io/api/ai-trader/x-callback</code>, and add <code>X_CLIENT_ID</code> and <code>X_CLIENT_SECRET</code> in Vercel. For X Communities also add a <a href="https://twitterapi.io" target="_blank" rel="noopener noreferrer">twitterapi.io</a> key as <code>TWITTERAPI_IO_KEY</code>. Then redeploy.</small>
        ) : !c.x.signedIn && c.x.loginReady ? (
          <button type="button" className="btn" style={{ alignSelf: "flex-start" }} disabled={busy || !owner} onClick={() => run(async () => { const r = await call("x-login", {}); location.href = r.url; })}>Log in with X</button>
        ) : null}

        {(c.x.signedIn || c.x.canRead) && (
          <div className="stack" style={{ gap: 10 }}>
            <div>
              <small className="muted">Add any account</small>
              <form className="aic-add" onSubmit={(e) => { e.preventDefault(); if (handle.trim()) { add("x_account", handle.trim()); setHandle(""); } }}>
                <input className="input" placeholder="@handle or x.com/handle" value={handle} onChange={(e) => setHandle(e.target.value)} aria-label="X account to copy" disabled={!owner} />
                <button type="submit" className="btn small" disabled={busy || !owner || !handle.trim()}>Add</button>
              </form>
            </div>
            {c.x.signedIn && (
              <div>
                <small className="muted">Accounts you follow on X</small>
                {follows === null ? <button type="button" className="btn small" style={{ display: "block", marginTop: 4 }} disabled={busy || !owner} onClick={() => run(async () => setFollows((await call("x-following", {})).accounts))}>Show accounts I follow</button>
                  : !follows.length ? <small className="muted" style={{ display: "block" }}>You don&apos;t follow anyone on X yet.</small>
                    : (
                      <>
                        <input className="input" style={{ marginTop: 4 }} placeholder={`Search ${follows.length} accounts`} value={find} onChange={(e) => setFind(e.target.value)} aria-label="Search accounts you follow" />
                        <div className="aic-list aic-scroll">{follows.filter((f) => !find.trim() || (f.handle + " " + f.name).toLowerCase().includes(find.trim().toLowerCase().replace(/^@/, ""))).slice(0, 200).map((f) => {
                          const have = xSrc.find((x) => x.kind === "x_account" && x.ref === f.handle.toLowerCase());
                          return (
                            <label key={f.handle} className={"aic-row" + (have?.enabled ? " on" : "")}>
                              <input type="checkbox" checked={!!have?.enabled} disabled={busy || !owner} onChange={(e) => have ? toggle(have, e.target.checked) : add("x_account", f.handle)} />
                              {f.image ? <img src={f.image} alt="" width={28} height={28} className="aic-av" /> : <span className="aic-av" aria-hidden="true" />}
                              <span className="grow"><b>{f.name}</b><small className="muted">@{f.handle}{have?.last_post_at ? ` · ${ago(have.last_post_at)}` : ""}</small></span>
                            </label>
                          );
                        })}</div>
                      </>
                    )}
              </div>
            )}
            {c.x.signedIn && (
              <div>
                <small className="muted">Your Lists</small>
                {lists === null ? <button type="button" className="btn small" style={{ display: "block", marginTop: 4 }} disabled={busy || !owner} onClick={() => run(async () => setLists((await call("x-lists", {})).lists))}>Show my Lists</button>
                  : !lists.length ? <small className="muted" style={{ display: "block" }}>You don&apos;t own or follow any Lists on X.</small>
                    : <div className="aic-list">{lists.map((l) => {
                      const have = xSrc.find((x) => x.kind === "x_list" && x.ref === l.id);
                      return have ? <Row key={l.id} x={have} /> : (
                        <label key={l.id} className="aic-row">
                          <input type="checkbox" checked={false} disabled={busy || !owner} onChange={() => add("x_list", l.id, l.name)} />
                          <span className="grow"><b>{l.name}</b><small className="muted">X List{l.members != null ? ` · ${l.members} members` : ""}{l.owned ? " · yours" : " · followed"}</small></span>
                        </label>
                      );
                    })}</div>}
              </div>
            )}
            <div>
              <small className="muted">Communities {!c.x.communities && "(needs TWITTERAPI_IO_KEY)"}</small>
              <form className="aic-add" onSubmit={(e) => { e.preventDefault(); if (community.trim()) { add("x_community", community.trim()); setCommunity(""); } }}>
                <input className="input" placeholder="x.com/i/communities/…" value={community} onChange={(e) => setCommunity(e.target.value)} aria-label="X Community link" disabled={!owner || !c.x.communities} />
                <button type="submit" className="btn small" disabled={busy || !owner || !community.trim() || !c.x.communities}>Add</button>
              </form>
              <small className="muted">X doesn&apos;t let apps list your Communities, so paste each one&apos;s link.</small>
            </div>
            {(() => {
              const rest = xSrc.filter((x) => !(x.kind === "x_list" && lists?.some((l) => l.id === x.ref)) && !(x.kind === "x_account" && follows?.some((f) => f.handle.toLowerCase() === x.ref)));
              return rest.length > 0 && <div><small className="muted">Following</small><div className="aic-list">{rest.map((x) => <Row key={x.id} x={x} />)}</div></div>;
            })()}
            <small className="muted">Accounts are checked every minute; up to 3 Lists or Communities are read each minute, taking turns, to stay inside X&apos;s limits.</small>
            {c.x.signedIn && owner && <button type="button" className="btn small ghost" style={{ alignSelf: "flex-start" }} disabled={busy} onClick={() => onAct("xo", "x-logout", {})}>Sign out of X</button>}
          </div>
        )}
      </div>
      {note && <small className="aic-note" role="status">{note}</small>}
    </section>
  );
}
