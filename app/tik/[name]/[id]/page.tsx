import type { Metadata } from "next";
import OpenTik from "./OpenTik";
import { supabaseService } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
const ID = /^[0-9a-f-]{36}$/i;

/**
 * A shared Tik: autistik.io/tik/<poster's name>/<tik id>. The poster's account name is in the link, and the link
 * preview (WhatsApp, X, Telegram…) shows who posted it and what they said. Opening it shows the Tik in TIK.
 */
async function load(id: string) {
  if (!ID.test(id)) return null;
  try {
    const sb = supabaseService();
    const { data: t } = await sb.from("tiks").select("id,body,author_id").eq("id", id).maybeSingle();
    if (!t) return null;
    const { data: p } = await sb.from("profiles").select("alias").eq("id", t.author_id).maybeSingle();
    return { body: String(t.body || ""), alias: p?.alias ? String(p.alias) : null };
  } catch { return null; }
}

export async function generateMetadata({ params }: { params: { name: string; id: string } }): Promise<Metadata> {
  const t = await load(params.id);
  const who = t?.alias || decodeURIComponent(params.name).replace(/-/g, " ");
  const text = (t?.body || "").replace(/\s+/g, " ").trim();
  const title = `${who} on AUTISTIK TIK`;
  const description = text ? (text.length > 180 ? text.slice(0, 177) + "…" : text) : `See what ${who} posted on TIK.`;
  return { title, description, openGraph: { title, description, type: "article" }, twitter: { card: "summary", title, description } };
}

export default async function SharedTik({ params }: { params: { name: string; id: string } }) {
  const t = await load(params.id);
  const who = t?.alias || decodeURIComponent(params.name).replace(/-/g, " ");
  return <OpenTik id={ID.test(params.id) ? params.id : ""} who={who} />;
}
