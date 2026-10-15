import Anthropic from "@anthropic-ai/sdk";
import { supabaseServer, supabaseService } from "@/lib/supabase/server";

let client: Anthropic | null = null;
/** Created on first use, so the site builds and runs even before ANTHROPIC_API_KEY is added. */
export function anthropic() {
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || "missing" });
  return client;
}
export const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";

/** Checks the visitor is signed in and under today's AI limit. Returns an error Response or the user id. */
export async function guardAI(who = "Believer and Purity"): Promise<{ uid: string } | { error: Response }> {
  if (!process.env.ANTHROPIC_API_KEY) return { error: json({ error: `${who} ${who.includes(" and ") ? "are" : "is"} coming soon. Check back shortly!` }, 503) };
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) return { error: json({ error: `Please sign in to talk with ${who}.` }, 401) };
  if (!user.email_confirmed_at && !user.phone_confirmed_at) return { error: json({ error: `Please confirm your email first. Open the email from AUTISTIK Hub and press Confirm, then try again.` }, 403) };
  const limit = Number(process.env.AI_DAILY_LIMIT || 60);
  const { data, error } = await supabaseService().rpc("bump_ai_usage", { p_user: user.id, p_limit: limit });
  if (error) {
    console.error("bump_ai_usage failed (has supabase/schema.sql been run?):", error.message);
    return { error: json({ error: `${who} ${who.includes(" and ") ? "aren't" : "isn't"} available right now. The site's database isn't fully set up yet.` }, 503) };
  }
  if (data === -1) return { error: json({ error: `You've reached today's limit of ${limit} messages. ${who} will be back tomorrow.` }, 429) };
  return { uid: user.id };
}

/** Turns a Claude API error into a plain message, and logs the real reason for the site owner (Vercel → Logs). */
export function aiErrorMessage(e: unknown, who = "The AI"): string {
  const err = e as { status?: number; message?: string };
  const status = err?.status ?? 0;
  const msg = String(err?.message || "");
  console.error(`Claude API error (${status}):`, msg);
  if (/credit balance|billing/i.test(msg)) return `${who} is paused right now (the AI account needs credit). Please try again later.`;
  if (status === 401 || status === 403) return `${who} isn't set up correctly yet. Please try again later.`;
  if (status === 404) return `${who} isn't set up correctly yet (the AI model name is wrong). Please try again later.`;
  if (status === 429) return `${who} is very busy right now. Wait a minute and try again.`;
  if (status === 529 || status >= 500) return `${who} is overloaded right now. Try again in a minute.`;
  return "Sorry, something went wrong. Please try again.";
}

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export type Turn = { role: "user" | "assistant"; content: string };

/** Keeps the last 20 turns, trims long messages, and makes sure the list starts and ends with the person. */
export function cleanTurns(raw: unknown): Turn[] | null {
  if (!Array.isArray(raw)) return null;
  let turns: Turn[] = raw
    .filter((t: any) => t && (t.role === "user" || t.role === "assistant") && typeof t.content === "string" && t.content.trim())
    .map((t: any) => ({ role: t.role, content: String(t.content).slice(0, 4000) }))
    .slice(-20);
  // merge consecutive same-role turns
  const merged: Turn[] = [];
  for (const t of turns) {
    const last = merged[merged.length - 1];
    if (last && last.role === t.role) last.content += "\n\n" + t.content; else merged.push({ ...t });
  }
  while (merged.length && merged[0].role !== "user") merged.shift();
  if (!merged.length || merged[merged.length - 1].role !== "user") return null;
  return merged;
}
