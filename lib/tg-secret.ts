import { createHash } from "crypto";
/** The secret Telegram sends with every update to the AI trader webhook (made from the bot token). Server only. */
export function tgSecret() {
  const t = process.env.TELEGRAM_BOT_TOKEN || "";
  return t ? createHash("sha256").update(`autistik-ai-trader:${t}`).digest("hex").slice(0, 48) : "";
}
