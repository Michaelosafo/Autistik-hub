import { getAddress, isAddress } from "viem";
import { adminState } from "@/lib/admin";
import { json } from "@/lib/ai";
import { logActivity } from "@/lib/activity";
import { CHAINS, isSolana, type ChainKey } from "@/lib/launchpad";
import { lookupToken } from "@/lib/market";
import { SOL_ADDR } from "@/lib/solana-launch";
import { currentUser, supabaseService } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Most tokens one request lists, so it finishes well inside the time limit. Send more in another request. */
const MAX_PER_REQUEST = 50;

type Result = { token: string; ok: boolean; text: string };

/** The token's address in the form the board stores, or null if it isn't one. */
function clean(chain: ChainKey, raw: string) {
  const v = raw.trim();
  if (isSolana(CHAINS[chain])) return SOL_ADDR.test(v) ? v : null;
  return isAddress(v) ? getAddress(v) : null;
}

// Admin only: lists tokens launched somewhere else on the Launch Pad for free, as many as the admin likes. Each one
// needs a trading pool on DexScreener (its pool, name and ticker come from there, never from the request). Listed
// tokens show on the board, in Trending and in New listings like a paid listing, without the trending slot.
export async function POST(req: Request) {
  if (!(await adminState()).admin) return json({ error: "Admins only." }, 403);
  const body = await req.json().catch(() => null);
  const chain = body?.chain as ChainKey;
  if (!CHAINS[chain]) return json({ error: "Pick the chain the tokens are on." }, 400);
  const raw: string[] = (Array.isArray(body?.tokens) ? body.tokens : String(body?.tokens || "").split(/[\s,]+/)).map(String).filter(Boolean);
  const wanted = [...new Set(raw)];
  if (!wanted.length) return json({ error: "Paste at least one token address." }, 400);
  if (wanted.length > MAX_PER_REQUEST) return json({ error: `Up to ${MAX_PER_REQUEST} tokens at a time. Send the rest after.` }, 400);

  const user = await currentUser();
  const sb = supabaseService();
  const results: Result[] = [];
  const tokens: string[] = [];
  for (const w of wanted) {
    const t = clean(chain, w);
    if (!t) results.push({ token: w, ok: false, text: `Not a ${CHAINS[chain].name} token address.` });
    else if (!tokens.includes(t)) tokens.push(t);
  }
  const { data: known } = tokens.length ? await sb.from("launches").select("token").eq("chain", chain).in("token", tokens) : { data: [] };
  const already = new Set((known || []).map((k: any) => k.token));

  // DexScreener lookups a few at a time, to stay friendly to its rate limit.
  const todo = tokens.filter((t) => !already.has(t));
  for (const t of tokens) if (already.has(t)) results.push({ token: t, ok: true, text: "Already on the Launch Pad." });
  for (let i = 0; i < todo.length; i += 5) {
    await Promise.all(todo.slice(i, i + 5).map(async (token) => {
      const found = await lookupToken(chain, token);
      if (!found) { results.push({ token, ok: false, text: "No trading pool on DexScreener yet." }); return; }
      const { error } = await sb.from("launches").upsert({
        chain, token, pair: found.pair, creator: "AUTISTIK team", name: found.name || "Unknown", symbol: found.symbol || "?",
        supply: "0", tx_hash: `admin-list:${chain}:${token}`, source: "listed", user_id: user?.id ?? null,
      }, { onConflict: "tx_hash", ignoreDuplicates: true });
      results.push(error ? { token, ok: false, text: "Couldn't save it. Try again." } : { token, ok: true, text: `Listed ${found.symbol || token}.` });
    }));
  }
  const listed = results.filter((r) => r.ok && r.text.startsWith("Listed")).length;
  if (listed) logActivity(user?.id ?? null, "launch", `Listed ${listed} token${listed > 1 ? "s" : ""} on ${CHAINS[chain].name}`, "/launchpad");
  return json({ listed, results });
}

// Admin only: takes a listed token off the Launch Pad. Tokens launched here stay: they're on-chain launches.
export async function DELETE(req: Request) {
  if (!(await adminState()).admin) return json({ error: "Admins only." }, 403);
  const body = await req.json().catch(() => null);
  const chain = body?.chain as ChainKey;
  const token = CHAINS[chain] ? clean(chain, String(body?.token || "")) : null;
  if (!token) return json({ error: "Pick the chain and paste the token address." }, 400);
  const { data, error } = await supabaseService().from("launches").delete().eq("chain", chain).eq("token", token).eq("source", "listed").select("token");
  if (error) return json({ error: "Couldn't remove it. Try again." }, 500);
  return data?.length ? json({ removed: true }) : json({ error: "That token isn't a listed token on the Launch Pad." }, 404);
}
