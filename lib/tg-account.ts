/**
 * Telegram account login for the AI trader (server only). An admin signs in with their own Telegram account (phone
 * number, the code Telegram sends, and their 2-step password if they have one), then ticks which of their groups and
 * channels to copy. No bot is needed and nobody has to add anything to their group.
 *
 * Needs TELEGRAM_API_ID and TELEGRAM_API_HASH from my.telegram.org (free). The signed-in session is kept in the
 * database Vault, one per trader, and only the server can read it. Every minute the followed chats are read for new
 * messages (GramJS over MTProto); each contract address posted is copy-traded by the 1-minute loop.
 */
import { Api, TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { computeCheck } from "telegram/Password";
// The library's own big-number helper: chat ids must be ITS big-integer type, or it refuses them (CastError).
import { returnBigInt as bigInt } from "telegram/Helpers";
import QRCode from "qrcode";
import { supabaseService } from "@/lib/supabase/server";
import { T, tq } from "@/lib/ai-trader-ctx";

export const tgAccountReady = () => !!(Number(process.env.TELEGRAM_API_ID) && process.env.TELEGRAM_API_HASH);
const apiId = () => Number(process.env.TELEGRAM_API_ID);
const apiHash = () => String(process.env.TELEGRAM_API_HASH || "");

async function client(session = ""): Promise<TelegramClient> {
  if (!tgAccountReady()) throw new Error("Add TELEGRAM_API_ID and TELEGRAM_API_HASH (from my.telegram.org) in Vercel first, then redeploy.");
  const c = new TelegramClient(new StringSession(session), apiId(), apiHash(), { connectionRetries: 2, deviceModel: "AUTISTIK AI trader", appVersion: "1.0", systemVersion: "server" });
  c.setLogLevel("error" as any);
  await c.connect();
  return c;
}
async function close(c: TelegramClient | null) { try { await c?.destroy(); } catch { /* already closed */ } }

/** Plain-language versions of Telegram's sign-in errors. */
function friendly(e: unknown): string {
  const m = String((e as any)?.errorMessage || (e as Error)?.message || e);
  if (/PHONE_NUMBER_INVALID/.test(m)) return "That phone number isn't valid. Include the country code, like +233…";
  if (/PHONE_CODE_INVALID/.test(m)) return "That code is wrong. Check the code Telegram sent you and try again.";
  if (/PHONE_CODE_EXPIRED/.test(m)) return "That code has expired. Start again to get a new one.";
  if (/PASSWORD_HASH_INVALID/.test(m)) return "That 2-step verification password is wrong. It's the extra password you set in Telegram → Settings → Privacy and Security → Two-Step Verification.";
  if (/SRP_ID_INVALID|SRP_PASSWORD_CHANGED/.test(m)) return "That login timed out. Tap Start over and log in again.";
  if (/FLOOD_WAIT_(\d+)/.test(m)) return `Telegram asks to wait ${Math.ceil(Number(m.match(/FLOOD_WAIT_(\d+)/)![1]) / 60)} minutes before trying again.`;
  if (/AUTH_TOKEN_(EXPIRED|INVALID|ALREADY_ACCEPTED)/.test(m)) return "That QR code has expired. Tap Show QR code again.";
  if (DEAD.test(m)) return DEAD_NOTE;
  if (/PHONE_NUMBER_BANNED/.test(m)) return "Telegram says this number is banned.";
  if (/SEND_CODE_UNAVAILABLE/.test(m)) return "Telegram has no other way to send the code right now. Check the \"Telegram\" chat in your app, or wait a few minutes and start again.";
  if (/API_ID_INVALID/.test(m)) return "Telegram says TELEGRAM_API_ID / TELEGRAM_API_HASH don't match. Copy them again from my.telegram.org/apps into Vercel and redeploy.";
  if (/PHONE_CODE_EMPTY|PHONE_CODE_HASH_EMPTY/.test(m)) return "That login has expired. Start again.";
  return m.slice(0, 160);
}

/**
 * One connection per Telegram login at a time. Telegram ends a login (AUTH_KEY_DUPLICATED) when it's used from two
 * places at once, and on Vercel every request can be a different machine. The reader holds the turn while it watches;
 * anything else (refreshing the chat list, logging out) asks for the turn, the reader steps aside within ~2 seconds.
 */
async function takeTurn(kind: string, seconds: number, waitMs: number): Promise<string | null> {
  const owner = `${kind}:${Math.random().toString(36).slice(2)}`;
  const sb = supabaseService();
  const grab = async () => !!(await sb.rpc("ai_trader_tg_lock", { p_trader: T(), p_owner: owner, p_seconds: seconds })).data;
  if (await grab()) return owner;
  if (!waitMs) return null;
  await auth().update({ want_at: new Date().toISOString() }).eq("id", T());
  const end = Date.now() + waitMs;
  while (Date.now() < end) { await new Promise((ok) => setTimeout(ok, 500)); if (await grab()) return owner; }
  return null;
}
const giveTurn = (owner: string | null) => (owner ? supabaseService().rpc("ai_trader_tg_unlock", { p_trader: T(), p_owner: owner }).then(() => {}, () => {}) : Promise.resolve());
/** Someone else asked for the turn after `since`. */
async function wanted(since: number): Promise<boolean> {
  const { data } = await auth().select("want_at").eq("id", T()).maybeSingle();
  return !!data?.want_at && Date.parse(data.want_at) > since;
}
/** Telegram ended the login: forget it so the page asks to log in again (ticked chats are kept for after). */
const DEAD = /AUTH_KEY_DUPLICATED|AUTH_KEY_UNREGISTERED|SESSION_REVOKED|SESSION_EXPIRED|USER_DEACTIVATED/;
async function loginDied(e: unknown): Promise<boolean> {
  const m = String((e as any)?.errorMessage || (e as Error)?.message || e);
  if (!DEAD.test(m)) return false;
  await sessionSet(null);
  await auth().update({ signed_in_at: null }).eq("id", T());
  return true;
}
const DEAD_NOTE = "Telegram logged the bot out (the login was used from two places at once). Log in to Telegram again on the AI trader page; your ticked groups are kept.";

const sessionGet = async (): Promise<string> => {
  const { data } = await supabaseService().rpc("ai_trader_tg_session_get_for", { p_trader: T() });
  return typeof data === "string" ? data : "";
};
const sessionSet = (s: string | null) => supabaseService().rpc("ai_trader_tg_session_set_for", { p_trader: T(), p_session: s });
const auth = () => supabaseService().from("ai_trader_tg_auth");

/** Where Telegram sent the login code, in plain words (Telegram picks: in-app, SMS, email, a call…). */
function where(r: any): string {
  const t = r?.type, k = String(t?.className || "");
  if (k === "auth.SentCodeTypeApp") return "your Telegram app: open the chat called \"Telegram\" (blue tick) in your chat list, on any phone or computer where you're logged in";
  if (k === "auth.SentCodeTypeEmailCode") return `your login email${t?.emailPattern ? ` (${t.emailPattern})` : ""}`;
  if (k === "auth.SentCodeTypeSetUpEmailRequired") return "nowhere yet: Telegram wants a login email set up first. Open Telegram → Settings → Privacy and Security → Login Email, add one, then tap Send code again";
  if (k === "auth.SentCodeTypeFragmentSms") return `Fragment (fragment.com)${t?.url ? `: ${t.url}` : ""}`;
  if (/Call|FlashCall|MissedCall/.test(k)) return "a phone call to your number: the code is the last digits of the calling number, or read out to you";
  if (/Sms|Firebase/.test(k)) return "an SMS to your phone";
  return "your Telegram app (the chat called \"Telegram\")";
}
const nextWay = (r: any): string | null => {
  const k = String(r?.nextType?.className || "");
  return !k ? null : /Sms/.test(k) ? "by SMS" : /Call/.test(k) ? "by phone call" : /Email/.test(k) ? "by email" : "another way";
};

/** A login on another device is waiting for the 2-step password: don't throw it away unless asked to. */
async function guard(force: boolean) {
  if (force) return;
  const { data } = await auth().select("stage,pending_at").eq("id", T()).maybeSingle();
  if (data?.stage === "password" && data.pending_at && Date.now() - Date.parse(data.pending_at) < 10 * 60_000)
    throw new Error("A login is already waiting for your 2-step password (maybe from another device). Type the password, or tap Start over.");
}

/** Step 1: Telegram sends a login code (it decides where: usually in the Telegram app itself). */
export async function tgaStart(phoneRaw: string, force = false): Promise<{ sentTo: string; resend: string | null }> {
  await guard(force);
  const phone = phoneRaw.replace(/[^\d+]/g, "").replace(/^(?!\+)/, "+");
  if (!/^\+\d{7,15}$/.test(phone)) throw new Error("Type your phone number with the country code, like +233…");
  let c: TelegramClient | null = null;
  try {
    c = await client();
    const r: any = await c.invoke(new Api.auth.SendCode({ phoneNumber: phone, apiId: apiId(), apiHash: apiHash(), settings: new Api.CodeSettings({}) }));
    // The half-finished session (same server key) has to be reused for the next step.
    await auth().upsert({ id: T(), phone, code_hash: String(r.phoneCodeHash), pending_session: String(c.session.save()), pending_at: new Date().toISOString(), stage: "code", pw_hint: null });
    return { sentTo: where(r), resend: nextWay(r) };
  } catch (e) { throw new Error(friendly(e)); }
  finally { await close(c); }
}

/** Asks Telegram to send the code again, the next way it offers (usually SMS). */
export async function tgaResend(): Promise<{ sentTo: string; resend: string | null }> {
  const p = await pending();
  let c: TelegramClient | null = null;
  try {
    c = await client(p.pending_session);
    const r: any = await c.invoke(new Api.auth.ResendCode({ phoneNumber: p.phone, phoneCodeHash: p.code_hash }));
    await auth().update({ code_hash: String(r.phoneCodeHash || p.code_hash), pending_session: String(c.session.save()), pending_at: new Date().toISOString() }).eq("id", T());
    return { sentTo: where(r), resend: nextWay(r) };
  } catch (e) { throw new Error(friendly(e)); }
  finally { await close(c); }
}

async function finish(c: TelegramClient) {
  const me: any = await c.getMe();
  await sessionSet(String(c.session.save()));
  const name = me?.username ? `@${me.username}` : [me?.firstName, me?.lastName].filter(Boolean).join(" ") || "your account";
  await auth().update({ pending_session: null, code_hash: null, stage: null, pw_hint: null, account_name: name, signed_in_at: new Date().toISOString() }).eq("id", T());
  // Load the chat list right away, so it's there on every device.
  await saveChats(c).catch(() => {});
  return name;
}

async function pending(): Promise<{ phone: string; code_hash: string; pending_session: string; stage: string | null; pw_hint: string | null }> {
  const { data } = await auth().select("phone,code_hash,pending_session,pending_at,stage,pw_hint").eq("id", T()).maybeSingle();
  if (!data?.pending_session || !data.pending_at || Date.now() - Date.parse(data.pending_at) > 10 * 60_000) throw new Error("That login has expired. Start again.");
  return data as any;
}

// ---------------------------------------------------------------- QR login (no code needed)

const tokenUrl = (token: any) => `tg://login?token=${Buffer.from(token).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
async function qrOf(r: any) {
  const link = tokenUrl(r.token);
  return { link, qr: await QRCode.toDataURL(link, { margin: 1, width: 280, errorCorrectionLevel: "M" }), expires: Number(r.expires) * 1000 };
}

/**
 * QR login, like Telegram Desktop: shows a QR code (and a tg://login link) that the admin scans or opens in their
 * Telegram app (Settings → Devices → Link Desktop Device). No login code is sent, so nothing can get lost.
 */
export async function tgaQrStart(force = false): Promise<{ link: string; qr: string; expires: number }> {
  await guard(force);
  let c: TelegramClient | null = null;
  try {
    c = await client();
    const r: any = await c.invoke(new Api.auth.ExportLoginToken({ apiId: apiId(), apiHash: apiHash(), exceptIds: [] }));
    await auth().upsert({ id: T(), phone: null, code_hash: null, pending_session: String(c.session.save()), pending_at: new Date().toISOString(), stage: "qr", pw_hint: null });
    return await qrOf(r);
  } catch (e) { throw new Error(friendly(e)); }
  finally { await close(c); }
}

/** Checks the QR login: done, a 2-step password needed, or still waiting (with a fresh QR when the old one expired). */
export async function tgaQrCheck(): Promise<{ ok: true; name: string } | { needPassword: true; hint: string | null } | { waiting: true; link: string; qr: string; expires: number }> {
  const p = await pending();
  if (p.stage === "password") return { needPassword: true, hint: p.pw_hint };
  if (p.stage !== "qr") throw new Error("This QR login was replaced by a newer login. Tap Show QR code again.");
  let c: TelegramClient | null = null;
  try {
    c = await client(p.pending_session);
    let r: any;
    try {
      r = await c.invoke(new Api.auth.ExportLoginToken({ apiId: apiId(), apiHash: apiHash(), exceptIds: [] }));
      if (r?.className === "auth.LoginTokenMigrateTo") {
        // The account lives on another Telegram server: move there and finish the login.
        await (c as any)._switchDC(r.dcId);
        r = await c.invoke(new Api.auth.ImportLoginToken({ token: r.token }));
      }
    } catch (e) {
      if (/SESSION_PASSWORD_NEEDED/.test(String((e as any)?.errorMessage || e))) {
        const pw: any = await c.invoke(new Api.account.GetPassword());
        await auth().update({ pending_session: String(c.session.save()), pending_at: new Date().toISOString(), stage: "password", pw_hint: pw?.hint ? String(pw.hint) : null }).eq("id", T());
        return { needPassword: true, hint: pw?.hint ? String(pw.hint) : null };
      }
      throw e;
    }
    if (r?.className === "auth.LoginTokenSuccess") return { ok: true, name: await finish(c) };
    await auth().update({ pending_session: String(c.session.save()), pending_at: new Date().toISOString() }).eq("id", T());
    return { waiting: true, ...(await qrOf(r)) };
  } catch (e) { throw new Error(friendly(e)); }
  finally { await close(c); }
}

/** Step 2: the code. Returns needPassword when the account has 2-step verification. */
export async function tgaCode(codeRaw: string): Promise<{ ok: true; name: string } | { needPassword: true; hint: string | null }> {
  const code = codeRaw.replace(/\D/g, "");
  if (code.length < 4) throw new Error("Type the code Telegram sent you.");
  const p = await pending();
  let c: TelegramClient | null = null;
  try {
    c = await client(p.pending_session);
    try {
      await c.invoke(new Api.auth.SignIn({ phoneNumber: p.phone, phoneCodeHash: p.code_hash, phoneCode: code }));
    } catch (e) {
      if (/SESSION_PASSWORD_NEEDED/.test(String((e as any)?.errorMessage || e))) {
        const pw: any = await c.invoke(new Api.account.GetPassword());
        await auth().update({ pending_session: String(c.session.save()), pending_at: new Date().toISOString(), stage: "password", pw_hint: pw?.hint ? String(pw.hint) : null }).eq("id", T());
        return { needPassword: true, hint: pw?.hint ? String(pw.hint) : null };
      }
      throw e;
    }
    return { ok: true, name: await finish(c) };
  } catch (e) { throw new Error(friendly(e)); }
  finally { await close(c); }
}

/** Step 3 (only with 2-step verification): the password. It's checked by Telegram and never stored. */
export async function tgaPassword(password: string): Promise<{ ok: true; name: string }> {
  if (!password) throw new Error("Type your 2-step verification password.");
  const p = await pending();
  if (p.stage !== "password") throw new Error("This login isn't waiting for a password any more. Tap Start over and log in again.");
  let c: TelegramClient | null = null;
  try {
    c = await client(p.pending_session);
    const pw: any = await c.invoke(new Api.account.GetPassword());
    await c.invoke(new Api.auth.CheckPassword({ password: await computeCheck(pw, password) }));
    return { ok: true, name: await finish(c) };
  } catch (e) { throw new Error(friendly(e)); }
  finally { await close(c); }
}

/** Throws away a half-finished login (any device), so a new one can start. */
export async function tgaReset() {
  await auth().update({ pending_session: null, code_hash: null, stage: null, pw_hint: null }).eq("id", T());
}

/** Signs the session out on Telegram's side too, and forgets it. */
export async function tgaLogout() {
  const s = await sessionGet();
  if (s) { const turn = await takeTurn("logout", 30, 12_000); let c: TelegramClient | null = null; try { c = await client(s); await c.invoke(new Api.auth.LogOut()); } catch { /* already gone */ } finally { await close(c); await giveTurn(turn); } }
  await sessionSet(null);
  await auth().update({ account_name: null, signed_in_at: null, pending_session: null, code_hash: null, stage: null, pw_hint: null, chats: null, chats_at: null }).eq("id", T());
  await tq("ai_trader_sources").update({ enabled: false }).eq("kind", "tg_chat");
}

/** What every device should show: signed in (with the saved chat list), waiting for a password, or not signed in. */
export async function tgaStatus(): Promise<{ ready: boolean; signedIn: boolean; name: string | null; stage: string | null; hint: string | null; chats: MyChat[] | null; chatsAt: string | null }> {
  const { data } = await auth().select("account_name,signed_in_at,stage,pw_hint,pending_at,chats,chats_at").eq("id", T()).maybeSingle();
  const live = !!data?.pending_at && Date.now() - Date.parse(data.pending_at) < 10 * 60_000;
  return {
    ready: tgAccountReady(), signedIn: !!data?.signed_in_at, name: data?.account_name ?? null,
    stage: live ? data?.stage ?? null : null, hint: live ? data?.pw_hint ?? null : null,
    chats: Array.isArray(data?.chats) ? (data!.chats as MyChat[]) : null, chatsAt: data?.chats_at ?? null,
  };
}

/**
 * A chat's reference: "c:<id>:<accessHash>" for channels and supergroups, "g:<id>" for small groups. Kept with the
 * source, so the chat can be read again without listing every chat first.
 */
function peerOf(ref: string): any {
  if (ref.startsWith("@")) return ref.slice(1); // a public group / channel by @username (read without joining)
  const [k, id, hash] = ref.split(":");
  if (k === "c") return new Api.InputPeerChannel({ channelId: bigInt(id), accessHash: bigInt(hash) });
  if (k === "g") return new Api.InputPeerChat({ chatId: bigInt(id) });
  if (k === "u") return new Api.InputPeerUser({ userId: bigInt(id), accessHash: bigInt(hash) });
  throw new Error("Unknown chat.");
}

export type MyChat = { ref: string; title: string; kind: "group" | "channel" | "chat" | "bot"; members: number | null; username: string | null };

/** Every group, channel and private chat (people and bots) of an open client, most recent first. */
async function listChats(c: TelegramClient): Promise<MyChat[]> {
  const ds: any[] = await c.getDialogs({ limit: 400 });
  const out: MyChat[] = [];
  for (const d of ds) {
    const e: any = d.entity;
    if (!e) continue;
    if (e.className === "Channel") out.push({ ref: `c:${e.id}:${e.accessHash}`, title: String(e.title || "Channel"), kind: e.broadcast ? "channel" : "group", members: e.participantsCount ?? null, username: e.username || null });
    else if (e.className === "Chat" && !e.deactivated) out.push({ ref: `g:${e.id}`, title: String(e.title || "Group"), kind: "group", members: e.participantsCount ?? null, username: null });
    else if (e.className === "User" && !e.self && !e.deleted && e.accessHash != null && String(e.id) !== "777000") {
      const name = [e.firstName, e.lastName].filter(Boolean).join(" ") || (e.username ? `@${e.username}` : "Chat");
      out.push({ ref: `u:${e.id}:${e.accessHash}`, title: name, kind: e.bot ? "bot" : "chat", members: null, username: e.username || null });
    }
  }
  return out;
}
/** Saves the chat list with the trader, so every device shows it straight away. */
async function saveChats(c: TelegramClient): Promise<MyChat[]> {
  const list = await listChats(c);
  await auth().update({ chats: list, chats_at: new Date().toISOString() }).eq("id", T());
  return list;
}

/** Reloads the chat list from Telegram (and saves it for every device). */
export async function tgaChats(): Promise<MyChat[]> {
  const s = await sessionGet();
  if (!s) throw new Error("Log in with your Telegram account first.");
  const turn = await takeTurn("chats", 40, 12_000);
  if (!turn) throw new Error("The bot is busy reading your groups. Try again in a few seconds.");
  let c: TelegramClient | null = null;
  try { c = await client(s); return await saveChats(c); }
  catch (e) { if (await loginDied(e)) throw new Error(DEAD_NOTE); throw new Error(friendly(e)); }
  finally { await close(c); await giveTurn(turn); }
}

export type ChatPost = { text: string; chat: string; chatRef: string; isChannel: boolean; url: string; at: number; from: { id: string | null; username: string | null }; isBot?: boolean };

/**
 * Every minute: new messages in the trader's followed chats (groups, channels, private chats) (up to 25 chats, 30 messages each), since the last one
 * read. The first read of a chat only marks where to start, so old posts are never bought.
 */
/**
 * Fast watch: one Telegram connection kept open for `ms`, every ticked chat checked every `every` ms, each new post
 * handed to `onPost` the moment it's seen (so a call is bought seconds after it's posted, not up to a minute later).
 */
export async function tgaWatch(onPost: (p: ChatPost) => Promise<unknown>, ms = 42_000, every = 2_000): Promise<string[]> {
  const { data } = await tq("ai_trader_sources").select("id,ref,title,handle,last_msg_id").eq("kind", "tg_chat").eq("enabled", true).order("polled_at", { ascending: true }).limit(25);
  const chats = (data || []) as { id: number; ref: string; title: string | null; handle: string | null; last_msg_id: number | null }[];
  if (!chats.length) return [];
  const s = await sessionGet();
  if (!s) return ["Telegram account isn't logged in any more. Log in again on the AI trader page."];
  const errors: string[] = [];
  const last = new Map(chats.map((ch) => [ch.id, ch.last_msg_id]));
  const failed = new Set<number>();
  let c: TelegramClient | null = null;
  const started = Date.now();
  const end = started + ms;
  const turn = await takeTurn("watch", Math.ceil(ms / 1000) + 15, 6_000);
  if (!turn) return []; // another reader still has the turn: it covers these chats
  let dead = false;
  try {
    c = await client(s);
    while (Date.now() < end && !dead) {
      if (await wanted(started)) break; // the page wants to refresh the chat list: step aside
      const t0 = Date.now();
      const found: ChatPost[] = [];
      await Promise.all(chats.filter((ch) => !failed.has(ch.id)).map(async (ch) => {
        try {
          const prev = last.get(ch.id) ?? null;
          const msgs: any[] = await c!.getMessages(peerOf(ch.ref), prev == null ? { limit: 1 } : { limit: 30, minId: Number(prev) });
          const top = msgs.reduce((m, x) => Math.max(m, Number(x.id) || 0), Number(prev) || 0);
          if (prev == null || top !== prev) {
            last.set(ch.id, top);
            await tq("ai_trader_sources").update({ polled_at: new Date().toISOString(), last_msg_id: top, ...(msgs.length && prev != null ? { last_post_at: new Date().toISOString() } : {}) }).eq("id", ch.id);
          }
          if (prev == null) return;
          for (const m of [...msgs].sort((a, b) => Number(a.id) - Number(b.id))) {
            const text = String(m.message || "");
            if (!text) continue;
            const snd: any = m.sender;
            const from = { id: m.senderId != null ? String(m.senderId) : null, username: snd?.username ? String(snd.username).toLowerCase() : null };
            found.push({ text, chat: ch.title || "Telegram", chatRef: ch.ref, isChannel: m.post === true, url: ch.handle ? `https://t.me/${ch.handle}/${m.id}` : `tga:${ch.ref.split(":")[1]}:${m.id}`, at: (Number(m.date) || Date.now() / 1000) * 1000, from, isBot: snd?.bot === true });
          }
        } catch (e) {
          if (DEAD.test(String((e as any)?.errorMessage || (e as Error)?.message || e))) { dead = true; await loginDied(e); return; }
          const msg = friendly(e);
          // Telegram asked us to slow down: wait it out instead of hammering.
          const wait = /FLOOD_WAIT_(\d+)|wait of (\d+) seconds/i.exec(String((e as any)?.message || ""));
          if (wait) { failed.add(ch.id); errors.push(`${ch.title || "a chat"}: Telegram asked to slow down for ${wait[1] || wait[2]}s`); return; }
          failed.add(ch.id); errors.push(`${ch.title || "a chat"}: ${msg}`);
        }
      }));
      // Oldest first, one at a time, so two chats sharing the same coin can't both buy it.
      for (const p of found.sort((a, b) => a.at - b.at)) await onPost(p).catch(() => {});
      const left = every - (Date.now() - t0);
      if (left > 0 && Date.now() + left < end) await new Promise((r) => setTimeout(r, left));
    }
  } catch (e) { await loginDied(e); errors.push(friendly(e)); }
  finally { await close(c); await giveTurn(turn); }
  if (dead) return [DEAD_NOTE];
  return errors;
}

export async function tgaNewPosts(): Promise<{ posts: ChatPost[]; errors: string[] }> {
  const { data } = await tq("ai_trader_sources").select("id,ref,title,handle,last_msg_id").eq("kind", "tg_chat").eq("enabled", true).order("polled_at", { ascending: true }).limit(25);
  const chats = (data || []) as { id: number; ref: string; title: string | null; handle: string | null; last_msg_id: number | null }[];
  if (!chats.length) return { posts: [], errors: [] };
  const s = await sessionGet();
  if (!s) return { posts: [], errors: ["Telegram account isn't logged in any more. Log in again on the AI trader page."] };
  const posts: ChatPost[] = [], errors: string[] = [];
  let c: TelegramClient | null = null;
  const turn = await takeTurn("poll", 60, 0);
  if (!turn) return { posts, errors };
  try {
    c = await client(s);
    for (const ch of chats) {
      try {
        const peer = peerOf(ch.ref);
        const first = ch.last_msg_id == null;
        const msgs: any[] = await c.getMessages(peer, first ? { limit: 1 } : { limit: 30, minId: Number(ch.last_msg_id) });
        const top = msgs.reduce((m, x) => Math.max(m, Number(x.id) || 0), Number(ch.last_msg_id) || 0);
        await tq("ai_trader_sources").update({ polled_at: new Date().toISOString(), last_msg_id: top, ...(msgs.length && !first ? { last_post_at: new Date().toISOString() } : {}) }).eq("id", ch.id);
        if (first) continue;
        const user = ch.handle;
        for (const m of msgs) {
          const text = String(m.message || "");
          if (!text) continue;
          // Who posted it (for caller sizes): the sender's user id and @username when Telegram includes them.
          const snd: any = m.sender;
          const from = { id: m.senderId != null ? String(m.senderId) : null, username: snd?.username ? String(snd.username).toLowerCase() : null };
          posts.push({ text, chat: ch.title || "Telegram", chatRef: ch.ref, isChannel: m.post === true, url: user ? `https://t.me/${user}/${m.id}` : `tga:${ch.ref.split(":")[1]}:${m.id}`, at: (Number(m.date) || Date.now() / 1000) * 1000, from, isBot: snd?.bot === true });
        }
      } catch (e) { errors.push(`${ch.title || "a chat"}: ${friendly(e)}`); }
    }
  } catch (e) { await loginDied(e); errors.push(friendly(e)); }
  finally { await close(c); await giveTurn(turn); }
  return { posts, errors };
}

// ---------------------------------------------------------------- Caller scout (lib/ai-trader-scout.ts)

/** The chat list saved at the last refresh (every group / channel the account is in), without connecting. */
export async function tgaSavedChats(): Promise<MyChat[]> {
  const { data } = await auth().select("chats").eq("id", T()).maybeSingle();
  return (((data as any)?.chats || []) as MyChat[]).filter((c) => c.kind === "group" || c.kind === "channel");
}

export type ScoutRead = { ref: string; top: number | null; posts: ChatPost[]; error?: string };

/**
 * The scout's turn: reads a few chats it's learning from (any group / channel the account is in, or a public one by
 * @username, even without joining). The first read of a chat takes its last 100 messages, so old calls count at once;
 * after that only new ones. Stops at `budgetMs`, and steps aside if the live watch needs the connection.
 */
export async function tgaScoutRead(chats: { ref: string; username: string | null; title: string | null; last_msg_id: number | null }[], budgetMs = 8_000): Promise<ScoutRead[]> {
  if (!chats.length) return [];
  const s = await sessionGet().catch(() => "");
  if (!s) return [];
  const turn = await takeTurn("scout", Math.ceil(budgetMs / 1000) + 10, 0);
  if (!turn) return [];
  const out: ScoutRead[] = [];
  let c: TelegramClient | null = null;
  const end = Date.now() + budgetMs;
  try {
    c = await client(s);
    for (const ch of chats) {
      if (Date.now() > end) break;
      try {
        const peer = peerOf(ch.ref);
        const first = ch.last_msg_id == null;
        const msgs: any[] = await c.getMessages(peer, first ? { limit: 100 } : { limit: 60, minId: Number(ch.last_msg_id) });
        const top = msgs.reduce((m, x) => Math.max(m, Number(x.id) || 0), Number(ch.last_msg_id) || 0) || null;
        const posts: ChatPost[] = [];
        for (const m of msgs) {
          const text = String(m.message || "");
          if (!text) continue;
          const snd: any = m.sender;
          posts.push({ text, chat: ch.title || "Telegram", chatRef: ch.ref, isChannel: m.post === true, url: ch.username ? `https://t.me/${ch.username}/${m.id}` : `tga:${ch.ref.split(":")[1]}:${m.id}`, at: (Number(m.date) || Date.now() / 1000) * 1000, from: { id: m.senderId != null ? String(m.senderId) : null, username: snd?.username ? String(snd.username).toLowerCase() : null }, isBot: snd?.bot === true });
        }
        out.push({ ref: ch.ref, top, posts });
      } catch (e) {
        if (DEAD.test(String((e as any)?.errorMessage || (e as Error)?.message || e))) { await loginDied(e); break; }
        out.push({ ref: ch.ref, top: ch.last_msg_id, posts: [], error: friendly(e) });
        if (/FLOOD_WAIT/i.test(String((e as any)?.message || ""))) break; // Telegram asked to slow down
      }
    }
  } catch (e) { await loginDied(e); }
  finally { await close(c); await giveTurn(turn); }
  return out;
}

/** A public group / channel by link or @username: its title, to add to the scout (works without joining). */
export async function tgaPublicChat(raw: string): Promise<{ ref: string; title: string; username: string; kind: "group" | "channel" }> {
  const u = String(raw).trim().replace(/^https?:\/\/(t\.me|telegram\.me)\//i, "").replace(/^@/, "").split(/[/?]/)[0];
  if (!/^[A-Za-z0-9_]{4,32}$/.test(u)) throw new Error("Paste a public link like t.me/name or @name.");
  const s = await sessionGet();
  if (!s) throw new Error("Log in with your Telegram account first.");
  const turn = await takeTurn("scout", 25, 8_000);
  if (!turn) throw new Error("The bot is busy reading your groups. Try again in a few seconds.");
  let c: TelegramClient | null = null;
  try {
    c = await client(s);
    const e: any = await c.getEntity(u);
    if (e?.className !== "Channel") throw new Error("That isn't a public group or channel.");
    return { ref: `@${e.username || u}`, title: String(e.title || u), username: String(e.username || u), kind: e.broadcast ? "channel" : "group" };
  } catch (e) { throw new Error(friendly(e)); }
  finally { await close(c); await giveTurn(turn); }
}
