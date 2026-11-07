import { supabaseService } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const revalidate = 600;

const SITE = (process.env.NEXT_PUBLIC_SITE_URL || "https://autistik.io").replace(/\/$/, "");

/** One permanent link to a launched coin's logo (for token lists, explorers and listing forms). */
export async function GET(_req: Request, { params }: { params: { chain: string; token: string } }) {
  if (!/^[a-z]{2,12}$/.test(params.chain) || !/^[0-9A-Za-z]{32,44}$/.test(params.token)) return new Response("Not found", { status: 404 });
  const { data } = await supabaseService().from("token_logos").select("url").eq("chain", params.chain).ilike("token", params.token).maybeSingle();
  const url = String(data?.url || "");
  if (!url) return new Response("Not found", { status: 404 });
  const abs = url.startsWith("/") ? `${SITE}${url}` : url;
  if (!/^https:\/\//.test(abs)) return new Response("Not found", { status: 404 });
  return new Response(null, { status: 302, headers: { location: abs, "access-control-allow-origin": "*", "cache-control": "public, max-age=600" } });
}
