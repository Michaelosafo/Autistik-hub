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
import bigInt from "big-integer";
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
  if (/PASSWORD_HASH_INVALID/.test(m)) return "That 2-step verification password is wrong.";
  if (/FLOOD_WAIT_(\d+)/.test(m)) return `Telegram asks to wait ${Math.ceil(Number(m.match(/FLOOD_WAIT_(\d+)/)![1]) / 60)} minutes before trying again.`;
  if (/PHONE_NUMBER_BANNED/.test(m)) return "Telegram says this number is banned.";
  if (/SEND_CODE_UNAVAILABLE/.test(m)) return "Telegram has no other way to send the code right now. Check the \"Telegram\" chat in your app, or wait a few minutes and start again.";
  if (/API_ID_INVALID/.test(m)) return "Telegram says TELEGRAM_API_ID / TELEGRAM_API_HASH don't match. Copy them again from my.telegram.org/apps into Vercel and redeploy.";
  if (/PHONE_CODE_EMPTY|PHONE_CODE_HASH_EMPTY/.test(m)) return "That login has expired. Start again.";
  return m.slice(0, 160);
}

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

/** Step 1: Telegram sends a login code (it decides where: usually in the Telegram app itself). */
export async function tgaStart(phoneRaw: string): Promise<{ sentTo: string; resend: string | null }> {
  const phone = phoneRaw.replace(/[^\d+]/g, "").replace(/^(?!\+)/, "+");
  if (!/^\+\d{7,15}$/.test(phone)) throw new Error("Type your phone number with the country code, like +233…");
  let c: TelegramClient | null = null;
  try {
    c = await client();
    const r: any = await c.invoke(new Api.auth.SendCode({ phoneNumber: phone, apiId: apiId(), apiHash: apiHash(), settings: new Api.CodeSettings({}) }));
    // The half-finished session (same server key) has to be reused for the next step.
    await auth().upsert({ id: T(), phone, code_hash: String(r.phoneCodeHash), pending_session: String(c.session.save()), pending_at: new Date().toISOString() });
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
  await auth().update({ pending_session: null, code_hash: null, account_name: name, signed_in_at: new Date().toISOString() }).eq("id", T());
  return name;
}

async function pending(): Promise<{ phone: string; code_hash: string; pending_session: string }> {
  const { data } = await auth().select("phone,code_hash,pending_session,pending_at").eq("id", T()).maybeSingle();
  if (!data?.pending_session || !data.pending_at || Date.now() - Date.parse(data.pending_at) > 10 * 60_000) throw new Error("That login has expired. Start again.");
  return data as any;
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
        await auth().update({ pending_session: String(c.session.save()), pending_at: new Date().toISOString() }).eq("id", T());
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
  let c: TelegramClient | null = null;
  try {
    c = await client(p.pending_session);
    const pw: any = await c.invoke(new Api.account.GetPassword());
    await c.invoke(new Api.auth.CheckPassword({ password: await computeCheck(pw, password) }));
    return { ok: true, name: await finish(c) };
  } catch (e) { throw new Error(friendly(e)); }
  finally { await close(c); }
}

/** Signs the session out on Telegram's side too, and forgets it. */
export async function tgaLogout() {
  const s = await sessionGet();
  if (s) { let c: TelegramClient | null = null; try { c = await client(s); await c.invoke(new Api.auth.LogOut()); } catch { /* already gone */ } finally { await close(c); } }
  await sessionSet(null);
  await auth().update({ account_name: null, signed_in_at: null, pending_session: null, code_hash: null }).eq("id", T());
  await tq("ai_trader_sources").update({ enabled: false }).eq("kind", "tg_chat");
}

export async function tgaStatus(): Promise<{ ready: boolean; signedIn: boolean; name: string | null }> {
  const { data } = await auth().select("account_name,signed_in_at").eq("id", T()).maybeSingle();
  return { ready: tgAccountReady(), signedIn: !!data?.signed_in_at, name: data?.account_name ?? null };
}

/**
 * A chat's reference: "c:<id>:<accessHash>" for channels and supergroups, "g:<id>" for small groups. Kept with the
 * source, so the chat can be read again without listing every chat first.
 */
function peerOf(ref: string): any {
  const [k, id, hash] = ref.split(":");
  if (k === "c") return new Api.InputPeerChannel({ channelId: bigInt(id), accessHash: bigInt(hash) });
  if (k === "g") return new Api.InputPeerChat({ chatId: bigInt(id) });
  if (k === "u") return new Api.InputPeerUser({ userId: bigInt(id), accessHash: bigInt(hash) });
  throw new Error("Unknown chat.");
}

export type MyChat = { ref: string; title: string; kind: "group" | "channel" | "chat" | "bot"; members: number | null; username: string | null };

/** Every group, channel and private chat (people and bots) of the signed-in account, most recent first. */
export async function tgaChats(): Promise<MyChat[]> {
  const s = await sessionGet();
  if (!s) throw new Error("Log in with your Telegram account first.");
  let c: TelegramClient | null = null;
  try {
    c = await client(s);
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
  } catch (e) { throw new Error(friendly(e)); }
  finally { await close(c); }
}

export type ChatPost = { text: string; chat: string; url: string; at: number };

/**
 * Every minute: new messages in the trader's followed chats (groups, channels, private chats) (up to 25 chats, 30 messages each), since the last one
 * read. The first read of a chat only marks where to start, so old posts are never bought.
 */
export async function tgaNewPosts(): Promise<{ posts: ChatPost[]; errors: string[] }> {
  const { data } = await tq("ai_trader_sources").select("id,ref,title,handle,last_msg_id").eq("kind", "tg_chat").eq("enabled", true).order("polled_at", { ascending: true }).limit(25);
  const chats = (data || []) as { id: number; ref: string; title: string | null; handle: string | null; last_msg_id: number | null }[];
  if (!chats.length) return { posts: [], errors: [] };
  const s = await sessionGet();
  if (!s) return { posts: [], errors: ["Telegram account isn't logged in any more. Log in again on the AI trader page."] };
  const posts: ChatPost[] = [], errors: string[] = [];
  let c: TelegramClient | null = null;
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
          posts.push({ text, chat: ch.title || "Telegram", url: user ? `https://t.me/${user}/${m.id}` : `tga:${ch.ref.split(":")[1]}:${m.id}`, at: (Number(m.date) || Date.now() / 1000) * 1000 });
        }
      } catch (e) { errors.push(`${ch.title || "a chat"}: ${friendly(e)}`); }
    }
  } catch (e) { errors.push(friendly(e)); }
  finally { await close(c); }
  return { posts, errors };
}
