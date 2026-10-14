import { redirect } from "next/navigation";
import Admin from "@/components/Admin";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin · AUTISTIK Hub" };

export default async function AdminPage() {
  const sb = supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login");
  const { data: me } = await sb.from("profiles").select("is_admin").eq("id", user.id).single();
  if (!me?.is_admin) redirect("/");
  return (
    <div className="stack">
      <div className="page-head"><div className="label">Admin</div><h1>Run the Hub</h1><p className="muted">Only admins see this page.</p></div>
      <Admin />
    </div>
  );
}
