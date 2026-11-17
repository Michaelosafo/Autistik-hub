import Link from "next/link";
import { notFound } from "next/navigation";
import TraderTabs from "@/components/TraderTabs";
import Lobby from "@/components/Lobby";
import { adminState } from "@/lib/admin";

export const dynamic = "force-dynamic";
export const metadata = { title: "Lobby · Admin", robots: { index: false, follow: false } };

/** Lobby: paste a BNB Chain token, buy the moment liquidity lands, sell at your X. */
export default async function LobbyPage() {
  const { staff, owner, helper } = await adminState();
  if (!owner && !helper) notFound();
  if (!staff) return <div className="card stack"><b>Enter your 2-step code first</b><p className="muted">Open <Link href="/admin">Admin</Link> and confirm your 2-step code, then come back.</p></div>;
  return <div className="stack"><TraderTabs /><Lobby /></div>;
}
