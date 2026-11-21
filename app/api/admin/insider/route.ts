import { json } from "@/lib/ai";
import { adminState } from "@/lib/admin";
import { logActivity } from "@/lib/activity";
import { insiderState, runInsider } from "@/lib/insider";
import { rateLimit } from "@/lib/ratelimit";
import { supabaseService } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const KINDS = new Set(["x", "telegram", "reddit", "dex"]);

export async function GET() {
  if (!(await (async () => { const w = await adminState(); return w.staff && w.owner; })())) return json({ error: "Admins only. Open the Admin page and enter your 2-step code first." }, 403);
  return json(await insiderState());
}

export async function POST(req: Request) {
  const slow = await rateLimit(req, "admin-insider", 40, 60);
  if (slow) return slow;
  if (!(await (async () => { const w = await adminState(); return w.staff && w.owner; })())) return json({ error: "Admins only. Open the Admin page and enter your 2-step code first." }, 403);
  const b = await req.json().catch(() => null);
  const action = String(b?.action || "");
  const sb = supabaseService();
  try {
    if (action === "settings") {
      const killed = !!b.killed;
      const dry = b.dry_run !== false;
      await sb.from("insider_settings").update({ killed, dry_run: dry, updated_at: new Date().toISOString() }).eq("id", 1);
      logActivity(null, "swap", `Insider ${killed ? "kill switch on" : dry ? "paper mode" : "live buys on"}`, "/admin/insider");
    } else if (action === "source-add") {
      const kind = String(b.kind || "");
      const handle = String(b.handle || "").trim().replace(/^@/, "").slice(0, 80);
      if (!KINDS.has(kind) || !handle) return json({ error: "Pick a source and a name." }, 400);
      const { error } = await sb.from("insider_sources").insert({ kind, handle });
      if (error) return json({ error: error.message.includes("duplicate") ? "That source is already on the list." : error.message }, 400);
      logActivity(null, "swap", `Insider tracking ${kind} ${handle}`, "/admin/insider");
    } else if (action === "source-del") {
      await sb.from("insider_sources").delete().eq("id", Number(b.id));
    } else if (action === "rule-save") {
      const row = {
        caller: b.caller ? String(b.caller).trim().replace(/^@/, "").slice(0, 80) : null,
        min_score: num(b.min_score, 60),
        chains: Array.isArray(b.chains) && b.chains.length ? b.chains.map(String) : ["bsc", "ethereum", "base", "arbitrum", "solana"],
        max_buy_usd: num(b.max_buy_usd, 25),
        wallets: String(b.wallets || "1").split(/[^0-9]+/).map(Number).filter((x) => x >= 1 && x <= 13).slice(0, 13),
        max_per_hour: num(b.max_per_hour, 4),
        min_liq_usd: num(b.min_liq_usd, 15000),
        max_tax_pct: num(b.max_tax_pct, 10),
        max_age_min: num(b.max_age_min, 180),
        tp_multiple: num(b.tp_multiple, 2),
        sl_pct: num(b.sl_pct, 40),
        max_hold_min: num(b.max_hold_min, 360),
        partial_pct: b.partial_pct === "" || b.partial_pct == null ? null : num(b.partial_pct, 0) || null,
        enabled: b.enabled !== false,
      };
      if (!row.wallets.length) row.wallets = [1];
      if (b.id) await sb.from("insider_rules").update(row).eq("id", Number(b.id));
      else await sb.from("insider_rules").insert(row);
      logActivity(null, "swap", `Insider rule ${row.caller || "default"}`, "/admin/insider");
    } else if (action === "rule-del") {
      await sb.from("insider_rules").delete().eq("id", Number(b.id));
    } else if (action === "run") {
      const out = await runInsider();
      return json({ ...(await insiderState()), run: out });
    } else return json({ error: "Unknown action." }, 400);
    return json(await insiderState());
  } catch (e) {
    return json({ error: (e as Error).message || "Something went wrong." }, 400);
  }
}

function num(v: unknown, fallback: number) {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}
