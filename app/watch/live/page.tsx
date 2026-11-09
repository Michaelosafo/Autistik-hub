import { redirect } from "next/navigation";
import GoLive from "@/components/watch/GoLive";
import { currentUser, supabaseServer } from "@/lib/supabase/server";
import { streamReady } from "@/lib/stream";

export const dynamic = "force-dynamic";
export const metadata = { title: "Go live · TIK · AUTISTIK Hub" };

// The go-live studio: camera or screen, straight from the browser. Picks up a stream that's still running.
export default async function GoLivePage() {
  const user = await currentUser();
  if (!user) redirect("/login?next=/watch/live");
  if (!streamReady()) return <div className="card wv-soon"><b>Live video is coming soon</b><p className="muted">Until then, start a live audio room from Live.</p></div>;
  const { data } = await supabaseServer().from("videos").select("id,title").eq("author_id", user.id).eq("kind", "stream").in("status", ["waiting", "live"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
  return (
    <div className="stack" style={{ maxWidth: 900 }}>
      <div className="page-head"><div className="label">TIK · Livestreams</div><h1>Go live</h1></div>
      <GoLive resume={data ? { id: data.id, title: data.title } : null} />
    </div>
  );
}
