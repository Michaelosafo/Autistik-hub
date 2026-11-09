import { timingSafeEqual } from "crypto";
import { tgSecret } from "@/lib/tg-secret";
import { actOnSignal, getSettings } from "@/lib/ai-trader";
import { postSignals } from "@/lib/ai-signals";
import { supabaseService } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Telegram calls this the moment a post lands in a channel or group the AUTISTIK bot is in. Contract addresses and
 * $TICKERS in the post become signals for the AI trader straight away (no waiting for the next minute).
 */
export async function POST(req: Request) {
  const want = tgSecret(), got = req.headers.get("x-telegram-bot-api-secret-token") || "";
  if (!want || got.length !== want.length || !timingSafeEqual(Buffer.from(got), Buffer.from(want))) return new Response("no", { status: 401 });
  const u = await req.json().catch(() => null);
  const m = u?.channel_post || u?.message || u?.edited_channel_post;
  const text = String(m?.text || m?.caption || "");
  if (!text) return Response.json({ ok: true });
  const s = await getSettings();
  if (!s.enabled || !s.signals_on) return Response.json({ ok: true });
  const chat = String(m?.chat?.title || m?.chat?.username || "Telegram");
  const url = m?.chat?.username ? `https://t.me/${m.chat.username}/${m.message_id}` : `tg:${m?.chat?.id}:${m?.message_id}`;
  const chains = s.mode === "live" ? ["bsc"] : s.chains;
  const found = await postSignals({ text, user: chat, url, at: (Number(m?.date) || Date.now() / 1000) * 1000 }, "telegram", chains).catch(() => []);
  const sb = supabaseService();
  for (const { sig, flow } of found) {
    const { data } = await sb.from("ai_trader_signals").upsert({ source: sig.source, who: sig.who, body: sig.body, url: sig.url, chain: sig.chain, token: sig.token, at: new Date(sig.at).toISOString() }, { onConflict: "source,chain,token,url", ignoreDuplicates: true }).select("id");
    if (data?.length) await actOnSignal(s, sig, flow);
  }
  return Response.json({ ok: true });
}
