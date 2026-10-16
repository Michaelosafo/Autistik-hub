import { notFound } from "next/navigation";
import Admin from "@/components/Admin";
import AdminMfa from "@/components/AdminMfa";
import AIBudget from "@/components/AIBudget";
import { adminState } from "@/lib/admin";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin · AUTISTIK Hub", robots: { index: false, follow: false } };

export default async function AdminPage() {
  const { owner, admin } = await adminState();
  // Everyone except the owner sees an ordinary "page not found", so the admin area isn't advertised.
  if (!owner) notFound();
  return (
    <div className="stack">
      <div className="page-head"><div className="label">Admin</div><h1>Run the Hub</h1><p className="muted">Only the Hub owner can open this page.</p></div>
      {admin ? <><AIBudget /><Admin /></> : <AdminMfa />}
    </div>
  );
}
