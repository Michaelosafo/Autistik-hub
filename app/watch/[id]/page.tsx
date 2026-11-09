import { notFound } from "next/navigation";
import WatchView from "@/components/watch/WatchView";
import { adminState } from "@/lib/admin";
import { currentUser, supabaseServer } from "@/lib/supabase/server";
import type { Video } from "@/lib/stream-shared";

export const dynamic = "force-dynamic";

async function load(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data } = await supabaseServer().from("videos").select("id,author_id,kind,title,about,cf_uid,rec_uid,status,duration,views,likes,comments,created_at,started_at,ended_at").eq("id", id).maybeSingle();
  return (data as Video) || null;
}
export async function generateMetadata({ params }: { params: { id: string } }) {
  const v = await load(params.id);
  return { title: v ? `${v.title} · TIK · AUTISTIK Hub` : "Video · AUTISTIK Hub", description: v?.about?.slice(0, 160) || "Watch on TIK, the AUTISTIK community." };
}

// A video, fun clip or live stream on TIK.
export default async function WatchPage({ params }: { params: { id: string } }) {
  const v = await load(params.id);
  if (!v) notFound();
  const user = await currentUser();
  const admin = user ? (await adminState()).admin : false;
  return <WatchView video={v} me={user?.id ?? null} admin={admin} />;
}
