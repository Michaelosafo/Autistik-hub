import Anthropic from "@anthropic-ai/sdk";
import { supabaseServer, supabaseService, currentUser } from "@/lib/supabase/server";
import { AI_FREE_PER_DAY, AI_PASS_DAYS, AI_PASS_USD } from "@/lib/aipass";
import { rateLimit } from "@/lib/ratelimit";

let client: Anthropic | null = null;
/** Created on first use, so the site builds and runs even before ANTHROPIC_API_KEY is added. */
export function anthropic() {
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || "missing" });
  return client;
}
// Only a real Claude model name is used (e.g. "claude-sonnet-5-5"); anything else, such as a key pasted into the
// wrong setting, falls back to the default so the AI keeps working.
function modelSetting(name: string, fallback: string) {
  const v = (process.env[name] || "").trim();
  if (v && !/^claude-[a-z0-9.-]+$/.test(v)) console.error(`${name} isn't a Claude model name, so ${fallback} is used.`);
  return /^claude-[a-z0-9.-]+$/.test(v) ? v : fallback;
}
/** The better model, for AI Pass subscribers. */
export const MODEL = modelSetting("ANTHROPIC_MODEL", "claude-sonnet-5-5");
/** The low-cost model, for free messages and the Launch Pad guide (about 1/20th of the price). */
export const FAST_MODEL = modelSetting("ANTHROPIC_FAST_MODEL", "claude-haiku-5-5");

/** Request options that keep each reply cheap: little hidden "thinking" on models that support the setting. */
export function cheap(model: string): Record<string, unknown> {
  return /^claude-(haiku|sonnet|opus|fable)-5/.test(model) ? { output_config: { effort: "low" } } : {};
}

/** Records what a request used, for the Admin page's AI budget. Never blocks or breaks the reply. */
export function logCost(model: string, feature: "chat" | "draw" | "launch", usage: any) {
  if (!usage || !process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  const input = (usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0);
  supabaseService().rpc("log_ai_cost", { p_model: model, p_feature: feature, p_in: input, p_out: usage.output_tokens || 0 })
    .then(({ error }) => { if (error) console.error("log_ai_cost failed (has supabase/ai-budget.sql been run?):", error.message); });
}

/**
 * Checks the visitor is signed in, under today's AI limit, and has an AI Pass or free messages left today.
 * `cost` is how many messages this request counts as (a picture costs more). `needsPass: false` skips the pass
 * check (the Launch Pad guide stays free so people can launch). Returns an error Response or the user id.
 */
export async function guardAI(who = "Believer and Purity", opts: { cost?: number; needsPass?: boolean } = {}): Promise<{ uid: string; freeLeft?: number; premium: boolean } | { error: Response }> {
  const plural = who.includes(" and ");
  if (!process.env.ANTHROPIC_API_KEY) return { error: json({ error: `${who} ${plural ? "are" : "is"} coming soon. Check back shortly!` }, 503) };
  const user = await currentUser();
  if (!user) return { error: json({ error: `Please sign in to talk with ${who}.` }, 401) };
  if (!user.email_confirmed_at && !user.phone_confirmed_at) return { error: json({ error: `Please confirm your email first. Open the email from AUTISTIK Hub and press Confirm, then try again.` }, 403) };
  // No more than 12 AI requests a minute per account, so a script can't burn through the credit.
  const slow = await rateLimit(null, "ai", 12, 60, user.id);
  if (slow) return { error: slow };
  const limit = Number(process.env.AI_DAILY_LIMIT || 60);
  const { data, error } = await supabaseService().rpc("ai_spend", {
    p_user: user.id, p_free: AI_FREE_PER_DAY, p_limit: limit, p_cost: Math.max(1, opts.cost ?? 1), p_needs_pass: opts.needsPass ?? true,
  });
  if (error || !data) {
    console.error("ai_spend failed (have supabase/schema.sql and supabase/ai-pass.sql been run?):", error?.message);
    return { error: json({ error: `${who} ${plural ? "aren't" : "isn't"} available right now. The site's database isn't fully set up yet.` }, 503) };
  }
  const r = data as { ok: boolean; reason?: string; free_left?: number };
  if (!r.ok && r.reason === "limit") return { error: json({ error: `You've reached today's limit of ${limit} messages. ${who} will be back tomorrow.` }, 429) };
  if (!r.ok) return { error: json({ needPass: true, error: `You've used today's ${AI_FREE_PER_DAY} free messages${(r.free_left ?? 0) > 0 ? ` (a picture needs more than the ${r.free_left} you have left)` : ""}. They come back tomorrow, or get an AI Pass ($${AI_PASS_USD} for ${AI_PASS_DAYS} days) to keep talking with ${who} now.` }, 402) };
  return { uid: user.id, freeLeft: r.free_left, premium: !!(r as any).pass_until };
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
