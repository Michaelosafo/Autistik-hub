import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Downloads this round's eligible wallets as CSV: wallet,points,alias
export async function GET() {
  const sb = supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return new Response("Sign in first.", { status: 401 });
  const { data: me } = await sb.from("profiles").select("is_admin").eq("id", user.id).single();
  if (!me?.is_admin) return new Response("Admins only.", { status: 403 });

  const [{ data: st }, { data: pts }, { data: w }] = await Promise.all([
    sb.from("app_settings").select("*").eq("id", 1).single(),
    sb.from("member_points").select("user_id,alias,points").limit(10000),
    sb.from("wallets").select("user_id,address"),
  ]);
  const need = st?.qualify_points ?? 50;
  const wallet = new Map((w || []).map((x: any) => [x.user_id, x.address]));
  const lines = ["wallet,points,alias"];
  for (const r of (pts || []).filter((r: any) => r.points >= need && wallet.has(r.user_id)).sort((a: any, b: any) => b.points - a.points)) {
    lines.push(`${wallet.get(r.user_id)},${r.points},"${String(r.alias).replace(/"/g, "'")}"`);
  }
  const name = `autistik-${String(st?.round_name || "round").toLowerCase().replace(/[^a-z0-9]+/g, "-")}.csv`;
  return new Response(lines.join("\n") + "\n", {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}"` },
  });
}
