import { timingSafeEqual } from "crypto";
import { tgSecret } from "@/lib/tg-secret";
import { copyPost } from "@/lib/ai-trader";
import { tgHandle } from "@/lib/ai-trader-copy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Telegram calls this for every update the AUTISTIK bot gets:
 *  - "/start <code>" in a private chat links the owner's Telegram to the AI trader;
 *  - the bot being added to or removed from a group / channel adds or switches off that chat as a source;
 *  - a post in a followed group / channel: every contract address in it is copy-traded straight away.
 * Posts in chats that aren't switched on are ignored.
 */
export async function POST(req: Request) {
  const want = tgSecret(), got = req.headers.get("x-telegram-bot-api-secret-token") || "";
  if (!want || got.length !== want.length || !timingSafeEqual(Buffer.from(got), Buffer.from(want))) return new Response("no", { status: 401 });
  const u = await req.json().catch(() => null);
  const post = await tgHandle(u).catch(() => null);
  if (post) await copyPost({ text: post.text, user: post.chat, url: post.url, at: post.at }, "telegram", `posted in "${post.chat}" on Telegram`).catch(() => []);
  return Response.json({ ok: true });
}
