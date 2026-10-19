import { rateLimit } from "@/lib/ratelimit";
import { supabaseService } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Keep only the origin (or a keyword like "inline"), never paths, queries or tokens. */
const clean = (v: unknown) => {
  const s = String(v ?? "").slice(0, 500);
  if (/^(inline|eval|self|data|blob|wasm-eval|trusted-types-sink)$/.test(s)) return s;
  try { return new URL(s).origin; } catch { return s.split(/[/?#]/)[0].slice(0, 60) || "unknown"; }
};
const pagePath = (v: unknown) => { try { return new URL(String(v)).pathname.replace(/0x[0-9a-fA-F]{6,}|[1-9A-HJ-NP-Za-km-z]{32,}/g, ":id").slice(0, 120); } catch { return "unknown"; } };

/** Browsers send Content Security Policy violations here (both the enforced and the trial policy). */
export async function POST(req: Request) {
  const limited = await rateLimit(req, "csp-report", 30, 60);
  if (limited) return new Response(null, { status: 204 });
  const body = await req.json().catch(() => null);
  // Old format: { "csp-report": {...} }. New Reporting API: [{ type: "csp-violation", body: {...} }].
  const items: any[] = Array.isArray(body) ? body.filter((x) => x?.type === "csp-violation").map((x) => x.body) : body?.["csp-report"] ? [body["csp-report"]] : [];
  const sb = supabaseService();
  for (const r of items.slice(0, 10)) {
    const directive = String(r?.effectiveDirective || r?.["effective-directive"] || r?.["violated-directive"] || "").split(" ")[0].slice(0, 60);
    if (!directive) continue;
    await sb.rpc("csp_report_add", {
      p_directive: directive,
      p_blocked: clean(r?.blockedURL ?? r?.["blocked-uri"]),
      p_page: pagePath(r?.documentURL ?? r?.["document-uri"]),
      p_disposition: String(r?.disposition || "enforce").slice(0, 12),
    }).then(() => {}, () => {});
  }
  return new Response(null, { status: 204 });
}
