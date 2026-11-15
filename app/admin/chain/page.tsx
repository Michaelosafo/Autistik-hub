import { notFound } from "next/navigation";
import ChainAdmin from "@/components/ChainAdmin";
import { adminState } from "@/lib/admin";

export const dynamic = "force-dynamic";
export const metadata = { title: "AUTISTIK Chain · Admin", robots: { index: false, follow: false } };

/** The AUTISTIK Chain control room: the site owner only. */
export default async function ChainPage() {
  const { owner, staff } = await adminState();
  if (!owner) notFound();
  if (!staff) return <div className="card stack"><b>Enter your 2-step code first</b><p className="muted">Open <a href="/admin">Admin</a> and confirm your 2-step code, then come back.</p></div>;
  return <ChainAdmin />;
}
