/**
 * Copy-trading sources for the AI trader (owner only, server only).
 *
 * Telegram: the owner taps "Link Telegram", which opens the AUTISTIK bot with a one-time code; pressing Start links
 * their Telegram account. When the owner adds the bot to a group or channel, that chat is followed straight away;
 * chats someone else added it to show up switched off, for the owner to tick. The bot messages the owner about
 * every copy buy and sell.
 *
 * X: the owner signs in with X (OAuth 2.0 with PKCE; needs X_CLIENT_ID, and X_CLIENT_SECRET for a confidential
 * app), which loads their own and followed Lists to tick. Accounts are typed in. Communities are pasted as a link or
 * id and read through TwitterAPI.io (TWITTERAPI_IO_KEY), since the official X API has no way to read a
 * Community's posts.
 */
import { createHash, randomBytes } from "crypto";
import { supabaseService } from "@/lib/supabase/server";
import { tgSecret } from "@/lib/tg-secret";
import { T, tq } from "@/lib/ai-trader-ctx";

const SITE = (process.env.NEXT_PUBLIC_SITE_URL || "https://autistik.io").replace(/\/$/, "");
export const X_CALLBACK = `${SITE}/api/ai-trader/x-callback`;
export const TG_HOOK = `${SITE}/api/ai-trader/telegram`;

export type Source = { id: number; kind: "tg" | "x_account" | "x_list" | "x_community"; ref: string; title: string | null; enabled: boolean; polled_at: string; last_post_at: string | null };
export type Post = { id: string; text: string; user: string; url: string; at: number };

// ---------------------------------------------------------------- Telegram

const tgToken = () => process.env.TELEGRAM_BOT_TOKEN || "";
export const tgReady = () => !!tgToken();

export async function tg(method: string, body: Record<string, unknown> = {}): Promise<any> {
  const t = tgToken();
  if (!t) throw new Error("Add TELEGRAM_BOT_TOKEN in Vercel first (from @BotFather), then redeploy.");
  const r = await fetch(`https://api.telegram.org/bot${t}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
  const j = await r.json().catch(() => null);
  if (!j?.ok) throw new Error(`Telegram said: ${j?.description || r.status}`);
  return j.result;
}

/** Points Telegram at our webhook (messages, channel posts, and the bot being added to / removed from chats). */
export async function tgSetHook() {
  await tg("setWebhook", { url: TG_HOOK, secret_token: tgSecret(), allowed_updates: ["message", "channel_post", "edited_channel_post", "my_chat_member"], drop_pending_updates: false });
  const me = await tg("getMe");
  return { username: String(me?.username || ""), canReadGroups: me?.can_read_all_group_messages === true };
}

/** A one-time link that opens the bot; pressing Start there links the owner's Telegram (valid 15 minutes). */
export async function tgLinkStart(): Promise<{ link: string; username: string; canReadGroups: boolean }> {
  const me = await tgSetHook();
  const code = randomBytes(12).toString("hex");
  await supabaseService().from("ai_trader_settings").update({ tg_link_code: code, tg_link_until: new Date(Date.now() + 15 * 60_000).toISOString() }).eq("id", T());
  return { link: `https://t.me/${me.username}?start=${code}`, ...me };
}

/** Sends the current trader's linked Telegram a message (quietly does nothing if it isn't linked). */
export async function tgNotify(text: string) {
  if (!tgReady()) return;
  await tgTo(T(), text);
}

/** Sends a trader's linked Telegram a message (quietly does nothing if it isn't linked). */
async function tgTo(traderId: number, text: string) {
  const { data } = await supabaseService().from("ai_trader_settings").select("tg_user_id").eq("id", traderId).single();
  if (data?.tg_user_id) await tg("sendMessage", { chat_id: data.tg_user_id, text: text.slice(0, 3500), disable_web_page_preview: true }).catch(() => {});
}

/**
 * Handles the parts of a Telegram update that aren't trading: /start <code> (linking an admin's Telegram to their
 * trader), and the bot being added to or removed from a chat (it's followed by whichever admins added it). Returns a
 * post and the traders that follow its chat, or null if nobody should copy it. One bot serves every admin.
 */
export async function tgHandle(u: any): Promise<{ text: string; chat: string; url: string; at: number; traders: number[]; from: { id: string | null; username: string | null } } | null> {
  const sb = supabaseService();
  // Linking: /start <code> in a private chat with the bot.
  const pm = u?.message;
  if (pm?.chat?.type === "private") {
    const m = String(pm.text || "").match(/^\/start\s+([a-f0-9]{24})$/);
    if (!m) return null;
    const { data: s } = await sb.from("ai_trader_settings").select("id,tg_link_until").eq("tg_link_code", m[1]).maybeSingle();
    if (!s || !s.tg_link_until || Date.parse(s.tg_link_until) < Date.now()) {
      await tg("sendMessage", { chat_id: pm.chat.id, text: "That link has expired. Open the AI trader page and tap Log in with Telegram again." }).catch(() => {});
      return null;
    }
    // One Telegram account belongs to one trader.
    await sb.from("ai_trader_settings").update({ tg_user_id: null, tg_username: null }).eq("tg_user_id", pm.from.id).neq("id", s.id);
    await sb.from("ai_trader_settings").update({ tg_user_id: pm.from.id, tg_username: pm.from.username ? `@${pm.from.username}` : pm.from.first_name || null, tg_link_code: null, tg_link_until: null }).eq("id", s.id);
    await tg("sendMessage", { chat_id: pm.chat.id, text: "✅ Linked to your AUTISTIK AI trader.\n\nNow add me to the groups or channels you want copied. Any group you add me to is followed straight away, and I'll message you here about every buy and sell." }).catch(() => {});
    return null;
  }
  // The bot was added to or removed from a group / channel.
  const cm = u?.my_chat_member;
  if (cm?.chat && cm.chat.type !== "private") {
    const ref = String(cm.chat.id), title = String(cm.chat.title || cm.chat.username || ref);
    const st = String(cm.new_chat_member?.status || "");
    if (st === "member" || st === "administrator") {
      // Followed by the admin who added it; if no linked admin added it, it shows up switched off for the owner.
      const { data: by } = await sb.from("ai_trader_settings").select("id").eq("tg_user_id", Number(cm.from?.id) || -1).maybeSingle();
      const tid = by?.id ? Number(by.id) : 1;
      await sb.from("ai_trader_sources").upsert({ trader_id: tid, kind: "tg", ref, title, ...(by ? { enabled: true } : {}) }, { onConflict: "trader_id,kind,ref" });
      await tgTo(tid, by ? `📡 Now following "${title}". Every coin posted there will be bought.` : `📡 I was added to "${title}". It's switched off: tick it on the AI trader page to copy it.`);
    } else if (st === "left" || st === "kicked") {
      const { data: had } = await sb.from("ai_trader_sources").update({ enabled: false, title: `${title} (bot removed)` }).eq("kind", "tg").eq("ref", ref).select("trader_id");
      for (const h of had || []) await tgTo(Number(h.trader_id), `I was removed from "${title}", so it's no longer followed.`);
    }
    return null;
  }
  // A post in a chat: copied by every trader that follows that chat.
  const m = u?.channel_post || u?.message || u?.edited_channel_post;
  if (!m?.chat || m.chat.type === "private") return null;
  const text = String(m.text || m.caption || "");
  if (!text) return null;
  const ref = String(m.chat.id);
  const { data: srcs } = await sb.from("ai_trader_sources").select("id,trader_id,enabled").eq("kind", "tg").eq("ref", ref);
  if (!srcs?.length) {
    // The bot is in a chat we never saw it join (it joined before this was set up): show it to the owner, switched off.
    await sb.from("ai_trader_sources").upsert({ trader_id: 1, kind: "tg", ref, title: String(m.chat.title || m.chat.username || ref), enabled: false }, { onConflict: "trader_id,kind,ref", ignoreDuplicates: true });
    return null;
  }
  const on = srcs.filter((x: any) => x.enabled);
  if (!on.length) return null;
  await sb.from("ai_trader_sources").update({ last_post_at: new Date().toISOString() }).in("id", on.map((x: any) => x.id));
  const chat = String(m.chat.title || m.chat.username || "Telegram");
  const url = m.chat.username ? `https://t.me/${m.chat.username}/${m.message_id}` : `tg:${m.chat.id}:${m.message_id}`;
  const by = m.from || m.sender_chat || null;
  const from = { id: by?.id != null ? String(by.id) : null, username: by?.username ? String(by.username).toLowerCase() : null };
  return { text, chat, url, at: (Number(m.edit_date || m.date) || Date.now() / 1000) * 1000, traders: [...new Set(on.map((x: any) => Number(x.trader_id)))], from };
}

// ---------------------------------------------------------------- X sign-in

export const xLoginReady = () => !!process.env.X_CLIENT_ID;
const b64url = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** The X sign-in page address (PKCE; the verifier and state are kept server side for 10 minutes). */
export async function xAuthUrl(): Promise<string> {
  const id = process.env.X_CLIENT_ID;
  if (!id) throw new Error("Add X_CLIENT_ID (and X_CLIENT_SECRET) from your X developer app in Vercel first, then redeploy.");
  const verifier = b64url(randomBytes(48)), state = b64url(randomBytes(18));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  await supabaseService().from("ai_trader_x_auth").upsert({ id: T(), pkce_verifier: verifier, state, state_at: new Date().toISOString() });
  const q = new URLSearchParams({ response_type: "code", client_id: id, redirect_uri: X_CALLBACK, scope: "tweet.read users.read list.read follows.read offline.access", state, code_challenge: challenge, code_challenge_method: "S256" });
  return `https://x.com/i/oauth2/authorize?${q}`;
}

async function xTokenCall(body: Record<string, string>) {
  const id = process.env.X_CLIENT_ID || "", secret = process.env.X_CLIENT_SECRET || "";
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };
  if (secret) headers.authorization = `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`;
  const r = await fetch("https://api.x.com/2/oauth2/token", { method: "POST", headers, body: new URLSearchParams({ ...body, client_id: id }), signal: AbortSignal.timeout(10_000) });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.access_token) throw new Error(`X sign-in failed: ${j?.error_description || j?.error || r.status}`);
  return j as { access_token: string; refresh_token?: string; expires_in?: number };
}

async function saveTokens(j: { access_token: string; refresh_token?: string; expires_in?: number }) {
  await supabaseService().from("ai_trader_x_auth").update({
    access_token: j.access_token, ...(j.refresh_token ? { refresh_token: j.refresh_token } : {}),
    expires_at: new Date(Date.now() + (Number(j.expires_in) || 7200) * 1000 - 60_000).toISOString(),
  }).eq("id", T());
}

/** Finishes the X sign-in: checks the state, swaps the code for tokens and records who signed in. */
export async function xFinish(code: string, state: string): Promise<string> {
  const sb = supabaseService();
  const { data: a } = await sb.from("ai_trader_x_auth").select("state,state_at,pkce_verifier").eq("id", T()).single();
  if (!a?.state || a.state !== state || !a.state_at || Date.now() - Date.parse(a.state_at) > 10 * 60_000) throw new Error("That sign-in has expired. Try again.");
  const j = await xTokenCall({ grant_type: "authorization_code", code, redirect_uri: X_CALLBACK, code_verifier: a.pkce_verifier || "" });
  await sb.from("ai_trader_x_auth").update({ state: null, pkce_verifier: null }).eq("id", T());
  await saveTokens(j);
  const me = await xGet("/2/users/me");
  const u = me?.data;
  await sb.from("ai_trader_settings").update({ x_user_id: u?.id || null, x_username: u?.username || null }).eq("id", T());
  return String(u?.username || "");
}

/** The owner's X access token, refreshed when it's about to run out (null if they haven't signed in). */
async function xUserToken(): Promise<string | null> {
  const sb = supabaseService();
  const { data: a } = await sb.from("ai_trader_x_auth").select("access_token,refresh_token,expires_at").eq("id", T()).single();
  if (!a?.access_token) return null;
  if (a.expires_at && Date.parse(a.expires_at) > Date.now()) return a.access_token;
  if (!a.refresh_token) return null;
  try { const j = await xTokenCall({ grant_type: "refresh_token", refresh_token: a.refresh_token }); await saveTokens(j); return j.access_token; }
  catch { return null; }
}

export async function xSignOut() {
  const sb = supabaseService();
  await sb.from("ai_trader_x_auth").update({ access_token: null, refresh_token: null, expires_at: null }).eq("id", T());
  await sb.from("ai_trader_settings").update({ x_user_id: null, x_username: null }).eq("id", T());
}

/** GET on the official X API with the owner's token, or the app's bearer token as a fallback. */
async function xGet(path: string): Promise<any> {
  const tok = (await xUserToken()) || process.env.X_BEARER_TOKEN || "";
  if (!tok) throw new Error("Sign in with X first.");
  const r = await fetch(`https://api.x.com${path}`, { headers: { authorization: `Bearer ${tok}` }, cache: "no-store", signal: AbortSignal.timeout(10_000) });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`X said: ${j?.detail || j?.title || r.status}`);
  return j;
}

/** The owner's own and followed X Lists, to pick from. */
export async function xMyLists(): Promise<{ id: string; name: string; members: number | null; owned: boolean }[]> {
  const { data: s } = await supabaseService().from("ai_trader_settings").select("x_user_id").eq("id", T()).single();
  if (!s?.x_user_id) throw new Error("Sign in with X first.");
  const f = "?max_results=100&list.fields=member_count";
  const [own, fol] = await Promise.all([xGet(`/2/users/${s.x_user_id}/owned_lists${f}`).catch(() => null), xGet(`/2/users/${s.x_user_id}/followed_lists${f}`).catch(() => null)]);
  const out = new Map<string, { id: string; name: string; members: number | null; owned: boolean }>();
  for (const [j, owned] of [[own, true], [fol, false]] as const) for (const l of j?.data || []) if (!out.has(l.id)) out.set(l.id, { id: String(l.id), name: String(l.name || l.id), members: l.member_count ?? null, owned });
  return [...out.values()];
}

/** Accounts the trader's X user follows (up to 1,000), to tick which to copy. */
export async function xFollowing(): Promise<{ handle: string; name: string; image: string | null }[]> {
  const { data: s } = await supabaseService().from("ai_trader_settings").select("x_user_id").eq("id", T()).single();
  if (!s?.x_user_id) throw new Error("Log in with X first.");
  const out: { handle: string; name: string; image: string | null }[] = [];
  let next = "";
  for (let page = 0; page < 1; page++) {
    const j = await xGet(`/2/users/${s.x_user_id}/following?max_results=1000&user.fields=profile_image_url${next ? `&pagination_token=${next}` : ""}`);
    for (const u of j?.data || []) out.push({ handle: String(u.username), name: String(u.name || u.username), image: u.profile_image_url || null });
    next = j?.meta?.next_token || "";
    if (!next) break;
  }
  return out;
}

/** An X Community id from a link (x.com/i/communities/123…) or a bare id, plus its name when TwitterAPI.io can say. */
export async function xCommunity(raw: string): Promise<{ id: string; name: string }> {
  const id = (String(raw).match(/communities\/(\d{5,25})/) || String(raw).trim().match(/^(\d{5,25})$/))?.[1];
  if (!id) throw new Error("Paste a Community link like x.com/i/communities/1234567890.");
  let name = `Community ${id}`;
  const key = process.env.TWITTERAPI_IO_KEY;
  if (key) {
    const j = await fetch(`https://api.twitterapi.io/twitter/community/info?community_id=${id}`, { headers: { "X-API-Key": key }, signal: AbortSignal.timeout(8000) }).then((r) => r.json()).catch(() => null);
    if (j?.community_info?.name) name = String(j.community_info.name);
  } else {
    const j = await xGet(`/2/communities/${id}`).catch(() => null);
    if (j?.data?.name) name = String(j.data.name);
  }
  return { id, name };
}

const fresh = (p: Post) => Date.now() - p.at < 10 * 60_000;

/** New posts on one followed X List (official API). */
async function listPosts(id: string): Promise<Post[]> {
  const j = await xGet(`/2/lists/${id}/tweets?max_results=20&tweet.fields=created_at,author_id&expansions=author_id&user.fields=username`);
  const users = new Map<string, string>((j?.includes?.users || []).map((u: any) => [u.id, u.username]));
  return (j?.data || []).map((t: any) => {
    const user = users.get(t.author_id) || "i";
    return { id: String(t.id), text: String(t.text || ""), user, url: `https://x.com/${user}/status/${t.id}`, at: Date.parse(t.created_at) || Date.now() };
  }).filter(fresh);
}

/** New posts in one X Community (TwitterAPI.io; the official API can't read Community posts). */
async function communityPosts(id: string): Promise<Post[]> {
  const key = process.env.TWITTERAPI_IO_KEY;
  if (!key) throw new Error("Reading X Communities needs TWITTERAPI_IO_KEY in Vercel.");
  const j = await fetch(`https://api.twitterapi.io/twitter/community/tweets?community_id=${id}`, { headers: { "X-API-Key": key }, cache: "no-store", signal: AbortSignal.timeout(10_000) }).then((r) => r.json()).catch(() => null);
  return ((j?.tweets || []) as any[]).map((t) => ({ id: String(t.id), text: String(t.text || ""), user: String(t.author?.userName || ""), url: String(t.url || `https://x.com/i/status/${t.id}`), at: Date.parse(t.createdAt) || Date.now() })).filter(fresh);
}

/** New posts from followed X accounts: TwitterAPI.io if set, else the official recent search. */
async function accountPosts(handles: string[]): Promise<Post[]> {
  if (!handles.length) return [];
  const q = handles.slice(0, 20).map((h) => `from:${h}`).join(" OR ");
  const key = process.env.TWITTERAPI_IO_KEY;
  if (key) {
    const j = await fetch(`https://api.twitterapi.io/twitter/tweet/advanced_search?queryType=Latest&query=${encodeURIComponent(q)}`, { headers: { "X-API-Key": key }, cache: "no-store", signal: AbortSignal.timeout(10_000) }).then((r) => r.json()).catch(() => null);
    return ((j?.tweets || []) as any[]).map((t) => ({ id: String(t.id), text: String(t.text || ""), user: String(t.author?.userName || ""), url: String(t.url || `https://x.com/i/status/${t.id}`), at: Date.parse(t.createdAt) || Date.now() })).filter(fresh);
  }
  const j = await xGet(`/2/tweets/search/recent?max_results=25&tweet.fields=created_at,author_id&expansions=author_id&user.fields=username&query=${encodeURIComponent(`(${q}) -is:retweet`)}`);
  const users = new Map<string, string>((j?.includes?.users || []).map((u: any) => [u.id, u.username]));
  return (j?.data || []).map((t: any) => {
    const user = users.get(t.author_id) || "i";
    return { id: String(t.id), text: String(t.text || ""), user, url: `https://x.com/${user}/status/${t.id}`, at: Date.parse(t.created_at) || Date.now() };
  }).filter(fresh);
}

export const xReadReady = async () => !!(process.env.TWITTERAPI_IO_KEY || process.env.X_BEARER_TOKEN || (await xUserToken()));

/**
 * Every minute: new posts from the followed X accounts (all at once), plus up to 3 Lists / Communities, oldest-read
 * first, so X's rate limits (about 75 List reads per 15 minutes) aren't hit. Errors are reported, not thrown.
 */
export async function xFollowedPosts(): Promise<{ posts: (Post & { label: string })[]; errors: string[] }> {
  const sb = supabaseService();
  const { data } = await tq("ai_trader_sources").select("*").eq("enabled", true).in("kind", ["x_account", "x_list", "x_community"]);
  const all = (data || []) as Source[];
  const posts: (Post & { label: string })[] = [], errors: string[] = [];
  const handles = all.filter((s) => s.kind === "x_account").map((s) => s.ref);
  if (handles.length) {
    try { for (const p of await accountPosts(handles)) posts.push({ ...p, label: `@${p.user} posted it on X` }); }
    catch (e) { errors.push(`X accounts: ${(e as Error).message}`); }
  }
  const feeds = all.filter((s) => s.kind !== "x_account").sort((a, b) => Date.parse(a.polled_at) - Date.parse(b.polled_at)).slice(0, 3);
  for (const f of feeds) {
    await tq("ai_trader_sources").update({ polled_at: new Date().toISOString() }).eq("id", f.id);
    try {
      const ps = f.kind === "x_list" ? await listPosts(f.ref) : await communityPosts(f.ref);
      const where = f.kind === "x_list" ? `the X List "${f.title || f.ref}"` : `the X Community "${f.title || f.ref}"`;
      for (const p of ps) posts.push({ ...p, label: `@${p.user} posted it in ${where}` });
      if (ps.length) await tq("ai_trader_sources").update({ last_post_at: new Date().toISOString() }).eq("id", f.id);
    } catch (e) { errors.push(`${f.title || f.ref}: ${(e as Error).message}`); }
  }
  return { posts, errors };
}
